# ai-instagram-mcp

Connect your own Instagram professional account to Claude, or to any AI app that speaks MCP,
through Meta's official **Instagram API with Instagram Login**. Your copy runs on your own free
Cloudflare account. No passwords, no browser automation, and nothing public happens without your click.

> **Don't copy anything.** No download, no fork, no new repo. Just click this button: it creates your own copy for you.

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
   creates the KV namespace and the D1 database, runs the database migrations and deploys.
   In the form:
   - `DASH_PASSWORD`: your password for this server, 12+ characters. It opens the dashboard and
     approves every AI app you connect
   - `PUBLIC_BASE_URL`: `BASE`, lowercase. Not sure? Leave it: `/dash` tells you the exact value
   - `TOKEN_ENC_KEY` and `SESSION_SECRET`: two different random strings of 32+ characters
     (a password manager's generator is fine)
2. **Check.** Open `BASE/dash`. If a setting is wrong, the page says which one and what to put there.
   Fix it in `wrangler.jsonc` in your new repo (the pencil icon on GitHub); every commit redeploys.
   When everything is right, you get a sign-in page. Sign in with your password: the empty dashboard lists
   the Meta settings for the next step at the bottom.
3. **Meta app.** At https://developers.facebook.com/apps create an app (no "ig" or "instagram" in the
   name), use case **Manage messaging & content on Instagram**. In Business login settings:
   - OAuth redirect URI: `BASE/ig/callback`
   - Deauthorize callback URL: `BASE/ig/deauthorize`
   - Data deletion request URL: `BASE/ig/data-deletion`

   Add the **Instagram app ID** and **Instagram app secret** (not the Meta App ID) as **Secrets**
   `IG_APP_ID` and `IG_APP_SECRET` in the Cloudflare dashboard: your Worker > Settings > Variables and Secrets > Add.
4. **Tester role.** Add your Instagram account under App roles > Roles as **Instagram Tester** and
   accept the invite in Instagram (instagram.com/accounts/manage_access > Tester invites).
   Without it, login fails with "Insufficient Developer Role".
5. **Connect Instagram.** `BASE/dash` > your password > connect your Instagram account.
6. **Go Live.** In the Meta app, App settings > Basic: paste the **Privacy policy URL** (`BASE/privacy`)
   and **Terms of service URL** (`BASE/terms`) that your server serves, pick an icon and a category,
   then switch App Mode at the top to **Live**. `/dash` lists every value to paste.
7. **Connect your AI app** with the MCP address `BASE/mcp` (below). The approval page asks for your password.

Never paste a secret into a chat, a file or this repo. Secrets go only into the Cloudflare
dashboard (or `wrangler secret put`).

## Connect an AI app

The server is a remote MCP server (Streamable HTTP) with OAuth, so it should work with any MCP client
that supports remote servers and OAuth sign-in. Every client is approved once with your password.

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
# edit wrangler.jsonc: PUBLIC_BASE_URL (lowercase)
npx wrangler secret put DASH_PASSWORD     # your password, 12+ characters
openssl rand -base64 32 | npx wrangler secret put TOKEN_ENC_KEY
openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET
npm run deploy                            # migrations + deploy; creates KV and D1 on the first run
npx wrangler secret put IG_APP_ID
npx wrangler secret put IG_APP_SECRET
```

## How it is built

- Cloudflare Worker + `@cloudflare/workers-oauth-provider` (OAuth 2.1 for MCP clients, `src/index.ts`)
- One owner password (`DASH_PASSWORD`) for the dashboard and the consent page, with a lockout after 10 wrong tries (`src/auth.ts`)
- Business Login for Instagram and token storage (`src/ig.ts`, `src/store.ts`)
- MCP tools (`src/mcp.ts`), approval dashboard (`src/dashboard.ts`), publisher state machine (`src/publisher.ts`)
- D1 for data (`migrations/`), KV for OAuth state, R2 (optional) for uploaded media

## What you can and can't do (checked against Meta's docs, 27.10.2026)

Can: publish an image, a carousel of up to 20 images or videos ([source](https://developers.facebook.com/docs/instagram-platform/content-publishing/)), a reel of 3 seconds to 15 minutes and a story of 3 to 60 seconds ([source](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/)), and a Trial Reel shown only to non-followers ([source](https://developers.facebook.com/docs/instagram-platform/content-publishing/)); read, reply to and hide comments ([source](https://developers.facebook.com/documentation/instagram-platform/comment-moderation)); read and answer DMs ([source](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api)); read insights per post, reel and story, including average watch time and the estimated skip rate ([source](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights)).

Can't, and limits:
- 100 API posts per 24 hours, a carousel counts as one; the carousel section of the same page says 50 ([source](https://developers.facebook.com/docs/instagram-platform/content-publishing/))
- JPEG images only; no shopping tags or filters ([source](https://developers.facebook.com/docs/instagram-platform/content-publishing/))
- No Instagram music library: music tagging is for original audio only ([source](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/))
- No editing after publishing except turning comments on or off; deleting is not available with Instagram Login ([source](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/))
- DMs only to people who wrote first, usually within 24 hours of their last message; no group chats ([source](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api))
- Insights can lag up to 48 hours, story insights last 24 hours, reels have no profile visits or follows ([source](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights)); some metrics need 100+ followers ([source](https://developers.facebook.com/documentation/instagram-platform/insights))
- Your own accounts only; other people's accounts need App Review ([source](https://developers.facebook.com/documentation/instagram-platform/comment-moderation))
- Claude Free allows one custom connector ([source](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp))

The API also offers collaborators, user tags, location and reel audio names; this template does not use them yet ([source](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/)).

## Local test

`test/harness.ts` runs the Worker against a fake Graph API:
`npx wrangler d1 migrations apply DB --local --persist-to .harness-state` once, then
`npx wrangler dev test/harness.ts --port 8790 --persist-to .harness-state` and open it: every value under `checks` should be `true`.

`test/e2e.py` signs in and runs the whole MCP OAuth flow (register, consent, token, tools) against
`npx wrangler dev --var PUBLIC_BASE_URL:http://127.0.0.1:8788`: `python3 test/e2e.py <your DASH_PASSWORD>`.

## Managed version

Don't want to run a server? A managed version is coming. Leave your details: WAITLIST_URL

## License

AGPL-3.0
