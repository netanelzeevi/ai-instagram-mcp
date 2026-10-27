// Sign-in: one owner per server, with the password chosen at deploy time (DASH_PASSWORD).
// It guards both the dashboard and the consent page every MCP client goes through.

import { page } from "./dashboard";

const enc = new TextEncoder();
export const OWNER = "owner";
export const SESSION_COOKIE = "__Host-igmcp_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MIN_PASSWORD = 12;
const MAX_FAILS = 10;
const FAIL_WINDOW_S = 15 * 60;

async function hmac(env: Env, data: string): Promise<string> {
	const key = await crypto.subtle.importKey("raw", enc.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, [
		"sign",
	]);
	const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
	return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let r = 0;
	for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return r === 0;
}

export function readCookie(req: Request, name: string): string | undefined {
	const raw = req.headers.get("Cookie") ?? "";
	for (const part of raw.split(/;\s*/)) {
		const i = part.indexOf("=");
		if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
	}
	return undefined;
}

// shortcut: KV counts are eventually consistent, so a burst from many edge locations can slip a few
// extra tries past MAX_FAILS; move the counter to D1 if this server ever faces real brute force.
function failKey(req: Request): string {
	return `pwfail:${req.headers.get("CF-Connecting-IP") ?? "unknown"}`;
}

/**
 * Checks a submitted password. Both sides are HMACed first, so the comparison is
 * constant-time whatever the lengths. Returns an error message to show, or null when it matches.
 */
export async function checkPassword(env: Env, req: Request, submitted: string): Promise<string | null> {
	const key = failKey(req);
	const fails = Number((await env.OAUTH_KV.get(key)) ?? 0);
	if (fails >= MAX_FAILS) return "יותר מדי ניסיונות. מחכים רבע שעה ומנסים שוב.";
	if (timingSafeEqual(await hmac(env, submitted), await hmac(env, env.DASH_PASSWORD))) {
		await env.OAUTH_KV.delete(key);
		return null;
	}
	await env.OAUTH_KV.put(key, String(fails + 1), { expirationTtl: FAIL_WINDOW_S });
	return "הסיסמה לא נכונה.";
}

export async function sessionCookie(env: Env): Promise<string> {
	const value = `${OWNER}|${Date.now() + SESSION_TTL_MS}`;
	const signed = `${value}|${await hmac(env, value)}`;
	return `${SESSION_COOKIE}=${encodeURIComponent(signed)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export function clearSessionCookie(): string {
	return `${SESSION_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function sessionLogin(env: Env, req: Request): Promise<string | null> {
	const raw = readCookie(req, SESSION_COOKIE);
	if (!raw) return null;
	const [login, exp, sig] = raw.split("|");
	if (login !== OWNER || !exp || !sig) return null;
	if (!timingSafeEqual(sig, await hmac(env, `${login}|${exp}`))) return null;
	if (Number(exp) < Date.now()) return null;
	return login;
}

export function loginPage(error?: string): Response {
	return page(
		"כניסה",
		`<h1>כניסה ללוח האישורים</h1>
${error ? `<p class="bad">${error}</p>` : ""}
<form method="post" action="/dash/login" class="card">
<label>הסיסמה שבחרתם בהתקנה (DASH_PASSWORD)<input type="password" name="password" autocomplete="current-password" required autofocus></label>
<p><button>כניסה</button></p></form>`,
	);
}

// Settings a fresh copy of the template gets wrong. Each one says exactly what to change.
export function configProblem(env: Env, requestUrl: URL): string | null {
	let base: URL | null = null;
	try {
		base = new URL(env.PUBLIC_BASE_URL);
	} catch {}
	// Exact match: every OAuth redirect_uri is built as `${PUBLIC_BASE_URL}/...`, so a trailing slash breaks sign-in.
	if (!base || base.origin !== requestUrl.origin || env.PUBLIC_BASE_URL !== base.origin) {
		return `הכתובת ב PUBLIC_BASE_URL לא תואמת את השרת. ב wrangler.jsonc משנים אותה ל ${requestUrl.origin} (בלי / בסוף), ושומרים.`;
	}
	if ((env.DASH_PASSWORD ?? "").length < MIN_PASSWORD) {
		return `הסיסמה DASH_PASSWORD צריכה להיות באורך ${MIN_PASSWORD} תווים לפחות. מחליפים אותה ב Settings ואז Variables and Secrets.`;
	}
	if ((env.SESSION_SECRET ?? "").length < 32 || (env.TOKEN_ENC_KEY ?? "").length < 32) {
		return "SESSION_SECRET ו TOKEN_ENC_KEY צריכים להיות באורך 32 תווים לפחות. מחליפים אותם ב Settings ואז Variables and Secrets.";
	}
	return null;
}

/** Same-origin check for dashboard form posts (on top of SameSite cookies). */
export function sameOrigin(env: Env, req: Request): boolean {
	const origin = req.headers.get("Origin");
	return origin === new URL(env.PUBLIC_BASE_URL).origin;
}
