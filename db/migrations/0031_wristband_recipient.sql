-- Migration 0031 — Wristband recipient name + phone
--
-- Operator session-12 P3: the wristband shipping table needs a "name
-- for mail" and a "phone" alongside the existing mailing address +
-- tracking + status. These are the recipient/courier-contact fields.

ALTER TABLE wristbands ADD COLUMN IF NOT EXISTS recipient_name  text;
ALTER TABLE wristbands ADD COLUMN IF NOT EXISTS recipient_phone text;
