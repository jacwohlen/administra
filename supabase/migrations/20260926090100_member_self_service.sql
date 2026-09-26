-- Member self-service: club members sign in with the email address the club
-- has on file and get a personal area (own profile + member directory).
--
-- How access works
--   * Anyone can sign in (Google or a one-time code sent by email). New
--     accounts still land in user_profiles as 'pending'.
--   * If the account's *confirmed* email matches the email of a member record,
--     the account is approved automatically with the new role 'member'. Trial
--     candidates are excluded: the public /probetraining form lets anyone
--     create a member row with an arbitrary email, so it must not grant access
--     until a trainer has taken the member on (removed the trial label).
--   * The match is re-checked whenever the user signs in and whenever a member's
--     email or labels change, so adding an email in Webling/the app is enough.
--
-- What a 'member' may see
--   * The full record, attendance and event history of *their own* member
--     rows (all rows with their email, so parents see all their children).
--   * A directory of active members (name, thumbnail, sections) plus the
--     achievements everybody can see: grades, medals and badges.
--   * Trainings and events (titles/dates, no participant lists).
--   Contact data (birthday, phone, email, notes) of other members, attendance
--   lists, lesson plans and trial candidates stay staff-only (viewer and up).

-----------------
-- Helpers
-----------------

-- Trial candidates carry the 'probetraining' label (app form) or
-- 'Probetraining' (Webling group, see webling-sync/src/webling.py).
CREATE OR REPLACE FUNCTION public.has_trial_label(p_labels jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN jsonb_typeof(p_labels) = 'array' THEN EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(p_labels) AS l(label)
    WHERE lower(l.label) = 'probetraining'
  ) ELSE false END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_email(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT nullif(lower(btrim(p_email)), '');
$$;

-- Staff = approved accounts that may read the whole club database. Members
-- are approved too, but only get the narrow self-service view.
CREATE OR REPLACE FUNCTION public.is_staff()
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
      AND role IN ('viewer', 'trainer', 'admin')
  );
$$;

-- Member rows that belong to the signed-in account: the member an admin linked
-- explicitly, plus every non-trial member carrying the account's email.
CREATE OR REPLACE FUNCTION public.my_member_ids()
RETURNS SETOF integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id
  FROM public.user_profiles p
  JOIN public.members m
    ON m.id = p.member_id
    OR (
      public.normalize_email(m.email) = public.normalize_email(p.email)
      AND NOT public.has_trial_label(m.labels)
    )
  WHERE p.user_id = auth.uid()
    AND p.status = 'approved';
$$;

CREATE INDEX IF NOT EXISTS idx_members_email_normalized
  ON public.members (public.normalize_email(email))
  WHERE email IS NOT NULL;

-----------------
-- Automatic approval of members
-----------------

-- Approve every pending account whose confirmed email is p_email, provided a
-- non-trial member carries that email. Disabled accounts stay disabled.
CREATE OR REPLACE FUNCTION public.grant_member_access(p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := public.normalize_email(p_email);
BEGIN
  IF v_email IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.members m
    WHERE public.normalize_email(m.email) = v_email
      AND NOT public.has_trial_label(m.labels)
  ) THEN
    RETURN;
  END IF;

  UPDATE public.user_profiles p
     SET status      = 'approved',
         role        = 'member',
         approved_at = now(),
         approved_by = NULL
    FROM auth.users u
   WHERE u.id = p.user_id
     AND p.status = 'pending'
     AND u.email_confirmed_at IS NOT NULL
     AND public.normalize_email(u.email) = v_email;
END;
$$;

-- Same body as 20260906130000_add_user_management.sql, plus the member check.
-- Supabase updates auth.users on every sign-in and when an email gets
-- confirmed (one-time code verified), so the check runs at the right moment.
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

  IF NEW.email_confirmed_at IS NOT NULL THEN
    PERFORM public.grant_member_access(NEW.email);
  END IF;
  RETURN NEW;
END;
$$;

-- A member record gains an email (Webling sync, trainer edit) or loses its
-- trial label: let waiting accounts in right away.
CREATE OR REPLACE FUNCTION public.trigger_grant_member_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NOT NULL AND NOT public.has_trial_label(NEW.labels) THEN
    PERFORM public.grant_member_access(NEW.email);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS grant_member_access_on_member_change ON public.members;
CREATE TRIGGER grant_member_access_on_member_change
  AFTER INSERT OR UPDATE OF email, labels ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.trigger_grant_member_access();

-- Backfill: accounts already waiting whose email is on file.
SELECT public.grant_member_access(u.email)
FROM auth.users u
JOIN public.user_profiles p ON p.user_id = u.id
WHERE p.status = 'pending'
  AND u.email_confirmed_at IS NOT NULL;

-----------------
-- Row level security
-- Read access on the club database moves from "any approved account" to
-- staff; members get their own rows back through my_member_ids().
-- Role checks are wrapped in scalar subselects so they run once per
-- statement (see 20260913150000_perf_rls_initplan_and_indexes.sql).
-----------------

-- members
ALTER POLICY members_read ON public.members USING ((SELECT public.is_staff()));
CREATE POLICY members_read_own ON public.members FOR SELECT TO authenticated
  USING (id IN (SELECT public.my_member_ids()));

-- logs (attendance)
ALTER POLICY logs_read ON public.logs USING ((SELECT public.is_staff()));
CREATE POLICY logs_read_own ON public.logs FOR SELECT TO authenticated
  USING ("memberId" IN (SELECT public.my_member_ids()));

-- event participation
ALTER POLICY event_participants_read ON public.event_participants USING ((SELECT public.is_staff()));
CREATE POLICY event_participants_read_own ON public.event_participants FOR SELECT TO authenticated
  USING ("memberId" IN (SELECT public.my_member_ids()));

ALTER POLICY event_logs_read ON public.event_logs USING ((SELECT public.is_staff()));
CREATE POLICY event_logs_read_own ON public.event_logs FOR SELECT TO authenticated
  USING ("memberId" IN (SELECT public.my_member_ids()));

-- staff-only tables
ALTER POLICY participants_read ON public.participants USING ((SELECT public.is_staff()));
ALTER POLICY lesson_plans_read ON public.lesson_plans USING ((SELECT public.is_staff()));
ALTER POLICY lesson_plans_storage_read ON storage.objects
  USING (bucket_id = 'lesson-plans' AND (SELECT public.is_staff()));

-- Grades and medals: 20260908000000_grades_and_medals.sql let *any* logged-in
-- account (including pending ones) read and write them. With self sign-in
-- that population is open to everybody, so align them with the other tables.
DROP POLICY IF EXISTS "Allow authenticated read grade_definitions" ON public.grade_definitions;
DROP POLICY IF EXISTS "Allow authenticated read member_grades"     ON public.member_grades;
DROP POLICY IF EXISTS "Allow authenticated insert member_grades"   ON public.member_grades;
DROP POLICY IF EXISTS "Allow authenticated update member_grades"   ON public.member_grades;
DROP POLICY IF EXISTS "Allow authenticated delete member_grades"   ON public.member_grades;
DROP POLICY IF EXISTS "Allow authenticated read member_medals"     ON public.member_medals;
DROP POLICY IF EXISTS "Allow authenticated insert member_medals"   ON public.member_medals;
DROP POLICY IF EXISTS "Allow authenticated update member_medals"   ON public.member_medals;
DROP POLICY IF EXISTS "Allow authenticated delete member_medals"   ON public.member_medals;

CREATE POLICY grade_definitions_read ON public.grade_definitions FOR SELECT TO authenticated
  USING ((SELECT public.is_approved_user()));

CREATE POLICY member_grades_read   ON public.member_grades FOR SELECT TO authenticated
  USING ((SELECT public.is_approved_user()));
CREATE POLICY member_grades_insert ON public.member_grades FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_writer()));
CREATE POLICY member_grades_update ON public.member_grades FOR UPDATE TO authenticated
  USING ((SELECT public.is_writer())) WITH CHECK ((SELECT public.is_writer()));
CREATE POLICY member_grades_delete ON public.member_grades FOR DELETE TO authenticated
  USING ((SELECT public.is_writer()));

CREATE POLICY member_medals_read   ON public.member_medals FOR SELECT TO authenticated
  USING ((SELECT public.is_approved_user()));
CREATE POLICY member_medals_insert ON public.member_medals FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_writer()));
CREATE POLICY member_medals_update ON public.member_medals FOR UPDATE TO authenticated
  USING ((SELECT public.is_writer())) WITH CHECK ((SELECT public.is_writer()));
CREATE POLICY member_medals_delete ON public.member_medals FOR DELETE TO authenticated
  USING ((SELECT public.is_writer()));

-----------------
-- Member directory
-- Active members (attended a training within the 12 months up to the latest
-- recorded training, not in trial) plus the caller's own members, with the
-- fields everybody may see. Anchoring on the latest log instead of today keeps
-- the list stable over the summer break and on stale seed data.
-----------------
CREATE OR REPLACE FUNCTION public.get_member_directory()
RETURNS TABLE (
  id integer,
  firstname text,
  lastname text,
  img text,
  "imgUploaded" timestamptz,
  sections text[],
  "isMine" boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH mine AS (
    SELECT public.my_member_ids() AS id
  ),
  window_start AS (
    SELECT to_char(max(date)::date - 365, 'YYYY-MM-DD') AS d
    FROM public.logs
    WHERE date ~ '^\d{4}-\d{2}-\d{2}$'
  ),
  active AS (
    SELECT
      l."memberId" AS id,
      coalesce(
        array_agg(DISTINCT t.section ORDER BY t.section) FILTER (WHERE t.section IS NOT NULL),
        '{}'
      ) AS sections
    FROM public.logs l
    LEFT JOIN public.trainings t ON t.id = l."trainingId"
    WHERE l."memberId" IS NOT NULL
      AND l.date >= (SELECT d FROM window_start)
    GROUP BY l."memberId"
  )
  SELECT
    m.id,
    m.firstname,
    m.lastname,
    m.img,
    m."imgUploaded",
    coalesce(a.sections, '{}'),
    m.id IN (SELECT id FROM mine)
  FROM public.members m
  LEFT JOIN active a ON a.id = m.id
  WHERE public.is_approved_user()
    AND (
      m.id IN (SELECT id FROM mine)
      OR (a.id IS NOT NULL AND NOT public.has_trial_label(m.labels))
    )
  ORDER BY m.firstname, m.lastname;
$$;

-----------------
-- Function privileges
-- Supabase grants EXECUTE to anon/authenticated on every new function; lock
-- the internal ones down (see 20260913140000_relock_security_definer_functions.sql).
-----------------
REVOKE EXECUTE ON FUNCTION public.grant_member_access(text)       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_grant_member_access()   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_auth_user_change()       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_staff()                      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_member_ids()                 FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_member_directory()          FROM PUBLIC, anon;
