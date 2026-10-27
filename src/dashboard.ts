// The approval dashboard: the only place where a draft becomes public.

import type { Account, Draft } from "./store";

export const esc = (v: unknown) =>
	String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STATUS_HE: Record<string, string> = {
	pending: "ממתין לאישור",
	approved: "מאושר, בתור",
	processing: "בעיבוד",
	published: "פורסם",
	rejected: "נדחה",
	cancelled: "בוטל",
	failed: "נכשל",
};

const KIND_HE: Record<string, string> = {
	post: "פוסט",
	comment_reply: "תגובה לתגובה",
	dm: "הודעה פרטית",
	hide_comment: "הסתרת תגובה",
};

function fmt(ms: number | null): string {
	if (!ms) return "";
	return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(ms);
}

export function page(title: string, body: string, formAction = "'self' https://www.instagram.com"): Response {
	const html = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>
:root{--bg:#f5f5f7;--card:#fff;--text:#1d1d1f;--muted:#6e6e73;--line:#d2d2d7;--accent:#0066cc;--ok:#1a7f37;--bad:#c62828}
@media (prefers-color-scheme:dark){:root{--bg:#111113;--card:#1c1c1f;--text:#f5f5f7;--muted:#a1a1a6;--line:#3a3a3c;--accent:#4c9bff;--ok:#3fb950;--bad:#ff6b6b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Heebo,sans-serif}
main{max-width:920px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:32px 0 12px}
.muted{color:var(--muted)}.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin:12px 0}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.tag{font-size:13px;border:1px solid var(--line);border-radius:999px;padding:2px 10px}
button,.btn{font:inherit;border:0;border-radius:10px;padding:9px 16px;cursor:pointer;background:var(--accent);color:#fff;text-decoration:none;display:inline-block}
button.secondary{background:transparent;color:var(--text);border:1px solid var(--line)}button.danger{background:var(--bad)}
textarea,input{font:inherit;width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--text)}
input[type=datetime-local]{width:auto}textarea{min-height:90px}
.media{display:flex;gap:8px;overflow-x:auto;margin:8px 0}.media img,.media video{height:180px;border-radius:10px;border:1px solid var(--line)}
.quote{border-inline-start:3px solid var(--line);padding-inline-start:10px;color:var(--muted);white-space:pre-wrap}
.ok{color:var(--ok)}.bad{color:var(--bad)}pre{white-space:pre-wrap;word-break:break-word;font-size:13px}
table{width:100%;border-collapse:collapse;font-size:14px}td{border-bottom:1px solid var(--line);padding:6px 4px;vertical-align:top}
</style>
</head>
<body><main>${body}</main>
<script>
// datetime-local is in the viewer's timezone; send an absolute ISO time.
document.querySelectorAll('form[data-approve]').forEach(function(f){
  f.addEventListener('submit', function(){
    var local = f.querySelector('input[type=datetime-local]');
    var iso = f.querySelector('input[name=scheduled_iso]');
    if (local && iso) iso.value = local.value ? new Date(local.value).toISOString() : '';
  });
});
</script>
</body></html>`;
	return new Response(html, {
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Content-Security-Policy": `default-src 'self'; img-src 'self' https: data:; media-src 'self' https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'; form-action ${formAction}`,
			"X-Frame-Options": "DENY",
			"Cache-Control": "no-store",
		},
	});
}

function toLocalInput(ms: number | null): string {
	if (!ms) return "";
	// yyyy-MM-ddTHH:mm in Israel time, for the datetime-local default value
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Jerusalem",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(ms);
	const g = (t: string) => parts.find((p) => p.type === t)?.value;
	return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

function draftBody(d: Draft): string {
	const p = JSON.parse(d.payload);
	if (d.kind === "post") {
		const media = (p.items as { url: string; kind: string }[])
			.map((i) =>
				i.kind === "video"
					? `<video src="${esc(i.url)}" controls preload="metadata"></video>`
					: `<img src="${esc(i.url)}" alt="">`,
			)
			.join("");
		const extras = [
			p.type === "reel" && p.trial ? `Trial Reel (${esc(p.trial)})` : "",
			p.type === "reel" && p.share_to_feed === false ? "בלי שיתוף לפיד" : "",
		]
			.filter(Boolean)
			.join(" · ");
		return `<div class="row"><span class="tag">${esc(p.type)}</span>${extras ? `<span class="muted">${extras}</span>` : ""}</div>
<div class="media">${media}</div>`;
	}
	if (d.kind === "comment_reply") {
		return p.comment_text ? `<div class="quote">${esc(p.comment_text)}</div>` : `<div class="muted">תגובה ${esc(p.comment_id)}</div>`;
	}
	if (d.kind === "dm") return `<div class="muted">אל: ${esc(p.recipient_id)}</div>`;
	if (d.kind === "hide_comment") return `<div>${p.hide ? "להסתיר" : "להחזיר"} את התגובה ${esc(p.comment_id)}</div>`;
	return "";
}

function editableField(d: Draft): string {
	const p = JSON.parse(d.payload);
	if (d.kind === "post") return `<label>כיתוב<textarea name="text" maxlength="2200">${esc(p.caption ?? "")}</textarea></label>`;
	if (d.kind === "comment_reply") return `<label>התגובה שתפורסם<textarea name="text" maxlength="2200">${esc(p.message)}</textarea></label>`;
	if (d.kind === "dm") return `<label>ההודעה<textarea name="text" maxlength="1000">${esc(p.text)}</textarea></label>`;
	return "";
}

export function draftCard(d: Draft, username: string): string {
	const head = `<div class="row"><strong>${esc(KIND_HE[d.kind])}</strong><span class="tag"><bdi>@${esc(username)}</bdi></span><span class="tag">${esc(STATUS_HE[d.status])}</span><span class="muted">${esc(d.created_by)} · ${fmt(d.created_at)}</span></div>`;
	const note = d.note ? `<p class="muted">למה: ${esc(d.note)}</p>` : "";
	let actions = "";
	if (d.status === "pending") {
		const schedulable = d.kind === "post";
		actions = `<form method="post" action="/dash/drafts/${esc(d.id)}/approve" data-approve>
${editableField(d)}
${
	schedulable
		? `<p class="row"><label>מתי לפרסם (שעון ישראל): <input type="datetime-local" value="${toLocalInput(d.proposed_at)}"></label><span class="muted">ריק = עכשיו</span></p>`
		: ""
}
<input type="hidden" name="scheduled_iso">
<div class="row"><button type="submit">${schedulable ? "אשר" : "אשר ושלח"}</button>
<button type="submit" class="secondary" formaction="/dash/drafts/${esc(d.id)}/reject">דחה</button></div>
</form>`;
	} else {
		const p = JSON.parse(d.payload);
		const text = d.kind === "post" ? p.caption : d.kind === "comment_reply" ? p.message : d.kind === "dm" ? p.text : "";
		const result = d.result ? JSON.parse(d.result) : null;
		actions = `${text ? `<div class="quote">${esc(text)}</div>` : ""}
${d.scheduled_at ? `<p class="muted">מתוזמן ל-${fmt(d.scheduled_at)}</p>` : ""}
${result?.permalink ? `<p><a href="${esc(result.permalink)}" target="_blank" rel="noopener">לפוסט באינסטגרם</a></p>` : ""}
${d.error ? `<p class="bad">${esc(d.error)}</p>` : ""}
${d.status === "approved" ? `<form method="post" action="/dash/drafts/${esc(d.id)}/reject"><button class="secondary">בטל לפני פרסום</button></form>` : ""}`;
	}
	return `<div class="card" id="${esc(d.id)}">${head}${note}${draftBody(d)}${actions}</div>`;
}

export function accountRow(a: Account): string {
	const days = Math.floor((a.token_expires_at - Date.now()) / 86400000);
	const health = a.status === "token_error" ? `<span class="bad">רענון הטוקן נכשל, צריך לחבר מחדש</span>` : days < 10 ? `<span class="bad">${days} ימים לטוקן</span>` : `<span class="ok">${days} ימים לטוקן</span>`;
	return `<div class="card row"><strong><bdi>@${esc(a.username)}</bdi></strong>
<span class="tag">${a.approval_mode === "manual" ? "אישור ידני לכל פעולה" : "אוטומטי"}</span>
${health}<span class="muted">רוענן ${fmt(a.token_refreshed_at)}</span></div>`;
}

// Meta asks for a privacy policy and terms URL before an app can go Live. Every copy serves its own,
// so nobody needs a website for it. Plain English: Meta reviews these pages, not the owner's users.
export function legalPage(kind: "privacy" | "terms"): Response {
	const body =
		kind === "privacy"
			? `<h1>Privacy policy</h1>
<p>This server is a self-hosted copy of the open-source project ai-instagram-mcp. It is run by the person who deployed it, for their own Instagram professional account, and connects that account to their own AI app.</p>
<h2>What is stored</h2>
<ul>
<li>The Instagram access token, encrypted (AES-GCM), and the account ID and username.</li>
<li>Drafts that the AI app proposes (posts, comment replies, direct messages) until the owner approves, rejects or cancels them.</li>
<li>Media files uploaded for publishing, deleted after publishing or after 7 days.</li>
<li>An audit log of actions, kept for 180 days.</li>
</ul>
<h2>What is not stored</h2>
<p>Posts, comments, messages and insights read from Instagram are passed to the owner's AI app when asked for, and are not saved on this server.</p>
<h2>Sharing</h2>
<p>Data is sent only to Meta's Instagram API and to the owner's AI app. It is not sold or shared with anyone else.</p>
<h2>Deleting your data</h2>
<p>Remove the app in Instagram: Settings, then Apps and websites. Meta then notifies this server, which deletes everything it stores about the account. The owner can also delete the whole server at any time.</p>`
			: `<h1>Terms of use</h1>
<p>This server is a self-hosted copy of the open-source project ai-instagram-mcp (AGPL-3.0), used by its owner to manage their own Instagram professional account through an AI app.</p>
<ul>
<li>Nothing is published, sent or hidden on Instagram until the owner approves it in the dashboard.</li>
<li>Use must follow Instagram's Terms of Use and Meta's Platform Terms.</li>
<li>The software is provided as is, without warranty of any kind.</li>
</ul>`;
	return page(kind === "privacy" ? "Privacy policy" : "Terms of use", `<article dir="ltr" lang="en">${body}</article>`);
}

/** The values to paste into the Meta app, so going Live needs no website of your own. */
export function metaSettingsCard(base: string): string {
	const row = (label: string, path: string) => `<tr><td>${label}</td><td><code>${esc(base + path)}</code></td></tr>`;
	return `<div class="card"><p class="muted">מה מדביקים באפליקציה ב Meta (App settings ואז Basic, ו Business login settings):</p>
<table>${row("Privacy policy URL", "/privacy")}${row("Terms of service URL", "/terms")}${row("OAuth redirect URI", "/ig/callback")}${row("Deauthorize callback URL", "/ig/deauthorize")}${row("Data deletion request URL", "/ig/data-deletion")}</table></div>`;
}
