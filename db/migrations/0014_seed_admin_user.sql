-- =========================================================================
-- 0014_seed_admin_user.sql
--
-- Ensure toptorontoclubs@gmail.com (Bryle) exists in staff_members
-- with role='admin'. Idempotent: if the user already exists with a
-- different role, we promote them; if they don't exist, we insert
-- a baseline row.
--
-- This is the bootstrap admin — they get access to the /admin/*
-- screens (team analytics, audit log, bulk import, etc.) that are
-- hidden from outreach and readonly staff.
-- =========================================================================

DO $$
DECLARE
  existing_id uuid;
BEGIN
  SELECT id INTO existing_id
  FROM staff_members
  WHERE LOWER(primary_email) = 'toptorontoclubs@gmail.com'
  LIMIT 1;

  IF existing_id IS NOT NULL THEN
    -- Promote to admin if not already; preserve existing display_name
    UPDATE staff_members
    SET role = 'admin',
        status = 'active',
        updated_at = NOW()
    WHERE id = existing_id
      AND role <> 'admin';
  ELSE
    -- Insert new admin row. display_name defaults to 'Admin' — the
    -- operator updates this themselves from /settings/profile.
    INSERT INTO staff_members (
      id, primary_email, display_name, role, status,
      created_at, updated_at, version
    ) VALUES (
      gen_random_uuid(),
      'toptorontoclubs@gmail.com',
      'Admin',
      'admin',
      'active',
      NOW(), NOW(), 1
    );
  END IF;
END $$;
