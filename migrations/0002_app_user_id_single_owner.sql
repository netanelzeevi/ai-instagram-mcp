-- Meta's deletion callbacks may send the app-scoped ID (id from /me) instead of the account ID we key on.
ALTER TABLE accounts ADD COLUMN app_user_id TEXT;
CREATE INDEX IF NOT EXISTS accounts_app_user ON accounts(app_user_id);

-- Sign-in moved from a GitHub allowlist to one owner password; existing accounts belong to that owner.
UPDATE accounts SET owner_login = 'owner';
