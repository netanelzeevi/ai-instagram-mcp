# ai-instagram-mcp

Connect your own Instagram professional account to Claude, or to any AI app that speaks MCP,
through Meta's official **Instagram API with Instagram Login**. Your copy runs on your own free
Cloudflare account. No passwords, no browser automation, and nothing public happens without your click.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/netanelzeevi/ai-instagram-mcp)

Hebrew README: [README.he.md](README.he.md). Full step-by-step guide (Hebrew, with screenshots):
https://netanelzeevi.com/articles/claude-instagram-official-api/

## What it does

- **Read:** profile, posts, comments, conversations, and insights (views, reach, shares, saves,
  average watch time and skip rate for reels).
- **Draft, never publish:** posts, carousels, comment replies, DMs and hiding comments become drafts.
  The only path from draft to Instagram is the approval page at `/dash`. There is no MCP tool that approves.
- **Schedule:** pick a time in `/dash`; a 5-minute cron publishes approved drafts.
- **Token safety:** the Instagram token is encrypted with AES-GCM in D1, never returned to the model,
  and refreshed daily. Removing the app in Instagram settings deletes the account from the server.

## What you need

- An Instagram **Creator** or **Business** account
- A Facebook account, for Meta for Developers
- Free **Cloudflare** and **GitHub** accounts
- No domain of your own: the server gets a free address on `workers.dev`
- The Cloudflare Workers free plan is enough for one account

## Set up (about 20 minutes, once)

`BASE` below is your server's address, `https://ai-instagram-mcp.<your-subdomain>.workers.dev`.

1. **Deploy.** Press **Deploy to Cloudflare** above. Cloudflare copies this repo to your GitHub,
   creates the KV namespace and the D1 database, runs the database migration and deploys.
   In the form:
   - `ALLOWED_GITHUB_LOGINS`: your GitHub username
   - `PUBLIC_BASE_URL`: `BASE`, lowercase. Not sure? Leave it: `/dash` tells you the exact value
   - `TOKEN_ENC_KEY` and `SESSION_SECRET`: two different random strings of 32+ characters
     (a password manager's generator is fine)
2. **Check.** Open `BASE/dash`. If a setting is wrong, the page says which one and what to put there.
   Fix it in `wrangler.jsonc` in your new repo (the pencil icon on GitHub); every commit redeploys.
3. **GitHub sign-in.** Create an OAuth app at https://github.com/settings/applications/new
   with Homepage `BASE` and callback `BASE/callback`. Add `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`
   as **Secrets** in the Cloudflare dashboard: your Worker > Settings > Variables and Secrets > Add.
4. **Meta app.** At https://developers.facebook.com/apps create an app (no "ig" or "instagram" in the
   name), use case **Manage messaging & content on Instagram**. In Business login settings:
   - OAuth redirect URI: `BASE/ig/callback`
   - Deauthorize callback URL: `BASE/ig/deauthorize`
   - Data deletion request URL: `BASE/ig/data-deletion`

   Add the **Instagram app ID** and **Instagram app secret** (not the Meta App ID) as Secrets
   `IG_APP_ID` and `IG_APP_SECRET`, the same way as in step 3.
5. **Tester role.** The app stays in development mode, so add your Instagram account under
   App roles > Roles as **Instagram Tester** and accept the invite in Instagram
   (instagram.com/accounts/manage_access > Tester invites). Without it, login fails with
   "Insufficient Developer Role".
6. **Connect Instagram.** `BASE/dash` > sign in with GitHub > connect your Instagram account.
7. **Connect your AI app** with the MCP address `BASE/mcp` (below).

Never paste a secret into a chat, a file or this repo. Secrets go only into the Cloudflare
dashboard (or `wrangler secret put`).

## Connect an AI app

The server is a remote MCP server (Streamable HTTP) with OAuth, so it should work with any MCP client
that supports remote servers and OAuth sign-in. Every client signs in through the same GitHub allowlist.

| App | How | Tested |
|---|---|---|
| Claude (web, desktop, mobile) | Customize > Connectors > Add custom connector, URL `BASE/mcp` | Yes |
| Claude Code | `claude mcp add --transport http instagram BASE/mcp`, then `/mcp` to sign in | Not yet |
| ChatGPT | Developer mode, then add a custom connector with `BASE/mcp` (depends on your plan) | Not yet |
| Cursor, VS Code and other MCP clients | Add a remote MCP server with `BASE/mcp` | Not yet |

## Set up from the terminal instead

```bash
npm install
npx wrangler login
# edit wrangler.jsonc: PUBLIC_BASE_URL (lowercase) and ALLOWED_GITHUB_LOGINS
openssl rand -base64 32 | npx wrangler secret put TOKEN_ENC_KEY
openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET
npx wrangler deploy            # creates the KV namespace and the D1 database on the first run
npm run db:migrate
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put IG_APP_ID
npx wrangler secret put IG_APP_SECRET
```

## How it is built

- Cloudflare Worker + `@cloudflare/workers-oauth-provider` (OAuth 2.1 for MCP clients, `src/index.ts`)
- GitHub OAuth sign-in, limited to `ALLOWED_GITHUB_LOGINS` (`src/auth.ts`)
- Business Login for Instagram and token storage (`src/ig.ts`, `src/store.ts`)
- MCP tools (`src/mcp.ts`), approval dashboard (`src/dashboard.ts`), publisher state machine (`src/publisher.ts`)
- D1 for data (`migrations/`), KV for OAuth state, R2 (optional) for uploaded media

## Limits (from Meta's docs)

JPEG only for images; no library music, filters or shopping tags; DMs only within 24 hours of the
person's last message; some insights need 100+ followers and can lag up to 48 hours; 100 API posts per 24 hours.
Using it for accounts you don't own requires Meta App Review and Business Verification.

## Local test

`test/harness.ts` runs the Worker against a fake Graph API:
`npx wrangler d1 migrations apply DB --local` once, then
`npx wrangler dev test/harness.ts --port 8790 --persist-to .harness-state`.

## Managed version

Don't want to run a server? A managed version is coming. Leave your details: WAITLIST_URL

## License

AGPL-3.0
