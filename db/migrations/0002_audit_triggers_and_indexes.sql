-- =========================================================================
-- 0002_audit_triggers_and_indexes.sql
--
-- Runs after 0001_init creates the tables. Attaches the three triggers
-- (touch_updated_at, bump_version, audit) to every applicable table, and
-- creates the spatial GiST indexes that Drizzle doesn't emit.
--
-- Pattern per table:
--   1. BEFORE UPDATE → touch_updated_at_func    (every mutable table)
--   2. BEFORE UPDATE → bump_version_func        (only tables with `version` col)
--   3. AFTER INSERT OR UPDATE OR DELETE → audit_trigger_func   (audited tables)
--
-- Exclusions:
--   - audit_log itself (would cause infinite recursion)
--   - email_validations (high churn, low forensic value)
--   - outreach_log gets INSERT audit only (append-only by design)
--   - email_threads, reply_inbox, staff_info_sheets, saved_filters get
--     touch+bump but no audit trigger (rapid system updates, low forensic
--     value vs noise)
-- =========================================================================

-- ============= outreach_brands ============================================
CREATE TRIGGER outreach_brands_touch_updated_at BEFORE UPDATE ON outreach_brands
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();
CREATE TRIGGER outreach_brands_bump_version BEFORE UPDATE ON outreach_brands
  FOR EACH ROW EXECUTE FUNCTION bump_version_func();
CREATE TRIGGER outreach_brands_audit AFTER INSERT OR UPDATE OR DELETE ON outreach_brands
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ============= crawl_brands ===============================================
CREATE TRIGGER crawl_brands_touch_updated_at BEFORE UPDATE ON crawl_brands
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();
CREATE TRIGGER crawl_brands_bump_version BEFORE UPDATE ON crawl_brands
  FOR EACH ROW EXECUTE FUNCTION bump_version_func();
CREATE TRIGGER crawl_brands_audit AFTER INSERT OR UPDATE OR DELETE ON crawl_brands
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ============= staff_members ==============================================
CREATE TRIGGER staff_members_touch_updated_at BEFORE UPDATE ON staff_members
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();
CREATE TRIGGER staff_members_bump_version BEFORE UPDATE ON staff_members
  FOR EACH ROW EXECUTE FUNCTION bump_version_func();
CREATE TRIGGER staff_members_audit AFTER INSERT OR UPDATE OR DELETE ON staff_members
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ============= staff_outreach_emails ======================================
CREATE TRIGGER staff_outreach_emails_touch_updated_at BEFORE UPDATE ON staff_outreach_emails
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();
CREATE TRIGGER staff_outreach_emails_bump_version BEFORE UPDATE ON staff_outreach_emails
  FOR EACH ROW EXECUTE FUNCTION bump_version_func();
CREATE TRIGGER staff_outreach_emails_audit AFTER INSERT OR UPDATE OR DELETE ON staff_outreach_emails
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ============= cities =====================================================
CREATE TRIGGER cities_touch_updated_at BEFORE UPDATE ON cities
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();
CREATE TRIGGER cities_bump_version BEFORE UPDATE ON cities
  FOR EACH ROW EXECUTE FUNCTION bump_version_func();
CREATE TRIGGER cities_audit AFTER INSERT OR UPDATE OR DELETE ON cities
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ============= campaigns ==================================================
CREATE TRIGGER campaigns_touch_updated_at BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();
CREATE TRIGGER campaigns_bump_version BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION bump_version_func();
CREATE TRIGGER campaigns_audit AFTER INSERT OR UPDATE OR DELETE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ============= city_campaigns =============================================
CREATE TRIGGER city_campaigns_touch_updated_at BEFORE UPDATE ON city_campaigns
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();
CREATE TRIGGER city_campaigns_bump_version BEFORE UPDATE ON city_campaigns
  FOR EACH ROW EXECUTE FUNCTION bump_version_func();
CREATE TRIGGER city_campaigns_audit AFTER INSERT OR UPDATE OR DELETE ON city_campaigns
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ============= events =====================================================
CREATE TRIGGER events_touch_updated_at BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();
CREATE TRIGGER events_bump_version BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION bump_version_func();
CREATE TRIGGER events_audit AFTER INSERT OR UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ============= venues =====================================================
CREATE TRIGGER venues_touch_updated_at BEFORE UPDATE ON venues
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();
CREATE TRIGGER venues_bump_version BEFORE UPDATE ON venues
  FOR EACH ROW EXECUTE FUNCTION bump_version_func();
CREATE TRIGGER venues_audit AFTER INSERT OR UPDATE OR DELETE ON venues
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ============= venue_events ===============================================
CREATE TRIGGER venue_events_touch_updated_at BEFORE UPDATE ON venue_events
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();
CREATE TRIGGER venue_events_bump_version BEFORE UPDATE ON venue_events
  FOR EACH ROW EXECUTE FUNCTION bump_version_func();
CREATE TRIGGER venue_events_audit AFTER INSERT OR UPDATE OR DELETE ON venue_events
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ============= outreach_log (INSERT only — append-only) ===================
CREATE TRIGGER outreach_log_audit AFTER INSERT ON outreach_log
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ============= email_threads (touch+bump, no audit) =======================
CREATE TRIGGER email_threads_touch_updated_at BEFORE UPDATE ON email_threads
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();
CREATE TRIGGER email_threads_bump_version BEFORE UPDATE ON email_threads
  FOR EACH ROW EXECUTE FUNCTION bump_version_func();

-- ============= reply_inbox (touch only) ===================================
CREATE TRIGGER reply_inbox_touch_updated_at BEFORE UPDATE ON reply_inbox
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();

-- ============= wristbands =================================================
CREATE TRIGGER wristbands_touch_updated_at BEFORE UPDATE ON wristbands
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();
CREATE TRIGGER wristbands_bump_version BEFORE UPDATE ON wristbands
  FOR EACH ROW EXECUTE FUNCTION bump_version_func();
CREATE TRIGGER wristbands_audit AFTER INSERT OR UPDATE OR DELETE ON wristbands
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ============= tasks ======================================================
CREATE TRIGGER tasks_touch_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();
CREATE TRIGGER tasks_bump_version BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION bump_version_func();
CREATE TRIGGER tasks_audit AFTER INSERT OR UPDATE OR DELETE ON tasks
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ============= staff_info_sheets (touch+bump, no audit) ===================
CREATE TRIGGER staff_info_sheets_touch_updated_at BEFORE UPDATE ON staff_info_sheets
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();
CREATE TRIGGER staff_info_sheets_bump_version BEFORE UPDATE ON staff_info_sheets
  FOR EACH ROW EXECUTE FUNCTION bump_version_func();

-- ============= email_templates ============================================
CREATE TRIGGER email_templates_touch_updated_at BEFORE UPDATE ON email_templates
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();
CREATE TRIGGER email_templates_bump_version BEFORE UPDATE ON email_templates
  FOR EACH ROW EXECUTE FUNCTION bump_version_func();
CREATE TRIGGER email_templates_audit AFTER INSERT OR UPDATE OR DELETE ON email_templates
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ============= poster_templates ===========================================
CREATE TRIGGER poster_templates_touch_updated_at BEFORE UPDATE ON poster_templates
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();
CREATE TRIGGER poster_templates_bump_version BEFORE UPDATE ON poster_templates
  FOR EACH ROW EXECUTE FUNCTION bump_version_func();
CREATE TRIGGER poster_templates_audit AFTER INSERT OR UPDATE OR DELETE ON poster_templates
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ============= goals ======================================================
CREATE TRIGGER goals_touch_updated_at BEFORE UPDATE ON goals
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();
CREATE TRIGGER goals_bump_version BEFORE UPDATE ON goals
  FOR EACH ROW EXECUTE FUNCTION bump_version_func();
CREATE TRIGGER goals_audit AFTER INSERT OR UPDATE OR DELETE ON goals
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ============= financial_lines ============================================
CREATE TRIGGER financial_lines_touch_updated_at BEFORE UPDATE ON financial_lines
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();
CREATE TRIGGER financial_lines_bump_version BEFORE UPDATE ON financial_lines
  FOR EACH ROW EXECUTE FUNCTION bump_version_func();
CREATE TRIGGER financial_lines_audit AFTER INSERT OR UPDATE OR DELETE ON financial_lines
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ============= saved_filters (touch+bump, no audit) =======================
CREATE TRIGGER saved_filters_touch_updated_at BEFORE UPDATE ON saved_filters
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();
CREATE TRIGGER saved_filters_bump_version BEFORE UPDATE ON saved_filters
  FOR EACH ROW EXECUTE FUNCTION bump_version_func();

-- ============= notes ======================================================
CREATE TRIGGER notes_touch_updated_at BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at_func();
CREATE TRIGGER notes_audit AFTER INSERT OR UPDATE OR DELETE ON notes
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- =========================================================================
-- Spatial GiST indexes (Drizzle doesn't emit these for PostGIS custom types)
-- =========================================================================
CREATE INDEX IF NOT EXISTS cities_location_gist ON cities USING GIST (location);
CREATE INDEX IF NOT EXISTS venues_location_gist ON venues USING GIST (location);
