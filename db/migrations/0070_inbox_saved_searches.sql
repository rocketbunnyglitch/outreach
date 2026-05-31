-- Phase B — Saved searches per operator.
--
-- Operators repeatedly run the same searches ("Toronto + warm
-- + last 7d"). Let them save these as named one-click filters
-- that show up in a sidebar pulldown.
--
-- Per-user (user_id) so each operator has their own saved set.
-- Display name + the raw query string (which goes through the
-- existing parseSearchQuery on every load — saved searches
-- aren't pre-parsed, they're pinned text).
--
-- No FK to the inbox engine — search strings are just strings.
-- An operator can save a search for an operator they no longer
-- have visibility on; running it just returns no results.

CREATE TABLE IF NOT EXISTS inbox_saved_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Owner of the saved search.
  user_id uuid NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,

  -- Display name in the sidebar dropdown. 80 char cap.
  label text NOT NULL,

  -- The raw search string, as the operator typed it. Goes
  -- through parseSearchQuery on every load — so operators can
  -- save complex queries like
  --   "from:manny is:unread Toronto"
  -- and they'll behave the same as if typed live.
  query_text text NOT NULL,

  -- Display order in the dropdown. Lower number = higher on
  -- the list. NULL means "append at the end."
  sort_order integer,

  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- Per-user uniqueness on label so the operator can't accidentally
-- create two "Toronto warms" entries that look identical.
CREATE UNIQUE INDEX IF NOT EXISTS inbox_saved_searches_user_label_unique
  ON inbox_saved_searches (user_id, lower(label));

-- Read pattern: SELECT * WHERE user_id = $1 ORDER BY sort_order
-- NULLS LAST, label.
CREATE INDEX IF NOT EXISTS inbox_saved_searches_user_sort_idx
  ON inbox_saved_searches (user_id, sort_order NULLS LAST, label);
