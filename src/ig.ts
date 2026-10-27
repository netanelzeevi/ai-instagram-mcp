// Instagram API with Instagram Login (graph.instagram.com).
// Endpoints follow developers.facebook.com/docs/instagram-platform (checked 2026-10-24).

import { type Account, decryptToken, encryptToken, audit } from "./store";

const GRAPH = "https://graph.instagram.com";

export class IgError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly body: unknown,
	) {
		super(message);
	}
}

type Params = Record<string, string | number | boolean | undefined>;

function qs(params: Params): string {
	const sp = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) if (v !== undefined) sp.set(k, String(v));
	const s = sp.toString();
	return s ? `?${s}` : "";
}

async function parse(res: Response): Promise<any> {
	const text = await res.text();
	let body: any = text;
	try {
		body = JSON.parse(text);
	} catch {}
	if (!res.ok || (body && typeof body === "object" && body.error)) {
		const msg = body?.error?.message ?? (typeof body === "string" ? body.slice(0, 300) : res.statusText);
		throw new IgError(`Instagram API: ${msg}`, res.status, body);
	}
	return body;
}

/** A call against graph.instagram.com as one connected account. The token never leaves this module. */
export class IgClient {
	private constructor(
		private env: Env,
		readonly account: Account,
		private token: string,
	) {}

	static async for(env: Env, account: Account): Promise<IgClient> {
		if (account.token_expires_at < Date.now()) {
			throw new Error(`The Instagram token for @${account.username} expired. Reconnect it from the dashboard.`);
		}
		return new IgClient(env, account, await decryptToken(env, account.token_enc));
	}

	private url(path: string): string {
		return `${GRAPH}/${this.env.IG_API_VERSION}/${path.replace(/^\//, "")}`;
	}

	async get(path: string, params: Params = {}): Promise<any> {
		return parse(await fetch(this.url(path) + qs(params), { headers: { Authorization: `Bearer ${this.token}` } }));
	}

	async post(path: string, params: Params = {}): Promise<any> {
		return parse(
			await fetch(this.url(path) + qs(params), {
				method: "POST",
				headers: { Authorization: `Bearer ${this.token}` },
			}),
		);
	}

	async postJson(path: string, body: unknown): Promise<any> {
		return parse(
			await fetch(this.url(path), {
				method: "POST",
				headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
				body: JSON.stringify(body),
			}),
		);
	}
}

// ---------- Business Login for Instagram ----------

export function authorizeUrl(env: Env, state: string): string {
	const u = new URL("https://www.instagram.com/oauth/authorize");
	u.searchParams.set("client_id", env.IG_APP_ID);
	u.searchParams.set("redirect_uri", `${env.PUBLIC_BASE_URL}/ig/callback`);
	u.searchParams.set("response_type", "code");
	u.searchParams.set("scope", env.IG_SCOPES);
	u.searchParams.set("state", state);
	return u.href;
}

export type ConnectedToken = {
	token: string;
	expiresAt: number;
	permissions: string | null;
	userId: string;
	appUserId: string;
	username: string;
};

/** code -> short-lived token -> long-lived token (60 days) -> profile. Server-side only. */
export async function exchangeCode(env: Env, rawCode: string): Promise<ConnectedToken> {
	const code = rawCode.replace(/#_$/, "");
	const short = await parse(
		await fetch("https://api.instagram.com/oauth/access_token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: env.IG_APP_ID,
				client_secret: env.IG_APP_SECRET,
				grant_type: "authorization_code",
				redirect_uri: `${env.PUBLIC_BASE_URL}/ig/callback`,
				code,
			}),
		}),
	);
	// The docs show the result wrapped in a data array; older responses were flat.
	const first = Array.isArray(short?.data) ? short.data[0] : short;
	const shortToken: string = first?.access_token;
	if (!shortToken) throw new Error("Instagram did not return an access token.");

	const long = await parse(
		await fetch(
			`${GRAPH}/access_token${qs({ grant_type: "ig_exchange_token", client_secret: env.IG_APP_SECRET, access_token: shortToken })}`,
		),
	);
	const me = await parse(
		await fetch(`${GRAPH}/${env.IG_API_VERSION}/me${qs({ fields: "id,user_id,username" })}`, {
			headers: { Authorization: `Bearer ${long.access_token}` },
		}),
	);
	return {
		token: long.access_token,
		expiresAt: Date.now() + Number(long.expires_in ?? 5184000) * 1000,
		permissions: Array.isArray(first?.permissions) ? first.permissions.join(",") : (first?.permissions ?? null),
		userId: String(me.user_id ?? me.id),
		appUserId: String(me.id),
		username: me.username,
	};
}

/** Refresh rules (docs): token at least 24h old, not expired, instagram_business_basic granted. */
export async function refreshAccountToken(env: Env, account: Account): Promise<void> {
	const current = await decryptToken(env, account.token_enc);
	try {
		const res = await parse(
			await fetch(`${GRAPH}/refresh_access_token${qs({ grant_type: "ig_refresh_token", access_token: current })}`),
		);
		const now = Date.now();
		await env.DB.prepare(
			"UPDATE accounts SET token_enc = ?, token_expires_at = ?, token_refreshed_at = ?, status = 'active', updated_at = ? WHERE id = ?",
		)
			.bind(await encryptToken(env, res.access_token), now + Number(res.expires_in) * 1000, now, now, account.id)
			.run();
		await audit(env, "cron", "token.refresh", account.id, { expires_in: res.expires_in });
	} catch (e) {
		await env.DB.prepare("UPDATE accounts SET status = 'token_error', updated_at = ? WHERE id = ?")
			.bind(Date.now(), account.id)
			.run();
		await audit(env, "cron", "token.refresh_failed", account.id, { error: String(e) });
	}
}
