// Sign-in: GitHub is the identity provider for both the MCP OAuth flow and the dashboard.
// Only logins in ALLOWED_GITHUB_LOGINS get in.

import { randomId } from "./store";

const enc = new TextEncoder();
export const SESSION_COOKIE = "__Host-igmcp_session";
const DASH_STATE_COOKIE = "__Host-igmcp_dash_state";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function allowedLogins(env: Env): Set<string> {
	return new Set(
		env.ALLOWED_GITHUB_LOGINS.split(",")
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean),
	);
}

export function githubAuthorizeUrl(env: Env, state: string): string {
	const u = new URL("https://github.com/login/oauth/authorize");
	u.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
	u.searchParams.set("redirect_uri", `${env.PUBLIC_BASE_URL}/callback`);
	u.searchParams.set("scope", "read:user");
	u.searchParams.set("state", state);
	u.searchParams.set("allow_signup", "false");
	return u.href;
}

/** Exchanges a GitHub code and returns the login. The GitHub token is used once and dropped. */
export async function githubLogin(env: Env, code: string): Promise<string> {
	const res = await fetch("https://github.com/login/oauth/access_token", {
		method: "POST",
		headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: env.GITHUB_CLIENT_ID,
			client_secret: env.GITHUB_CLIENT_SECRET,
			code,
			redirect_uri: `${env.PUBLIC_BASE_URL}/callback`,
		}),
	});
	const body = (await res.json()) as { access_token?: string; error?: string };
	if (!body.access_token) throw new Error(`GitHub sign-in failed: ${body.error ?? res.status}`);
	const user = await fetch("https://api.github.com/user", {
		headers: { Authorization: `Bearer ${body.access_token}`, "User-Agent": "ai-instagram-mcp", Accept: "application/vnd.github+json" },
	});
	if (!user.ok) throw new Error(`GitHub user lookup failed: ${user.status}`);
	return ((await user.json()) as { login: string }).login;
}

// ---------- signed session cookie for the dashboard ----------

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

function cookie(req: Request, name: string): string | undefined {
	const raw = req.headers.get("Cookie") ?? "";
	for (const part of raw.split(/;\s*/)) {
		const i = part.indexOf("=");
		if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
	}
	return undefined;
}

export async function sessionCookie(env: Env, login: string): Promise<string> {
	const value = `${login}|${Date.now() + SESSION_TTL_MS}`;
	const signed = `${value}|${await hmac(env, value)}`;
	return `${SESSION_COOKIE}=${encodeURIComponent(signed)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export function clearSessionCookie(): string {
	return `${SESSION_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function sessionLogin(env: Env, req: Request): Promise<string | null> {
	const raw = cookie(req, SESSION_COOKIE);
	if (!raw) return null;
	const [login, exp, sig] = raw.split("|");
	if (!login || !exp || !sig) return null;
	if (!timingSafeEqual(sig, await hmac(env, `${login}|${exp}`))) return null;
	if (Number(exp) < Date.now()) return null;
	if (!allowedLogins(env).has(login.toLowerCase())) return null;
	return login;
}

/** Dashboard sign-in: state is prefixed so /callback can tell it apart from the MCP flow. */
export function beginDashboardLogin(env: Env): Response {
	const state = `dash.${randomId(18)}`;
	return new Response(null, {
		status: 302,
		headers: {
			Location: githubAuthorizeUrl(env, state),
			"Set-Cookie": `${DASH_STATE_COOKIE}=${state}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`,
		},
	});
}

export function checkDashboardState(req: Request, state: string): boolean {
	const expected = cookie(req, DASH_STATE_COOKIE);
	return !!expected && timingSafeEqual(expected, state);
}

export function clearDashStateCookie(): string {
	return `${DASH_STATE_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export { cookie as readCookie };

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
	const logins = allowedLogins(env);
	if (logins.size === 0 || logins.has("your-github-login")) {
		return "ב ALLOWED_GITHUB_LOGINS עדיין לא מופיע שם המשתמש שלכם ב GitHub. משנים אותו ב wrangler.jsonc ושומרים.";
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
