// Runs approved drafts. Called by the 5-minute cron and right after an "approve now" click.
// Posts go through Meta's container flow: create container(s) -> wait for FINISHED -> media_publish.

import { IgClient } from "./ig";
import { type Account, type Draft, audit, updateDraft } from "./store";

export type PostItem = { url: string; kind: "image" | "video" };
export type PostPayload = {
	type: "image" | "carousel" | "reel" | "story";
	caption?: string;
	items: PostItem[];
	alt_text?: string;
	share_to_feed?: boolean;
	cover_url?: string;
	trial?: "MANUAL" | "SS_PERFORMANCE";
	media_keys?: string[]; // files hosted by this server, deleted after publishing
};
export type CommentReplyPayload = { comment_id: string; message: string; comment_text?: string };
export type DmPayload = { recipient_id: string; text: string };
export type HideCommentPayload = { comment_id: string; hide: boolean };

const MAX_ATTEMPTS = 36; // ~3 hours of 5-minute ticks

async function claim(env: Env, d: Draft): Promise<boolean> {
	const r = await env.DB.prepare(
		"UPDATE drafts SET status = 'processing', attempts = attempts + 1, updated_at = ? WHERE id = ? AND updated_at = ? AND status IN ('approved', 'processing')",
	)
		.bind(Date.now(), d.id, d.updated_at)
		.run();
	return r.meta.changes === 1;
}

async function fail(env: Env, d: Draft, error: string): Promise<void> {
	await updateDraft(env, d.id, { status: "failed", error: error.slice(0, 2000) });
	await audit(env, "publisher", "draft.failed", d.account_id, { id: d.id, error });
}

// shortcut: a network or 5xx error while polling also fails the draft for good (see processDraft);
// retry polls on the next tick if that happens in practice, since GET status is safe to repeat.
async function containerStatus(ig: IgClient, id: string): Promise<{ code: string; detail?: string }> {
	const r = await ig.get(id, { fields: "status_code,status" });
	return { code: r.status_code, detail: r.status };
}

async function createContainer(ig: IgClient, p: PostPayload, item: PostItem, carouselItem: boolean): Promise<string> {
	const base: Record<string, string | boolean | undefined> = {};
	if (carouselItem) {
		base.is_carousel_item = true;
		if (item.kind === "image") base.image_url = item.url;
		else Object.assign(base, { media_type: "VIDEO", video_url: item.url });
	} else if (p.type === "story") {
		Object.assign(base, { media_type: "STORIES" }, item.kind === "image" ? { image_url: item.url } : { video_url: item.url });
	} else if (p.type === "reel") {
		Object.assign(base, {
			media_type: "REELS",
			video_url: item.url,
			caption: p.caption,
			share_to_feed: p.share_to_feed,
			cover_url: p.cover_url,
			trial_params: p.trial ? JSON.stringify({ graduation_strategy: p.trial }) : undefined,
		});
	} else {
		Object.assign(base, { image_url: item.url, caption: p.caption, alt_text: p.alt_text });
	}
	const r = await ig.post(`${ig.account.id}/media`, base);
	return r.id;
}

async function stepPost(env: Env, ig: IgClient, d: Draft): Promise<void> {
	const p = JSON.parse(d.payload) as PostPayload;

	if (!d.stage) {
		if (p.type === "carousel") {
			const ids: string[] = [];
			for (const item of p.items) ids.push(await createContainer(ig, p, item, true));
			await updateDraft(env, d.id, { stage: "children", child_ids: JSON.stringify(ids) });
		} else {
			const id = await createContainer(ig, p, p.items[0], false);
			await updateDraft(env, d.id, { stage: "container", container_id: id });
		}
		return;
	}

	if (d.stage === "children") {
		const ids = JSON.parse(d.child_ids ?? "[]") as string[];
		for (const id of ids) {
			const s = await containerStatus(ig, id);
			if (s.code === "ERROR" || s.code === "EXPIRED") return fail(env, d, `Carousel item ${id}: ${s.code} ${s.detail ?? ""}`);
			if (s.code !== "FINISHED") return; // still processing, next tick
		}
		const parent = await ig.post(`${ig.account.id}/media`, {
			media_type: "CAROUSEL",
			children: ids.join(","),
			caption: p.caption,
		});
		await updateDraft(env, d.id, { stage: "container", container_id: parent.id });
		return;
	}

	if (d.stage === "container") {
		const s = await containerStatus(ig, d.container_id!);
		if (s.code === "ERROR" || s.code === "EXPIRED") return fail(env, d, `Container: ${s.code} ${s.detail ?? ""}`);
		if (s.code !== "FINISHED") return;
		const published = await ig.post(`${ig.account.id}/media_publish`, { creation_id: d.container_id! });
		let permalink: string | undefined;
		try {
			permalink = (await ig.get(published.id, { fields: "permalink" })).permalink;
		} catch {}
		await updateDraft(env, d.id, {
			status: "published",
			stage: "done",
			result: JSON.stringify({ media_id: published.id, permalink }),
			error: null,
		});
		await audit(env, "publisher", "post.published", d.account_id, { id: d.id, media_id: published.id, permalink });
		for (const key of p.media_keys ?? []) {
			await env.MEDIA?.delete(key);
			await env.DB.prepare("DELETE FROM media WHERE key = ?").bind(key).run();
		}
	}
}

async function runOnce(env: Env, ig: IgClient, d: Draft): Promise<void> {
	let result: unknown;
	if (d.kind === "comment_reply") {
		const p = JSON.parse(d.payload) as CommentReplyPayload;
		result = await ig.postJson(`${p.comment_id}/replies`, { message: p.message });
	} else if (d.kind === "dm") {
		const p = JSON.parse(d.payload) as DmPayload;
		result = await ig.postJson("me/messages", { recipient: { id: p.recipient_id }, message: { text: p.text } });
	} else if (d.kind === "hide_comment") {
		const p = JSON.parse(d.payload) as HideCommentPayload;
		result = await ig.post(p.comment_id, { hide: p.hide });
	}
	await updateDraft(env, d.id, { status: "published", result: JSON.stringify(result), error: null });
	await audit(env, "publisher", `${d.kind}.sent`, d.account_id, { id: d.id });
}

export async function processDraft(env: Env, d: Draft): Promise<void> {
	if (d.attempts >= MAX_ATTEMPTS) return fail(env, d, "Gave up: Instagram did not finish processing in time.");
	if (!(await claim(env, d))) return; // another run has it
	const fresh = (await env.DB.prepare("SELECT * FROM drafts WHERE id = ?").bind(d.id).first<Draft>())!;
	const account = await env.DB.prepare("SELECT * FROM accounts WHERE id = ?").bind(d.account_id).first<Account>();
	if (!account) return fail(env, fresh, "Account no longer connected.");
	try {
		const ig = await IgClient.for(env, account);
		if (fresh.kind === "post") await stepPost(env, ig, fresh);
		else await runOnce(env, ig, fresh);
	} catch (e) {
		// Errors while creating or publishing are final; Meta does not dedupe a retried publish.
		await fail(env, fresh, String((e as Error).message ?? e));
	}
}

export async function runDue(env: Env): Promise<number> {
	const { results } = await env.DB.prepare(
		"SELECT * FROM drafts WHERE status IN ('approved', 'processing') AND scheduled_at <= ? ORDER BY scheduled_at LIMIT 10",
	)
		.bind(Date.now())
		.all<Draft>();
	for (const d of results) await processDraft(env, d);
	return results.length;
}
