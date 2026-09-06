-----------------
-- User management: profiles, roles, approval flow
-----------------

-- Enums
CREATE TYPE public.user_status AS ENUM ('pending', 'approved', 'disabled');
CREATE TYPE public.user_role   AS ENUM ('viewer', 'trainer', 'admin');

-- Profiles table, one row per auth.users row
CREATE TABLE public.user_profiles (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text NOT NULL,
  full_name   text,
  avatar_url  text,
  status      public.user_status NOT NULL DEFAULT 'pending',
  role        public.user_role   NOT NULL DEFAULT 'viewer',
  member_id   integer REFERENCES public.members(id) ON DELETE SET NULL,
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_profiles_status ON public.user_profiles(status);
CREATE INDEX idx_user_profiles_role   ON public.user_profiles(role);
-- A member can be claimed by at most one account
CREATE UNIQUE INDEX idx_user_profiles_member_id ON public.user_profiles(member_id)
  WHERE member_id IS NOT NULL;

-- Reused updated_at helper (created in lesson_plans migration)
CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE
  ON public.user_profiles FOR EACH ROW EXECUTE PROCEDURE
  public.update_updated_at_column();

-----------------
-- Bootstrap admin: which email(s) become admin/approved automatically
-----------------
CREATE OR REPLACE FUNCTION public.is_bootstrap_admin(p_email text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(coalesce(p_email, '')) = lower('andreas.schmid@jacwohlen.ch');
$$;

-----------------
-- Trigger: keep a profile row in sync with every auth user
--   INSERT  -> create the profile (pending, or admin for the bootstrap email)
--   UPDATE  -> refresh email / name / avatar; recreate the row if it went missing.
--              Supabase updates auth.users on every sign-in (last_sign_in_at), so this
--              also acts as a self-healing path: a user without a profile gets one again
--              on their next login instead of being stuck on /pending forever.
-----------------
CREATE OR REPLACE FUNCTION public.handle_auth_user_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean := public.is_bootstrap_admin(NEW.email);
BEGIN
  INSERT INTO public.user_profiles (
    user_id, email, full_name, avatar_url, status, role, approved_at
  )
  VALUES (
    NEW.id,
    coalesce(NEW.email, ''),
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url',
    CASE WHEN v_is_admin THEN 'approved'::public.user_status ELSE 'pending'::public.user_status END,
    CASE WHEN v_is_admin THEN 'admin'::public.user_role    ELSE 'viewer'::public.user_role  END,
    CASE WHEN v_is_admin THEN now() ELSE NULL END
  )
  ON CONFLICT (user_id) DO UPDATE SET
    email      = EXCLUDED.email,
    full_name  = coalesce(EXCLUDED.full_name,  public.user_profiles.full_name),
    avatar_url = coalesce(EXCLUDED.avatar_url, public.user_profiles.avatar_url);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_change
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_change();

-----------------
-- Guard: never let the last active admin be demoted, disabled or deleted
-----------------
CREATE OR REPLACE FUNCTION public.protect_last_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_other_admins integer;
  v_was_admin boolean := OLD.status = 'approved' AND OLD.role = 'admin';
  v_still_admin boolean := TG_OP = 'UPDATE' AND NEW.status = 'approved' AND NEW.role = 'admin';
BEGIN
  IF v_was_admin AND NOT v_still_admin THEN
    SELECT count(*) INTO v_other_admins
    FROM public.user_profiles
    WHERE status = 'approved' AND role = 'admin' AND user_id <> OLD.user_id;
    IF v_other_admins = 0 THEN
      RAISE EXCEPTION 'LAST_ADMIN' USING HINT = 'At least one approved admin must remain.';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_last_admin
  BEFORE UPDATE OR DELETE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_last_admin();

-----------------
-- Backfill profiles for users that already exist
-----------------
INSERT INTO public.user_profiles (user_id, email, full_name, avatar_url, status, role, approved_at)
SELECT
  u.id,
  u.email,
  u.raw_user_meta_data->>'full_name',
  u.raw_user_meta_data->>'avatar_url',
  CASE WHEN public.is_bootstrap_admin(u.email) THEN 'approved'::public.user_status
       ELSE 'pending'::public.user_status END,
  CASE WHEN public.is_bootstrap_admin(u.email) THEN 'admin'::public.user_role
       ELSE 'viewer'::public.user_role END,
  CASE WHEN public.is_bootstrap_admin(u.email) THEN now() ELSE NULL END
FROM auth.users u
ON CONFLICT (user_id) DO NOTHING;

-----------------
-- Helper functions used by RLS policies
-----------------
CREATE OR REPLACE FUNCTION public.is_approved_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = auth.uid() AND status = 'approved'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_writer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = auth.uid()
      AND status = 'approved'
      AND role IN ('trainer', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = auth.uid()
      AND status = 'approved'
      AND role = 'admin'
  );
$$;

-----------------
-- RLS on user_profiles itself
-----------------
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Users always see their own profile (so the app can render the pending state)
CREATE POLICY user_profiles_select_own ON public.user_profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Admins see all profiles
CREATE POLICY user_profiles_select_admin ON public.user_profiles
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- Admins update profiles (status/role/member link)
CREATE POLICY user_profiles_update_admin ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- No INSERT or DELETE policy: rows are created by the SECURITY DEFINER trigger and
-- follow the auth.users row (ON DELETE CASCADE). Use status = 'disabled' to revoke access.

-----------------
-- Lock down function execution
--   Helper predicates are only meaningful for logged-in users; the trigger bodies and the
--   bootstrap-email check must not be callable through PostgREST at all.
-----------------
REVOKE EXECUTE ON FUNCTION public.is_bootstrap_admin(text)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_auth_user_change()     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_last_admin()          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_approved_user()            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_writer()                   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin()                    FROM PUBLIC, anon;

-----------------
-- Rewrite all existing permissive RLS policies to use roles
-----------------

-- members
DROP POLICY IF EXISTS members_read_all   ON public.members;
DROP POLICY IF EXISTS members_insert_all ON public.members;
DROP POLICY IF EXISTS members_update_all ON public.members;
DROP POLICY IF EXISTS members_delete_all ON public.members;
CREATE POLICY members_read   ON public.members FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY members_insert ON public.members FOR INSERT TO authenticated WITH CHECK (public.is_writer());
-- Public trial registration form (/probetraining) submits without a login. Allow that
-- single shape only: a fresh trial candidate carrying exactly the 'probetraining' label.
CREATE POLICY members_insert_trial ON public.members FOR INSERT TO anon, authenticated
  WITH CHECK (
    labels = '["probetraining"]'::jsonb
    AND "trialRegisteredAt" IS NOT NULL
  );
CREATE POLICY members_update ON public.members FOR UPDATE TO authenticated USING (public.is_writer()) WITH CHECK (public.is_writer());
CREATE POLICY members_delete ON public.members FOR DELETE TO authenticated USING (public.is_writer());

-- trainings
DROP POLICY IF EXISTS trainings_read_all   ON public.trainings;
DROP POLICY IF EXISTS trainings_insert_all ON public.trainings;
DROP POLICY IF EXISTS trainings_update_all ON public.trainings;
DROP POLICY IF EXISTS trainings_delete_all ON public.trainings;
CREATE POLICY trainings_read   ON public.trainings FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY trainings_insert ON public.trainings FOR INSERT TO authenticated WITH CHECK (public.is_writer());
CREATE POLICY trainings_update ON public.trainings FOR UPDATE TO authenticated USING (public.is_writer()) WITH CHECK (public.is_writer());
CREATE POLICY trainings_delete ON public.trainings FOR DELETE TO authenticated USING (public.is_writer());

-- logs
DROP POLICY IF EXISTS logs_read_all   ON public.logs;
DROP POLICY IF EXISTS logs_insert_all ON public.logs;
DROP POLICY IF EXISTS logs_update_all ON public.logs;
DROP POLICY IF EXISTS logs_delete_all ON public.logs;
CREATE POLICY logs_read   ON public.logs FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY logs_insert ON public.logs FOR INSERT TO authenticated WITH CHECK (public.is_writer());
CREATE POLICY logs_update ON public.logs FOR UPDATE TO authenticated USING (public.is_writer()) WITH CHECK (public.is_writer());
CREATE POLICY logs_delete ON public.logs FOR DELETE TO authenticated USING (public.is_writer());

-- participants
DROP POLICY IF EXISTS participants_read_all   ON public.participants;
DROP POLICY IF EXISTS participants_insert_all ON public.participants;
DROP POLICY IF EXISTS participants_update_all ON public.participants;
DROP POLICY IF EXISTS participants_delete_all ON public.participants;
CREATE POLICY participants_read   ON public.participants FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY participants_insert ON public.participants FOR INSERT TO authenticated WITH CHECK (public.is_writer());
CREATE POLICY participants_update ON public.participants FOR UPDATE TO authenticated USING (public.is_writer()) WITH CHECK (public.is_writer());
CREATE POLICY participants_delete ON public.participants FOR DELETE TO authenticated USING (public.is_writer());

-- lesson_plans
DROP POLICY IF EXISTS "Allow authenticated users to read lesson plans"   ON public.lesson_plans;
DROP POLICY IF EXISTS "Allow authenticated users to create lesson plans" ON public.lesson_plans;
DROP POLICY IF EXISTS "Allow authenticated users to update lesson plans" ON public.lesson_plans;
DROP POLICY IF EXISTS "Allow authenticated users to delete lesson plans" ON public.lesson_plans;
CREATE POLICY lesson_plans_read   ON public.lesson_plans FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY lesson_plans_insert ON public.lesson_plans FOR INSERT TO authenticated WITH CHECK (public.is_writer());
CREATE POLICY lesson_plans_update ON public.lesson_plans FOR UPDATE TO authenticated USING (public.is_writer()) WITH CHECK (public.is_writer());
CREATE POLICY lesson_plans_delete ON public.lesson_plans FOR DELETE TO authenticated USING (public.is_writer());

-- events
DROP POLICY IF EXISTS "Allow authenticated users to read events"   ON public.events;
DROP POLICY IF EXISTS "Allow authenticated users to create events" ON public.events;
DROP POLICY IF EXISTS "Allow authenticated users to update events" ON public.events;
DROP POLICY IF EXISTS "Allow authenticated users to delete events" ON public.events;
CREATE POLICY events_read   ON public.events FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY events_insert ON public.events FOR INSERT TO authenticated WITH CHECK (public.is_writer());
CREATE POLICY events_update ON public.events FOR UPDATE TO authenticated USING (public.is_writer()) WITH CHECK (public.is_writer());
CREATE POLICY events_delete ON public.events FOR DELETE TO authenticated USING (public.is_writer());

-- event_participants
DROP POLICY IF EXISTS "Allow authenticated users to read event participants"   ON public.event_participants;
DROP POLICY IF EXISTS "Allow authenticated users to create event participants" ON public.event_participants;
DROP POLICY IF EXISTS "Allow authenticated users to update event participants" ON public.event_participants;
DROP POLICY IF EXISTS "Allow authenticated users to delete event participants" ON public.event_participants;
CREATE POLICY event_participants_read   ON public.event_participants FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY event_participants_insert ON public.event_participants FOR INSERT TO authenticated WITH CHECK (public.is_writer());
CREATE POLICY event_participants_update ON public.event_participants FOR UPDATE TO authenticated USING (public.is_writer()) WITH CHECK (public.is_writer());
CREATE POLICY event_participants_delete ON public.event_participants FOR DELETE TO authenticated USING (public.is_writer());

-- event_logs
DROP POLICY IF EXISTS "Allow authenticated users to read event logs"   ON public.event_logs;
DROP POLICY IF EXISTS "Allow authenticated users to create event logs" ON public.event_logs;
DROP POLICY IF EXISTS "Allow authenticated users to update event logs" ON public.event_logs;
DROP POLICY IF EXISTS "Allow authenticated users to delete event logs" ON public.event_logs;
CREATE POLICY event_logs_read   ON public.event_logs FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY event_logs_insert ON public.event_logs FOR INSERT TO authenticated WITH CHECK (public.is_writer());
CREATE POLICY event_logs_update ON public.event_logs FOR UPDATE TO authenticated USING (public.is_writer()) WITH CHECK (public.is_writer());
CREATE POLICY event_logs_delete ON public.event_logs FOR DELETE TO authenticated USING (public.is_writer());

-- badges
DROP POLICY IF EXISTS "Allow authenticated read badge_definitions" ON public.badge_definitions;
DROP POLICY IF EXISTS "Allow authenticated read member_badges"     ON public.member_badges;
DROP POLICY IF EXISTS "Allow authenticated insert member_badges"   ON public.member_badges;
DROP POLICY IF EXISTS "Allow authenticated delete member_badges"   ON public.member_badges;
CREATE POLICY badge_definitions_read ON public.badge_definitions FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY member_badges_read     ON public.member_badges     FOR SELECT TO authenticated USING (public.is_approved_user());
CREATE POLICY member_badges_insert   ON public.member_badges     FOR INSERT TO authenticated WITH CHECK (public.is_writer());
CREATE POLICY member_badges_delete   ON public.member_badges     FOR DELETE TO authenticated USING (public.is_writer());

-----------------
-- Storage bucket policies
-----------------

-- avatars
DROP POLICY IF EXISTS "all read avatars"   ON storage.objects;
DROP POLICY IF EXISTS "all insert avatars" ON storage.objects;
DROP POLICY IF EXISTS "all delete avatars" ON storage.objects;
DROP POLICY IF EXISTS "all update avatars" ON storage.objects;
CREATE POLICY avatars_read   ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'avatars' AND public.is_approved_user());
CREATE POLICY avatars_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars' AND public.is_writer());
CREATE POLICY avatars_update ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'avatars' AND public.is_writer()) WITH CHECK (bucket_id = 'avatars' AND public.is_writer());
CREATE POLICY avatars_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'avatars' AND public.is_writer());

-- lesson-plans
DROP POLICY IF EXISTS "Authenticated users can upload lesson plan files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view lesson plan files"   ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update lesson plan files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete lesson plan files" ON storage.objects;
CREATE POLICY lesson_plans_storage_read   ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'lesson-plans' AND public.is_approved_user());
CREATE POLICY lesson_plans_storage_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'lesson-plans' AND public.is_writer());
CREATE POLICY lesson_plans_storage_update ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'lesson-plans' AND public.is_writer()) WITH CHECK (bucket_id = 'lesson-plans' AND public.is_writer());
CREATE POLICY lesson_plans_storage_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'lesson-plans' AND public.is_writer());

-----------------
-- Badge functions are SECURITY DEFINER and therefore bypass RLS.
-- Gate them explicitly so anon / pending users cannot read member data or trigger writes.
-----------------
REVOKE EXECUTE ON FUNCTION public.refresh_member_badges(int)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_all_member_badges()  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_member_badges(int)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_badge_leaderboard()      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_members_top_badges()     FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.refresh_all_member_badges()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_member record;
BEGIN
    -- Only gate calls that arrive with a user JWT (PostgREST / RPC). Direct SQL
    -- sessions such as seed.sql or the service role have no auth.uid() and pass.
    -- anon has EXECUTE revoked above, so it never reaches this check.
    IF auth.uid() IS NOT NULL AND NOT public.is_writer() THEN
        RAISE EXCEPTION 'NOT_ALLOWED' USING HINT = 'Trainer or admin role required.';
    END IF;
    FOR v_member IN SELECT id FROM public.members LOOP
        PERFORM public.refresh_member_badges(v_member.id);
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_member_badges(p_member_id int)
RETURNS TABLE (
    "badgeId" text,
    category text,
    emoji text,
    "sortOrder" int,
    "earnedAt" timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT bd.id, bd.category, bd.emoji, bd."sortOrder", mb."earnedAt"
    FROM public.member_badges mb
    JOIN public.badge_definitions bd ON bd.id = mb."badgeId"
    WHERE mb."memberId" = p_member_id
      AND public.is_approved_user()
    ORDER BY bd."sortOrder" DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_badge_leaderboard()
RETURNS TABLE (
    "memberId" int,
    lastname text,
    firstname text,
    "badgeCount" bigint,
    "topBadgeEmoji" text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT
        m.id AS "memberId",
        m.lastname,
        m.firstname,
        COUNT(mb."badgeId") AS "badgeCount",
        (
            SELECT bd.emoji
            FROM public.member_badges mb2
            JOIN public.badge_definitions bd ON bd.id = mb2."badgeId"
            WHERE mb2."memberId" = m.id
            ORDER BY bd."sortOrder" DESC
            LIMIT 1
        ) AS "topBadgeEmoji"
    FROM public.members m
    JOIN public.member_badges mb ON mb."memberId" = m.id
    WHERE public.is_approved_user()
    GROUP BY m.id, m.lastname, m.firstname
    ORDER BY COUNT(mb."badgeId") DESC, m.lastname, m.firstname
    LIMIT 20;
$$;

CREATE OR REPLACE FUNCTION public.get_members_top_badges()
RETURNS TABLE (
    "memberId" int,
    emoji text,
    "badgeId" text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT DISTINCT ON (mb."memberId")
        mb."memberId",
        bd.emoji,
        bd.id AS "badgeId"
    FROM public.member_badges mb
    JOIN public.badge_definitions bd ON bd.id = mb."badgeId"
    WHERE public.is_approved_user()
    ORDER BY mb."memberId", bd."sortOrder" DESC;
$$;

-----------------
-- Cleanup: the domain restriction is superseded by the approval flow
-----------------
DROP FUNCTION IF EXISTS public.check_user_domain();
