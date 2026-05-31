-- 0064_email_drafts_pending_label_ids.sql
--
-- Adds pending_label_ids text[] to email_drafts so the composer can
-- queue team_labels during a FRESH compose (no replyToThreadId
-- yet — there's no thread to apply to until after send).
--
-- Workflow:
--   1. Operator opens a new compose, clicks "+ Label" in the more
--      menu, picks one or more
--   2. Composer writes the choices to draft.pending_label_ids via
--      upsertDraft on each toggle
--   3. On send, sendDraftAsUser reads pending_label_ids and passes
--      them as labelIds in the composeAndSend FormData
--   4. compose-send-impl applies them to the newly-created thread
--      after the Gmail send completes (existing path)
--
-- For REPLY compose, the existing immediate-apply path stays
-- (applyLabelToThreadAction fires on each toggle since the thread
-- already exists). pending_label_ids is unused in that case.

ALTER TABLE email_drafts
  ADD COLUMN IF NOT EXISTS pending_label_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];
