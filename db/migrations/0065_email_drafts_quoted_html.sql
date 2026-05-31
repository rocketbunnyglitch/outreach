-- 0065_email_drafts_quoted_html.sql
--
-- Splits the reply quote out of bodyHtml into its own column. The
-- composer renders bodyHtml in an editable richtext surface and
-- quotedHtml in a non-editable, collapsible "..." block below it,
-- matching Gmail's reply UX where the original message is hidden
-- behind an expand toggle.
--
-- compose-send-impl concatenates bodyHtml + quotedHtml on send so
-- the recipient receives the full message including the quote
-- regardless of whether the operator expanded it in the composer.
--
-- For drafts created before this migration, the quote (if any)
-- remains baked into bodyText only — those drafts continue to
-- render the existing way (no separate toggle). New drafts via
-- openReplyDraft get the structured split.

ALTER TABLE email_drafts
  ADD COLUMN IF NOT EXISTS quoted_html text;
