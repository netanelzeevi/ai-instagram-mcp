import { env as moduleEnv } from "cloudflare:workers";
import OAuthProvider, { AuthorizationError, CimdFetchError, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import { Hono, type Context } from "hono";
import {
	allowedLogins,
	beginDashboardLogin,
	checkDashboardState,
	clearDashStateCookie,
	clearSessionCookie,
	configProblem,
	githubAuthorizeUrl,
	githubLogin,
	readCookie,
	sameOrigin,
	sessionCookie,
	sessionLogin,
} from "./auth";
import { accountRow, draftCard, esc, legalPage, metaSettingsCard, page } from "./dashboard";
import { authorizeUrl, exchangeCode, refreshAccountToken } from "./ig";
import { createServer, type Props } from "./mcp";
import { processDraft, runDue } from "./publisher";
import { type Account, type Draft, accountsForOwner, audit, encryptToken, forgetAccount, getDraft, randomId, sha256, updateDraft, upsertAccount } from "./store";

type AppEnv = { Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } };
const app = new Hono<AppEnv>();

const IG_STATE_COOKIE = "__Host-igmcp_ig_state";
const MAX_UPLOAD_BYTES = 95 * 1024 * 1024;

function htmlError(message: string, status = 400): Response {
	const r = page("שגיאה", `<h1>משהו השתבש</h1><p>${esc(message)}</p><p><a href="/dash">חזרה ללוח</a></p>`);
	return new Response(r.body, { status, headers: r.headers });
}

// Lets the Worker deploy before every secret and binding exists; each route says what is missing.
const NEEDS: [RegExp, (keyof Env)[]][] = [
	[/^\/(authorize|callback|dash)/, ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"]],
	[/^\/(dash\/ig|ig\/)/, ["IG_APP_ID", "IG_APP_SECRET"]],
	[/^\/(dash\/upload|m\/|u\/)/, ["MEDIA"]],
];

app.onError((e) => {
	console.error(e);
	return htmlError(String((e as Error).message ?? e), 500);
});

app.use("*", async (c, next) => {
	const url = new URL(c.req.url);
	const path = url.pathname;
	if (/^\/(authorize|callback|dash|ig\/callback)/.test(path)) {
		const problem = configProblem(c.env, url);
		if (problem) return htmlError(problem, 503);
	}
	const missing = NEEDS.filter(([re]) => re.test(path)).flatMap(([, keys]) => keys.filter((k) => !c.env[k]));
	if (missing.length) return htmlError(`השרת עוד לא מוגדר עד הסוף. חסר: ${missing.join(", ")}`, 503);
	await next();
});

async function requireLogin(c: Context<AppEnv>): Promise<string | Response> {
	const login = await sessionLogin(c.env, c.req.raw);
	return login ?? c.redirect("/dash/login");
}

// ---------- MCP OAuth: consent page, then GitHub ----------

// Chrome applies form-action to the redirects after a POST, so the consent form must allow GitHub and the client.
function formActionSource(redirectUri: string): string {
	const u = new URL(redirectUri);
	return u.protocol === "http:" || u.protocol === "https:" ? u.origin : u.protocol;
}

app.get("/authorize", async (c) => {
	const oauth = c.env.OAUTH_PROVIDER;
	try {
		const request = await oauth.parseAuthRequest(c.req.raw);
		const details = await oauth.describeConsent(request);
		const consent = await oauth.beginConsent(request);
		const origin = details.clientDomain
			? `מפורסם על ידי <strong>${esc(details.clientDomain)}</strong>.`
			: "האפליקציה רשמה את עצמה, והשם שלה לא מאומת.";
		const r = page(
			"אישור חיבור",
			`<h1>לאשר ל-${esc(details.clientName)} גישה לשרת האינסטגרם שלך?</h1>
<p>${origin} הגישה תישלח אל <strong>${esc(details.redirectHost)}</strong>.</p>
${details.redirectIsLoopback ? "<p class='bad'><strong>הגישה תישלח לאפליקציה במחשב שלך.</strong> המשך רק אם התחלת עכשיו את החיבור ממנה.</p>" : ""}
<p class="muted">הכלי יוכל לקרוא תוכן, תגובות, סטטיסטיקות והודעות, וליצור טיוטות. פרסום קורה רק אחרי אישור שלך בלוח.</p>
<form method="post" action="/authorize">
<input type="hidden" name="handle" value="${esc(consent.handle)}">
<div class="row"><button name="decision" value="approve">אשר והתחבר עם GitHub</button>
<button class="secondary" name="decision" value="deny">דחה</button></div>
</form>`,
			`'self' https://github.com ${formActionSource(details.redirectUri)}`,
		);
		consent.headers.forEach((v, k) => r.headers.append(k, v));
		return r;
	} catch (e) {
		if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302);
		if (e instanceof AuthorizationError) return htmlError(e.description);
		if (e instanceof CimdFetchError) return htmlError("לא הצלחתי לאמת את האפליקציה שמבקשת גישה.");
		throw e;
	}
});

app.post("/authorize", async (c) => {
	const oauth = c.env.OAUTH_PROVIDER;
	try {
		const form = await c.req.raw.formData();
		const handle = String(form.get("handle"));
		if (form.get("decision") !== "approve") {
			const denied = await oauth.denyConsent(c.req.raw, handle);
			denied.headers.set("Location", denied.redirectTo);
			return new Response(null, { status: 302, headers: denied.headers });
		}
		const approved = await oauth.approveConsent(c.req.raw, handle);
		const { state, headers } = await oauth.beginUpstream(approved.request, { headers: approved.headers });
		headers.set("Location", githubAuthorizeUrl(c.env, state));
		return new Response(null, { status: 302, headers });
	} catch (e) {
		if (e instanceof AuthorizationError) return htmlError(`${e.description}. נסה להתחבר שוב מהאפליקציה.`);
		throw e;
	}
});

// GitHub sends both flows back here; dashboard states start with "dash."
app.get("/callback", async (c) => {
	const state = c.req.query("state") ?? "";
	const code = c.req.query("code");

	if (state.startsWith("dash.")) {
		if (!checkDashboardState(c.req.raw, state) || !code) return htmlError("פג תוקף ההתחברות. נסה שוב.");
		const login = await githubLogin(c.env, code);
		if (!allowedLogins(c.env).has(login.toLowerCase())) {
			await audit(c.env, login, "dash.login_denied", null);
			return htmlError("המשתמש הזה לא מורשה.", 403);
		}
		const headers = new Headers({ Location: "/dash" });
		headers.append("Set-Cookie", await sessionCookie(c.env, login));
		headers.append("Set-Cookie", clearDashStateCookie());
		await audit(c.env, login, "dash.login", null);
		return new Response(null, { status: 302, headers });
	}

	const oauth = c.env.OAUTH_PROVIDER;
	try {
		const { request, headers } = await oauth.finishUpstream(c.req.raw);
		if (c.req.query("error") || !code) {
			const { authorizationErrorRedirect } = await import("@cloudflare/workers-oauth-provider");
			headers.set("Location", authorizationErrorRedirect(request, "access_denied"));
			return new Response(null, { status: 302, headers });
		}
		const login = await githubLogin(c.env, code);
		if (!allowedLogins(c.env).has(login.toLowerCase())) {
			await audit(c.env, login, "mcp.login_denied", null);
			return htmlError("המשתמש הזה לא מורשה.", 403);
		}
		const client = await oauth.lookupClient(request.clientId);
		const props: Props = { login, client: client?.clientName ?? request.clientId };
		const { redirectTo } = await oauth.completeAuthorization({
			request,
			userId: login,
			metadata: { client: props.client },
			scope: request.scope,
			props,
		});
		await audit(c.env, login, "mcp.connect", null, { client: props.client });
		headers.set("Location", redirectTo);
		return new Response(null, { status: 302, headers });
	} catch (e) {
		if (e instanceof AuthorizationError) return htmlError(`${e.description}. נסה להתחבר שוב מהאפליקציה.`);
		throw e;
	}
});

// ---------- dashboard ----------

app.get("/", (c) => c.redirect("/dash"));
app.get("/privacy", () => legalPage("privacy"));
app.get("/terms", () => legalPage("terms"));
app.get("/dash/login", (c) => beginDashboardLogin(c.env));
app.get("/dash/logout", () => new Response(null, { status: 302, headers: { Location: "/dash/login", "Set-Cookie": clearSessionCookie() } }));

app.get("/dash", async (c) => {
	const login = await requireLogin(c);
	if (login instanceof Response) return login;
	const accounts = await accountsForOwner(c.env, login);
	const byId = new Map(accounts.map((a) => [a.id, a.username]));
	const ids = accounts.map((a) => a.id);
	let pending: Draft[] = [];
	let recent: Draft[] = [];
	if (ids.length) {
		const ph = ids.map(() => "?").join(",");
		pending = (
			await c.env.DB.prepare(`SELECT * FROM drafts WHERE account_id IN (${ph}) AND status = 'pending' ORDER BY created_at DESC LIMIT 50`)
				.bind(...ids)
				.all<Draft>()
		).results;
		recent = (
			await c.env.DB.prepare(`SELECT * FROM drafts WHERE account_id IN (${ph}) AND status != 'pending' ORDER BY updated_at DESC LIMIT 30`)
				.bind(...ids)
				.all<Draft>()
		).results;
	}
	const card = (d: Draft) => draftCard(d, byId.get(d.account_id) ?? "?");
	return page(
		"לוח אישורים",
		`<div class="row" style="justify-content:space-between"><div><h1>לוח אישורים</h1><div class="muted">מחובר כ-${esc(login)}</div></div>
<div class="row"><a class="btn" href="/dash/ig/connect">${accounts.length ? "חבר מחדש / חשבון נוסף" : "חבר חשבון אינסטגרם"}</a><a href="/dash/logout">יציאה</a></div></div>
<h2>חשבונות</h2>${accounts.map(accountRow).join("") || "<p class='muted'>עוד לא חובר חשבון.</p>"}
<h2>ממתין לאישור (${pending.length})</h2>${pending.map(card).join("") || "<p class='muted'>אין טיוטות שמחכות לך.</p>"}
<h2>העלאת מדיה</h2>
<div class="card"><form method="post" action="/dash/upload" enctype="multipart/form-data" class="row">
<input type="file" name="file" accept="image/jpeg,video/mp4,video/quicktime" required style="width:auto">
<select name="account">${accounts.map((a) => `<option value="${esc(a.id)}">@${esc(a.username)}</option>`).join("")}</select>
<button>העלה</button></form><p class="muted">תמונות ב-JPEG בלבד. הקובץ נמחק אחרי הפרסום או אחרי 7 ימים.</p></div>
<h2>אחרונים</h2>${recent.map(card).join("") || "<p class='muted'>עוד אין.</p>"}
<h2>הגדרות Meta</h2>${metaSettingsCard(c.env.PUBLIC_BASE_URL)}`,
	);
});

async function ownedDraft(c: Context<AppEnv>, login: string): Promise<{ d: Draft; account: Account } | Response> {
	if (!sameOrigin(c.env, c.req.raw)) return htmlError("בקשה ממקור לא מוכר.", 403);
	const d = await getDraft(c.env, c.req.param("id")!);
	const account = d ? (await accountsForOwner(c.env, login)).find((a) => a.id === d.account_id) : undefined;
	if (!d || !account) return htmlError("הטיוטה לא נמצאה.", 404);
	return { d, account };
}

app.post("/dash/drafts/:id/approve", async (c) => {
	const login = await requireLogin(c);
	if (login instanceof Response) return login;
	const found = await ownedDraft(c, login);
	if (found instanceof Response) return found;
	const { d } = found;
	if (d.status !== "pending") return htmlError(`אי אפשר לאשר טיוטה בסטטוס ${d.status}.`);

	const form = await c.req.raw.formData();
	const payload = JSON.parse(d.payload);
	const text = form.get("text");
	if (typeof text === "string") {
		if (d.kind === "post") payload.caption = text;
		if (d.kind === "comment_reply") payload.message = text;
		if (d.kind === "dm") {
			if (new TextEncoder().encode(text).length > 1000) return htmlError("הודעה פרטית מוגבלת ל-1000 בתים.");
			payload.text = text;
		}
	}
	const iso = String(form.get("scheduled_iso") ?? "");
	const when = d.kind === "post" && iso ? Date.parse(iso) : Date.now();
	if (Number.isNaN(when)) return htmlError("זמן לא תקין.");

	const now = Date.now();
	await updateDraft(c.env, d.id, {
		status: "approved",
		payload: JSON.stringify(payload),
		scheduled_at: Math.max(when, now),
		approved_by: login,
		approved_at: now,
	});
	await audit(c.env, login, "draft.approve", d.account_id, { id: d.id, scheduled_at: new Date(Math.max(when, now)).toISOString(), edited: typeof text === "string" });
	if (when <= now) {
		const fresh = await getDraft(c.env, d.id);
		if (fresh) c.executionCtx.waitUntil(processDraft(c.env, fresh));
	}
	return c.redirect(`/dash#${d.id}`, 303);
});

app.post("/dash/drafts/:id/reject", async (c) => {
	const login = await requireLogin(c);
	if (login instanceof Response) return login;
	const found = await ownedDraft(c, login);
	if (found instanceof Response) return found;
	const { d } = found;
	if (d.status !== "pending" && d.status !== "approved") return htmlError(`אי אפשר לבטל טיוטה בסטטוס ${d.status}.`);
	// An approved post whose container already exists may be mid-publish; only cancel before that.
	if (d.status === "approved" && d.stage) return htmlError("הפרסום כבר התחיל.");
	await updateDraft(c.env, d.id, { status: d.status === "pending" ? "rejected" : "cancelled" });
	await audit(c.env, login, "draft.reject", d.account_id, { id: d.id });
	return c.redirect("/dash", 303);
});

app.post("/dash/upload", async (c) => {
	const login = await requireLogin(c);
	if (login instanceof Response) return login;
	if (!sameOrigin(c.env, c.req.raw)) return htmlError("בקשה ממקור לא מוכר.", 403);
	const form = await c.req.raw.formData();
	const file = form.get("file");
	const accountId = String(form.get("account") ?? "");
	const account = (await accountsForOwner(c.env, login)).find((a) => a.id === accountId);
	if (!account || !(file instanceof File)) return htmlError("חסר קובץ או חשבון.");
	const types: Record<string, string> = { "image/jpeg": ".jpg", "video/mp4": ".mp4", "video/quicktime": ".mov" };
	if (!types[file.type]) return htmlError("רק JPEG, MP4 או MOV.");
	if (file.size > MAX_UPLOAD_BYTES) return htmlError("הקובץ גדול מדי להעלאה דרך הלוח.");
	const key = `${account.id}/${randomId(18)}${types[file.type]}`;
	await c.env.MEDIA!.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
	await c.env.DB.prepare("INSERT INTO media (key, account_id, content_type, size, created_at) VALUES (?, ?, ?, ?, ?)")
		.bind(key, account.id, file.type, file.size, Date.now())
		.run();
	await audit(c.env, login, "media.upload", account.id, { key, size: file.size });
	const url = `${c.env.PUBLIC_BASE_URL}/m/${key}`;
	return page(
		"הועלה",
		`<h1>הקובץ הועלה</h1><p>תן את הכתובת הזו ל-Claude או ל-Grok כדי שיכינו טיוטה:</p><div class="card"><code>${esc(url)}</code></div><p><a href="/dash">חזרה ללוח</a></p>`,
	);
});

// ---------- Instagram Business Login ----------

app.get("/dash/ig/connect", async (c) => {
	const login = await requireLogin(c);
	if (login instanceof Response) return login;
	const state = randomId(24);
	return new Response(null, {
		status: 302,
		headers: {
			Location: authorizeUrl(c.env, state),
			"Set-Cookie": `${IG_STATE_COOKIE}=${state}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`,
		},
	});
});

app.get("/ig/callback", async (c) => {
	const login = await requireLogin(c);
	if (login instanceof Response) return login;
	const state = c.req.query("state");
	if (!state || state !== readCookie(c.req.raw, IG_STATE_COOKIE)) return htmlError("פג תוקף החיבור לאינסטגרם. נסה שוב.");
	if (c.req.query("error")) return htmlError(`אינסטגרם החזיר שגיאה: ${c.req.query("error_description") ?? c.req.query("error")}`);
	const code = c.req.query("code");
	if (!code) return htmlError("חסר קוד מאינסטגרם.");
	try {
		const t = await exchangeCode(c.env, code);
		const now = Date.now();
		await upsertAccount(c.env, {
			id: t.userId,
			app_user_id: t.appUserId,
			username: t.username,
			owner_login: login,
			token_enc: await encryptToken(c.env, t.token),
			token_expires_at: t.expiresAt,
			token_refreshed_at: now,
			scopes: t.permissions,
		});
		await audit(c.env, login, "account.connect", t.userId, { username: t.username, permissions: t.permissions });
	} catch (e) {
		return htmlError(String((e as Error).message ?? e));
	}
	return new Response(null, {
		status: 302,
		headers: { Location: "/dash", "Set-Cookie": `${IG_STATE_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0` },
	});
});

// Meta calls these when someone removes the app or asks for their data to be deleted.
async function verifySignedRequest(env: Env, signed: string): Promise<{ user_id?: string } | null> {
	const [sig, payload] = signed.split(".");
	if (!sig || !payload) return null;
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.IG_APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
	const toBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
	const ok = await crypto.subtle.verify("HMAC", key, toBytes(sig), new TextEncoder().encode(payload));
	if (!ok) return null;
	return JSON.parse(new TextDecoder().decode(toBytes(payload)));
}

app.post("/ig/deauthorize", async (c) => {
	const form = await c.req.raw.formData();
	const data = await verifySignedRequest(c.env, String(form.get("signed_request") ?? ""));
	if (!data?.user_id) return c.text("bad request", 400);
	await forgetAccount(c.env, String(data.user_id), "account.deauthorized");
	return c.text("ok");
});

app.post("/ig/data-deletion", async (c) => {
	const form = await c.req.raw.formData();
	const data = await verifySignedRequest(c.env, String(form.get("signed_request") ?? ""));
	if (!data?.user_id) return c.text("bad request", 400);
	await forgetAccount(c.env, String(data.user_id), "account.data_deleted");
	const code = randomId(9);
	return c.json({ url: `${c.env.PUBLIC_BASE_URL}/ig/data-deletion/${code}`, confirmation_code: code });
});

app.get("/ig/data-deletion/:code", (c) =>
	page("מחיקת מידע", `<h1>הבקשה התקבלה</h1><p>כל המידע של החשבון נמחק מהשרת. קוד אישור: ${esc(c.req.param("code"))}</p>`),
);

// ---------- media hosting for Meta to fetch ----------

app.get("/m/*", async (c) => {
	const key = decodeURIComponent(new URL(c.req.url).pathname.slice(3));
	const obj = await c.env.MEDIA!.get(key, { range: c.req.raw.headers, onlyIf: c.req.raw.headers });
	if (!obj) return c.text("not found", 404);
	const headers = new Headers();
	obj.writeHttpMetadata(headers);
	headers.set("etag", obj.httpEtag);
	headers.set("Accept-Ranges", "bytes");
	headers.set("Cache-Control", "private, no-store");
	if (!("body" in obj)) return new Response(null, { status: 304, headers });
	const range = obj.range as { offset?: number; length?: number } | undefined;
	if (c.req.header("range") && range && range.offset !== undefined) {
		const length = range.length ?? obj.size - range.offset;
		headers.set("Content-Range", `bytes ${range.offset}-${range.offset + length - 1}/${obj.size}`);
		headers.set("Content-Length", String(length));
		return new Response(obj.body, { status: 206, headers });
	}
	headers.set("Content-Length", String(obj.size));
	return new Response(obj.body, { headers });
});

app.put("/u/:token", async (c) => {
	const hash = await sha256(c.req.param("token"));
	const link = await c.env.DB.prepare("SELECT * FROM upload_links WHERE token_hash = ?").bind(hash).first<{
		account_id: string;
		content_type: string;
		expires_at: number;
		used_key: string;
	}>();
	if (!link || link.expires_at < Date.now()) return c.json({ error: "upload link expired or used" }, 403);
	const type = (c.req.header("content-type") ?? "").split(";")[0];
	if (type !== link.content_type) return c.json({ error: `content-type must be ${link.content_type}` }, 415);
	const size = Number(c.req.header("content-length") ?? 0);
	if (!size || size > MAX_UPLOAD_BYTES) return c.json({ error: "missing or too large content-length" }, 413);
	// Single use: claim the link atomically before writing, so two parallel PUTs can't both pass.
	const claimed = await c.env.DB.prepare("UPDATE upload_links SET expires_at = 0 WHERE token_hash = ? AND expires_at > ?")
		.bind(hash, Date.now())
		.run();
	if (claimed.meta.changes !== 1) return c.json({ error: "upload link expired or used" }, 403);
	await c.env.MEDIA!.put(link.used_key, c.req.raw.body, { httpMetadata: { contentType: type } });
	await c.env.DB.prepare("INSERT INTO media (key, account_id, content_type, size, created_at) VALUES (?, ?, ?, ?, ?)")
		.bind(link.used_key, link.account_id, type, size, Date.now())
		.run();
	await audit(c.env, "upload_link", "media.upload", link.account_id, { key: link.used_key, size });
	return c.json({ media_url: `${c.env.PUBLIC_BASE_URL}/m/${link.used_key}` });
});

// ---------- wiring ----------

const mcpHandler = {
	fetch(request: Request, bindings: Env, ctx: ExecutionContext) {
		return createMcpHandler(() => createServer(bindings))(request, bindings, ctx);
	},
} satisfies ExportedHandler<Env>;

const provider = new OAuthProvider({
	apiRoute: "/mcp",
	apiHandler: mcpHandler,
	defaultHandler: app as any,
	authorizeEndpoint: "/authorize",
	tokenEndpoint: "/token",
	clientRegistrationEndpoint: "/register",
	resourceMetadata: { resource: `${moduleEnv.PUBLIC_BASE_URL}/mcp` },
	accessTokenTTL: 3600,
	refreshTokenTTL: 30 * 86400,
	refreshTokenIdleTTL: 14 * 86400,
});

async function daily(env: Env): Promise<void> {
	const weekAgo = Date.now() - 6 * 86400000;
	const { results } = await env.DB.prepare(
		"SELECT * FROM accounts WHERE token_refreshed_at < ? AND token_expires_at > ?",
	)
		.bind(weekAgo, Date.now())
		.all<Account>();
	for (const a of results) await refreshAccountToken(env, a);

	// files nobody published within 7 days
	const old = (await env.DB.prepare("SELECT key FROM media WHERE created_at < ?").bind(Date.now() - 7 * 86400000).all<{ key: string }>()).results;
	for (const { key } of old) {
		await env.MEDIA?.delete(key);
		await env.DB.prepare("DELETE FROM media WHERE key = ?").bind(key).run();
	}
	await env.DB.prepare("DELETE FROM upload_links WHERE expires_at < ?").bind(Date.now() - 86400000).run();
	await env.DB.prepare("DELETE FROM audit WHERE at < ?").bind(Date.now() - 180 * 86400000).run();
}

export default {
	fetch: (request: Request, env: Env, ctx: ExecutionContext) => provider.fetch(request, env, ctx),
	async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
		if (event.cron === "17 3 * * *") ctx.waitUntil(daily(env));
		else ctx.waitUntil(runDue(env));
	},
} satisfies ExportedHandler<Env>;
