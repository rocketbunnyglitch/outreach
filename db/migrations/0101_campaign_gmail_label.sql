-- Phase: campaign Gmail auto-tagging.
-- Adds a per-campaign Gmail label string. The send pipeline auto-applies this
-- label (and the city name as a second label) to threads it sends for the
-- campaign, mirrored to Gmail via the existing team_labels machinery, so engine
-- sends are tagged identically to how staff manually label the campaign's mail.
-- NULL = no auto-tagging for the campaign.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS outreach_gmail_label text;
