-- 0058_email_drafts_reply_context.sql
--
-- Adds reply / forward context to email_drafts so the global composer
-- can drive replies the same way it drives new mail, instead of the
-- inline ReplyComposer being a separate component.
--
-- mode      — discriminator. "new" (default) for fresh composes;
--             "reply" or "forward" for thread-anchored drafts. Adding
--             "reply_all" too since the UI exposes it as a distinct
--             action — operators expect to see what they picked
--             when re-opening the draft.
--
-- reply_to_thread_id     — FK to email_threads.id. On send, the
--                          compose pipeline uses this to attach the
--                          new message to the existing Gmail thread
--                          (matching the thread's gmail_thread_id +
--                          adding In-Reply-To/References headers).
--
-- reply_to_message_id    — Optional FK to email_messages.id. When
--                          set, drives In-Reply-To + References
--                          precisely against that message (Gmail's
--                          "reply to this specific message"
--                          semantic). Falls back to the latest
--                          message in the thread when null.
--
-- All three are nullable; existing drafts (mode=NULL) implicitly
-- behave as "new" — backward compatible.

ALTER TABLE email_drafts
    ADD COLUMN IF NOT EXISTS mode text,
    ADD COLUMN IF NOT EXISTS reply_to_thread_id uuid REFERENCES email_threads(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS reply_to_message_id uuid REFERENCES email_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS email_drafts_reply_thread_idx
    ON email_drafts (reply_to_thread_id)
    WHERE reply_to_thread_id IS NOT NULL;
