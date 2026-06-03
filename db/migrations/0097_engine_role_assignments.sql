-- =========================================================================
-- 0097_engine_role_assignments.sql
--
-- Engine function-role assignments (Admin -> Roles tab). Maps a stable
-- role_key (lifecycle_owner, wristband_coordinator, host_payment_coordinator,
-- graphics_designer, campaign_manager) to the user who currently fills it, so
-- the engine resolves "who owns post-confirm emails / wristbands / payments"
-- from configuration instead of hardcoded user IDs. One assignment per
-- (team, role_key); user_id NULL = unassigned (engine falls back, e.g. to the
-- city lead for the lifecycle owner).
--
-- Distinct from users.role (the system permission role Admin/Lead/Outreach/
-- Read-only), which stays where it is.
--
-- Schema mirror: db/schema/engine-role-assignments.ts.
-- =========================================================================

CREATE TABLE engine_role_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX engine_role_assignments_team_role_unique
  ON engine_role_assignments(team_id, role_key);
CREATE INDEX engine_role_assignments_user_idx ON engine_role_assignments(user_id);
