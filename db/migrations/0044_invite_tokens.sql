-- 0044_invite_tokens.sql
-- Token table for two flows:
--
--   1. New-user invite: admin creates a users row with NULL
--      password_hash and inserts an invite_tokens row with the
--      invitee's email. The invite email contains a link to
--      /set-password/<token>. When they hit it, they set a password
--      and the token is marked accepted.
--
--   2. Password reset: an authenticated user (or admin) requests a
--      reset. A token is inserted with kind='reset' and
--      target_user_id = the resetting user. They land on
--      /set-password/<token>, set a new password, token accepted.
--
-- Tokens are SINGLE-USE: accepted_at is set on first successful
-- consumption and the token is rejected thereafter. They also expire
-- (default 7 days for invites, 1 hour for resets) — the
-- /set-password page rejects expired tokens cleanly.
--
-- token_hash stores a SHA-256 hash of the raw token, never the raw
-- value. The raw token is sent in the email link and immediately
-- discarded server-side. This way a DB leak can't be used to
-- impersonate pending invites.

CREATE TABLE IF NOT EXISTS invite_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which team the invite is for. Default to the seeded BarCrawlConnect
  -- team so single-tenant works out of the box; future multi-tenant
  -- admin UI sets this explicitly.
  team_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid
    REFERENCES teams (id) ON DELETE CASCADE,

  -- Email the invite was sent to (case-insensitive lookup). For
  -- new-user invites this is the email that will become users.primary_email
  -- when accepted. For password resets it's the existing user's email.
  email text NOT NULL,

  -- 'invite' = new-user invite (creates a fresh users row on accept).
  -- 'reset'  = password reset for an existing user.
  kind text NOT NULL DEFAULT 'invite' CHECK (kind IN ('invite', 'reset')),

  -- For invites: the role the invited user will get when they accept.
  -- For resets: NULL (target user's role is unchanged).
  role text CHECK (role IS NULL OR role IN ('admin', 'lead', 'outreach', 'readonly')),

  -- For resets only: the user being reset. For invites this stays NULL
  -- until accept, then it points at the freshly-created users row
  -- (so we can audit which row this invite created).
  target_user_id uuid REFERENCES users (id) ON DELETE CASCADE,

  -- SHA-256 of the raw token. Indexed for the /set-password lookup.
  token_hash text NOT NULL,

  -- Who created the invite (an admin's users.id). NULL for self-
  -- service password reset flows (commit 5 may add one).
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,

  -- Token lifetime.
  expires_at timestamptz NOT NULL,
  -- Set when the invite is consumed; never reused after.
  accepted_at timestamptz,
  -- For invites: the users row the accept created. Helps audit
  -- "which invite produced this user". For resets: redundant with
  -- target_user_id but set anyway for symmetry.
  accepted_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS invite_tokens_hash_unique
  ON invite_tokens (token_hash);

-- Speeds up "show pending invites for this team" in the admin UI.
CREATE INDEX IF NOT EXISTS invite_tokens_team_pending_idx
  ON invite_tokens (team_id, accepted_at, expires_at);
