-- 0048_campaign_connected_accounts.sql
--
-- Many-to-many: which connected Gmail inboxes belong to which
-- campaign? An inbox can serve multiple campaigns (e.g. an outreach
-- lead's inbox covers all live campaigns); a campaign can have
-- multiple inboxes (multiple staff working on it).
--
-- Decision: assignment is independent of message routing. A thread
-- ingests via the inbox that received it; this table is purely the
-- admin's declaration of which inboxes are "for" this campaign —
-- used by the Campaign Info tab to filter listings, and by future
-- features like default-from-account on compose.
--
-- Decision: NOT team-scoped — the FK to campaigns implies team
-- already (campaigns are global in the current schema). The FK to
-- staff_outreach_emails carries its own team_id and the action
-- enforces both belong to the actor's team.
--
-- audit_by lets us answer "who assigned this inbox to the
-- campaign?". Null when the row predates the column or was created
-- by a system process.

CREATE TABLE IF NOT EXISTS campaign_connected_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  connected_account_id uuid NOT NULL
    REFERENCES connected_accounts (id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES users (id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS campaign_connected_accounts_unique
  ON campaign_connected_accounts (campaign_id, connected_account_id);

CREATE INDEX IF NOT EXISTS campaign_connected_accounts_campaign_idx
  ON campaign_connected_accounts (campaign_id);
CREATE INDEX IF NOT EXISTS campaign_connected_accounts_account_idx
  ON campaign_connected_accounts (connected_account_id);
