-- Google profile picture for a connected inbox.
--
-- Captured from the userinfo `picture` URL when the account connects (or via a
-- "Sync from Gmail" action), once the userinfo.profile scope is granted. Shown
-- as the inbox avatar wherever the sending identity is surfaced. NULL until the
-- account reconnects with the new scope.
ALTER TABLE connected_accounts
  ADD COLUMN avatar_url TEXT;
