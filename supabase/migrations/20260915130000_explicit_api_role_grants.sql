-- Restore API-role grants that Supabase preview branches fail to apply.
--
-- The schema has never issued explicit GRANTs: it relies on the platform's
-- default privileges giving anon / authenticated / service_role access to
-- objects the migrations create, with RLS doing the actual gating. On the
-- Prod project those default privileges are intact, but freshly provisioned
-- preview branches come up with a mangled default ACL for postgres-created
-- objects in `public` (tables: only TRUNCATE/REFERENCES/TRIGGER, sequences
-- and functions: nothing), so on a preview branch every table read fails
-- with "permission denied" — login lands every user, including the seeded
-- approved admin, on the pending page (observed on the PR #89 branch,
-- 2026-09-15).
--
-- This migration makes the intended grants explicit so environments no
-- longer depend on platform defaults. It is a no-op where grants already
-- match (Dev, Prod). Access control remains RLS's job; these grants mirror
-- what Prod has always had.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

-- The blanket EXECUTE grant above would undo the deliberate lockdowns from
-- 20260913140000_relock_security_definer_functions.sql, so re-apply them.

-- Internal helpers: only called from triggers or other SECURITY DEFINER
-- functions, never through the API.
REVOKE EXECUTE ON FUNCTION public.refresh_member_season_badges(int, int)             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_section_season_badge(text, text, int, int[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_section_season_badges(text, int)          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_member_grade_medal_badges(int)            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_lifetime_badge(int, text, boolean)            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_refresh_season_badges_on_log()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_refresh_grade_medal_badges()              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_refresh_badges_on_log()                   FROM PUBLIC, anon, authenticated;

-- Gated app functions: anon must not reach them at all; authenticated keeps
-- EXECUTE and the body gates decide.
REVOKE EXECUTE ON FUNCTION public.get_member_badges(int)          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_recent_achievements(int)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_member_badge_progress(int)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_member_current_grades(int)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_members_current_grades()    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_members_medal_counts()      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.refresh_all_member_badges()     FROM PUBLIC, anon;

-- Repair the default privileges too, so objects created by *later*
-- migrations on an affected branch get the same grants (matches the intact
-- default ACLs on Prod).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
