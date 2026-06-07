-- AI usage / spend log.
--
-- One row per Anthropic completion. The single generateCompletion() choke point
-- in lib/ai.ts records here (best-effort, fire-and-forget) so EVERY AI feature
-- is captured automatically. Token counts are exact (from the API response);
-- cost_usd is a snapshot computed at insert time from the price table in
-- lib/ai-usage.ts, so historical rows keep their cost even if list prices change.
--
-- Powers the admin AI-spend page at /admin/ai-usage. Append-only.

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Feature tag passed to generateCompletion (e.g. inbox_auto_classify).
  tag TEXT NOT NULL,
  -- Resolved model id from the API response (e.g. claude-haiku-4-5-20251001).
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  -- USD cost snapshot at insert time. NUMERIC(12,6) -> sub-cent precision.
  cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  -- Nullable: most calls don't carry a team context; single-team app for now.
  team_id UUID
);

CREATE INDEX IF NOT EXISTS ai_usage_events_created_at_idx ON ai_usage_events(created_at);
CREATE INDEX IF NOT EXISTS ai_usage_events_tag_created_idx ON ai_usage_events(tag, created_at);
