-- ============================================================
-- Admin Role & RLS Policies for app_settings / schedule_overrides
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Set Logan's account as admin (using app_metadata, which is server-side only)
-- Replace the UUID below with your actual Supabase user ID
UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data || '{"role": "admin"}'::jsonb
WHERE id = '79106bc2-d81a-4817-9332-7b6157541497';

-- 2. Drop any existing permissive policies on these tables
DROP POLICY IF EXISTS "Allow all authenticated" ON app_settings;
DROP POLICY IF EXISTS "Allow all for authenticated" ON app_settings;
DROP POLICY IF EXISTS "Anyone can read" ON app_settings;
DROP POLICY IF EXISTS "Admin can write" ON app_settings;
DROP POLICY IF EXISTS "Allow all authenticated" ON schedule_overrides;
DROP POLICY IF EXISTS "Allow all for authenticated" ON schedule_overrides;
DROP POLICY IF EXISTS "Anyone can read" ON schedule_overrides;
DROP POLICY IF EXISTS "Admin can write" ON schedule_overrides;

-- 3. Enable RLS (idempotent)
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_overrides ENABLE ROW LEVEL SECURITY;

-- 4. app_settings: all authenticated users can read
CREATE POLICY "Anyone can read" ON app_settings
  FOR SELECT
  TO authenticated
  USING (true);

-- 5. app_settings: only admin can insert/update/delete
--    (The server function uses the service role key, which bypasses RLS.
--     This policy is defense-in-depth: even if someone crafts a direct
--     Supabase client call, non-admins can't write.)
CREATE POLICY "Admin can write" ON app_settings
  FOR ALL
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  )
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- 6. schedule_overrides: all authenticated users can read
CREATE POLICY "Anyone can read" ON schedule_overrides
  FOR SELECT
  TO authenticated
  USING (true);

-- 7. schedule_overrides: only admin can insert/update/delete
CREATE POLICY "Admin can write" ON schedule_overrides
  FOR ALL
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  )
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );
