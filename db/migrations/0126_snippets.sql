-- Snippets / text-expander (Tier-2).
--
-- Team-scoped reusable body fragments the composer inserts when an operator
-- types a trigger token after ";" (e.g. ";intro"). The body may contain
-- {{merge_fields}}; the composer renders them through the same merge context
-- it uses for templates before inserting. Display/insert only -- snippets have
-- ZERO involvement in the send path or the send-safety boundary.
--
-- IF NOT EXISTS keeps the migration safe to re-run. Standard audit columns +
-- archived_at soft-delete per CLAUDE.md section 6.
CREATE TABLE IF NOT EXISTS snippets (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  -- Trigger token, stored WITHOUT the leading ";" (e.g. "intro").
  trigger text NOT NULL,
  -- Short human label shown in the admin list + the composer popover.
  label text NOT NULL,
  -- The body fragment. May contain {{merge_fields}} -- rendered on insert.
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  archived_at timestamptz
);

-- One active trigger per team, case-insensitive. drizzle-kit cannot express a
-- partial + lower() unique, so it is hand-written here (the schema declares a
-- plain helper index only).
CREATE UNIQUE INDEX IF NOT EXISTS snippets_team_trigger_unique
  ON snippets (team_id, lower(trigger))
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS snippets_team_idx
  ON snippets (team_id)
  WHERE archived_at IS NULL;
