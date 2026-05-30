-- 0056_connected_account_signatures.sql
--
-- Per-inbox email signature for the global composer.
--
-- Each connected_account can carry an HTML signature that's appended
-- to outbound mail sent FROM that inbox. The composer also exposes a
-- per-draft override (kept in email_drafts.body_html — operators can
-- delete the signature inline before sending).
--
-- HTML stored (not plain text) because operators typically want links,
-- logos, formatting. The composer's sanitiseHtml() runs over any
-- value before send, so we don't trust arbitrary HTML even though
-- only admins can edit signatures.
--
-- NULL signature = use no signature. Migrating zero-default means
-- existing inboxes start with no signature; admins opt in per inbox
-- from /settings/inboxes.

ALTER TABLE connected_accounts
    ADD COLUMN IF NOT EXISTS signature_html text;
