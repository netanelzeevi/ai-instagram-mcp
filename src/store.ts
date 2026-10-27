// D1 access, token encryption and audit log.

export type ApprovalMode = "manual" | "auto";

export type Account = {
	id: string;
	app_user_id: string | null;
	username: string;
	owner_login: string;
	token_enc: string;
	token_expires_at: number;
	token_refreshed_at: number;
	scopes: string | null;
	approval_mode: ApprovalMode;
	status: "active" | "token_error";
	created_at: number;
	updated_at: number;
};

export type DraftKind = "post" | "comment_reply" | "dm" | "hide_comment";
export type DraftStatus =
	| "pending"
	| "approved"
	| "processing"
	| "published"
	| "rejected"
	| "cancelled"
	| "failed";

export type Draft = {
	id: string;
	account_id: string;
	kind: DraftKind;
	payload: string;
	status: DraftStatus;
	created_by: string;
	note: string | null;
	proposed_at: number | null;
	scheduled_at: number | null;
	approved_by: string | null;
	approved_at: number | null;
	stage: string | null;
	child_ids: string | null;
	container_id: string | null;
	attempts: number;
	result: string | null;
	error: string | null;
	created_at: number;
	updated_at: number;
};

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(bytes: ArrayBuffer | Uint8Array): string {
	const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let s = "";
	for (const b of u8) s += String.fromCharCode(b);
	return btoa(s);
}

function unb64(s: string): Uint8Array {
	return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export function randomId(bytes = 16): string {
	const u8 = crypto.getRandomValues(new Uint8Array(bytes));
	return b64(u8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256(text: string): Promise<string> {
	return b64(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

/** 32 random bytes in base64 are used as is; any other string of 32+ characters is hashed into the key. */
async function tokenKey(env: Env): Promise<CryptoKey> {
	const secret = env.TOKEN_ENC_KEY ?? "";
	let raw: Uint8Array | null = null;
	try {
		raw = unb64(secret);
	} catch {}
	if (!raw || raw.length !== 32) {
		if (secret.length < 32) throw new Error("TOKEN_ENC_KEY must be at least 32 characters");
		raw = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(secret)));
	}
	return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(env: Env, token: string): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await tokenKey(env), enc.encode(token));
	return `${b64(iv)}.${b64(ct)}`;
}

export async function decryptToken(env: Env, value: string): Promise<string> {
	const [iv, ct] = value.split(".");
	const pt = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: unb64(iv) },
		await tokenKey(env),
		unb64(ct),
	);
	return dec.decode(pt);
}

export async function audit(
	env: Env,
	actor: string,
	action: string,
	accountId: string | null,
	detail?: unknown,
): Promise<void> {
	await env.DB.prepare("INSERT INTO audit (at, actor, account_id, action, detail) VALUES (?, ?, ?, ?, ?)")
		.bind(Date.now(), actor, accountId, action, detail === undefined ? null : JSON.stringify(detail))
		.run();
}

export async function accountsForOwner(env: Env, login: string): Promise<Account[]> {
	const { results } = await env.DB.prepare("SELECT * FROM accounts WHERE owner_login = ? ORDER BY created_at")
		.bind(login)
		.all<Account>();
	return results;
}

/** Picks the account an MCP call refers to. Never crosses owners. */
export async function resolveAccount(env: Env, login: string, username?: string): Promise<Account> {
	const accounts = await accountsForOwner(env, login);
	if (accounts.length === 0) {
		throw new Error("No Instagram account is connected yet. Connect one from the dashboard first.");
	}
	if (username) {
		const wanted = username.replace(/^@/, "").toLowerCase();
		const match = accounts.find((a) => a.username.toLowerCase() === wanted);
		if (!match) throw new Error(`Account @${wanted} is not connected for this user.`);
		return match;
	}
	if (accounts.length > 1) {
		throw new Error(
			`Several accounts are connected (${accounts.map((a) => "@" + a.username).join(", ")}). Pass "account".`,
		);
	}
	return accounts[0];
}

export async function upsertAccount(
	env: Env,
	a: Omit<Account, "created_at" | "updated_at" | "approval_mode" | "status">,
): Promise<void> {
	const now = Date.now();
	const existing = await env.DB.prepare("SELECT owner_login FROM accounts WHERE id = ?")
		.bind(a.id)
		.first<{ owner_login: string }>();
	if (existing && existing.owner_login !== a.owner_login) {
		throw new Error("This Instagram account is already connected by another user.");
	}
	await env.DB.prepare(
		`INSERT INTO accounts (id, app_user_id, username, owner_login, token_enc, token_expires_at, token_refreshed_at, scopes, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET app_user_id = excluded.app_user_id, username = excluded.username, token_enc = excluded.token_enc,
		   token_expires_at = excluded.token_expires_at, token_refreshed_at = excluded.token_refreshed_at,
		   scopes = excluded.scopes, status = 'active', updated_at = excluded.updated_at`,
	)
		.bind(a.id, a.app_user_id, a.username, a.owner_login, a.token_enc, a.token_expires_at, a.token_refreshed_at, a.scopes, now, now)
		.run();
}

export async function getDraft(env: Env, id: string): Promise<Draft | null> {
	return env.DB.prepare("SELECT * FROM drafts WHERE id = ?").bind(id).first<Draft>();
}

export async function insertDraft(
	env: Env,
	d: {
		account: Account;
		kind: DraftKind;
		payload: unknown;
		createdBy: string;
		note?: string;
		proposedAt?: number;
	},
): Promise<Draft> {
	const now = Date.now();
	const id = "d_" + randomId(9);
	// "auto" accounts (future clients) skip the owner's approval; "manual" accounts never do.
	const auto = d.account.approval_mode === "auto";
	await env.DB.prepare(
		`INSERT INTO drafts (id, account_id, kind, payload, status, created_by, note, proposed_at, scheduled_at, approved_by, approved_at, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			id,
			d.account.id,
			d.kind,
			JSON.stringify(d.payload),
			auto ? "approved" : "pending",
			d.createdBy,
			d.note ?? null,
			d.proposedAt ?? null,
			auto ? (d.proposedAt ?? now) : null,
			auto ? "auto" : null,
			auto ? now : null,
			now,
			now,
		)
		.run();
	await audit(env, d.createdBy, "draft.create", d.account.id, { id, kind: d.kind, auto });
	return (await getDraft(env, id))!;
}

export async function updateDraft(env: Env, id: string, fields: Partial<Draft>): Promise<void> {
	const keys = Object.keys(fields) as (keyof Draft)[];
	if (keys.length === 0) return;
	const sets = keys.map((k) => `${k} = ?`).join(", ");
	await env.DB.prepare(`UPDATE drafts SET ${sets}, updated_at = ? WHERE id = ?`)
		.bind(...keys.map((k) => fields[k] ?? null), Date.now(), id)
		.run();
}

// Deletes everything stored for the account (drafts hold DM texts and recipient ids), keeping one audit row
// for the request. Matches either Meta ID, since the callback may send the app-scoped one.
// Children first: drafts.account_id references accounts(id).
export async function forgetAccount(env: Env, metaUserId: string, reason: string): Promise<void> {
	const acc = await env.DB.prepare("SELECT id FROM accounts WHERE id = ? OR app_user_id = ?").bind(metaUserId, metaUserId).first<{ id: string }>();
	const id = acc?.id ?? metaUserId;
	const keys = (await env.DB.prepare("SELECT key FROM media WHERE account_id = ?").bind(id).all<{ key: string }>()).results;
	for (const { key } of keys) await env.MEDIA?.delete(key);
	await env.DB.batch(
		["drafts", "media", "upload_links", "audit"]
			.map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE account_id = ?`).bind(id))
			.concat(env.DB.prepare("DELETE FROM accounts WHERE id = ?").bind(id)),
	);
	await audit(env, "meta", reason, id, { meta_user_id: metaUserId });
}
