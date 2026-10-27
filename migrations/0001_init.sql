-- ai-instagram-mcp D1 schema. Multi-account from day one: every row belongs to an account.

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,                 -- Instagram professional account ID (user_id from /me)
  app_user_id TEXT,                    -- app-scoped ID (id from /me); Meta's deletion callbacks may send this one
  username TEXT NOT NULL,
  owner_login TEXT NOT NULL,           -- GitHub login that connected the account
  token_enc TEXT NOT NULL,             -- AES-GCM encrypted long-lived Instagram User token
  token_expires_at INTEGER NOT NULL,   -- ms epoch
  token_refreshed_at INTEGER NOT NULL, -- ms epoch
  scopes TEXT,
  approval_mode TEXT NOT NULL DEFAULT 'manual' CHECK (approval_mode IN ('manual', 'auto')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'token_error')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS accounts_owner ON accounts(owner_login);
CREATE INDEX IF NOT EXISTS accounts_app_user ON accounts(app_user_id);

-- Everything that changes something public on Instagram starts as a draft.
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  kind TEXT NOT NULL CHECK (kind IN ('post', 'comment_reply', 'dm', 'hide_comment')),
  payload TEXT NOT NULL,               -- JSON, shape depends on kind
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'processing', 'published', 'rejected', 'cancelled', 'failed')),
  created_by TEXT NOT NULL,            -- MCP client name + GitHub login
  note TEXT,                           -- why the agent proposed it
  proposed_at INTEGER,                 -- time the agent suggested (ms epoch)
  scheduled_at INTEGER,                -- time the owner approved for (ms epoch)
  approved_by TEXT,
  approved_at INTEGER,
  stage TEXT,                          -- publishing state machine: children | container | publish
  child_ids TEXT,                      -- JSON array of carousel child container IDs
  container_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  result TEXT,                         -- JSON (media id, permalink, message id...)
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS drafts_due ON drafts(status, scheduled_at);
CREATE INDEX IF NOT EXISTS drafts_account ON drafts(account_id, status);

-- Files hosted for Meta to fetch. Deleted after publishing, or after 7 days.
CREATE TABLE IF NOT EXISTS media (
  key TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- One-time upload links for agents (Grok Bot, Claude Code) that hold the file locally.
CREATE TABLE IF NOT EXISTS upload_links (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_key TEXT
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  account_id TEXT,
  action TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS audit_at ON audit(at);
