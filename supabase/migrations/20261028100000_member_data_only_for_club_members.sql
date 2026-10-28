-- Member accounts see member data only of the members the club area shows
-- (hardening after phase 1b, docs/MEMBER_SIGN_IN.md).
--
-- Phase 1b let a 'member' account in only while its membership counts, but
-- what such an account could read about other members stayed as before:
-- badges, grades and medals of every member (tables, and RPCs taking any
-- member id), the attendance-derived badge progress of any member, every
-- photo in the avatars bucket, and the names of non-members and people who
-- left in the recent achievements and the badge leaderboard.
--
-- One rule now, wherever member data leaves the database:
--
-- * Staff (is_staff()) see everything, as before.
-- * A member account sees the badges, grades, medals and photo of
--   club_member_ids(): its own members (my_member_ids()) and the members
--   the directory lists (membership counts, trained in the 12 months up to
--   the latest recorded training). get_member_directory() is built on the
--   same function, so the directory, the profiles it opens and the photos
--   cannot disagree.
-- * Badge progress (training, event and streak counts: attendance in all
--   but name) only of its own members, like attendance itself.
-- * RPCs no club page calls (recent achievements, badge leaderboard, medal
--   counts) are staff-only; recent achievements return at most 100 rows.
--
-- The pattern for every function that bypasses RLS: a single-member RPC
-- checks (SELECT can_see_member(p_member_id)), a list RPC filters with
-- (SELECT is_staff()) OR "memberId" IN (SELECT club_member_ids()), and so
-- does the read policy of each table of member rows. The guards are wrapped
-- in SELECT so they run once per statement (initplan), not per row.
-- supabase/checks/member_data.sql probes every table, view and RPC as a
-- member account, and fails when an API function bypassing RLS is not
-- listed there with its guard, when one taking a member id checks neither
-- the member nor a staff role, and when a policy on member rows uses
-- is_approved_user() alone.
--
-- The avatars bucket is made private where it is not: a public bucket
-- serves files by URL without asking avatars_read.

-----------------
-- The guards
-----------------

-- The members the club area shows to the signed-in account: its own
-- members and the directory. Empty for anonymous callers and for accounts
-- without access (is_approved_user(), my_member_ids()). Same rule as the
-- directory had since 20261027120000: membership counts
-- (member_grants_access) and a training in the 365 days up to the latest
-- recorded one. SECURITY DEFINER: it reads members and logs beyond the
-- caller's RLS and calls member_grants_access(), which the API roles may
-- not execute.
CREATE OR REPLACE FUNCTION public.club_member_ids()
RETURNS SETOF integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.my_member_ids()
  UNION
  SELECT m.id
  FROM public.members m
  WHERE (SELECT public.is_approved_user())
    AND public.member_grants_access(m.membership_status, m."archivedAt", m.labels)
    AND EXISTS (
      SELECT 1
      FROM public.logs l
      WHERE l."memberId" = m.id
        AND l.date >= (
          SELECT to_char(max(w.date)::date - 365, 'YYYY-MM-DD')
          FROM public.logs w
          WHERE w.date ~ '^\d{4}-\d{2}-\d{2}$'
        )
    );
$$;

COMMENT ON FUNCTION public.club_member_ids() IS
  'Members whose badges, grades, medals and photo the signed-in account may see: its own and the directory (staff see all through is_staff() policies). The directory is built on it.';

-- The guard of every RPC that takes a member id and bypasses RLS. Staff:
-- any member. A member account: club_member_ids(), or with p_own_only its
-- own members only (for data derived from attendance). NULL p_own_only
-- counts as own only. Only the SECURITY DEFINER functions below call it
-- (as their owner), so the API roles may not: a policy would need
-- club_member_ids() instead.
CREATE OR REPLACE FUNCTION public.can_see_member(p_member_id integer, p_own_only boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_member_id IS NOT NULL
     AND (
       public.is_staff()
       OR p_member_id IN (SELECT public.my_member_ids())
       OR (p_own_only IS FALSE AND p_member_id IN (SELECT public.club_member_ids()))
     );
$$;

COMMENT ON FUNCTION public.can_see_member(integer, boolean) IS
  'Guard for RPCs taking a member id: staff any, a member account club_member_ids() (p_own_only: my_member_ids()).';

-----------------
-- Tables: staff read everything, member accounts the club's members
-----------------

-- One policy per table, staff first: OR evaluates left to right, so for
-- staff the initplan is_staff() decides and the club_member_ids() subplan is
-- never built. (Two permissive policies would be OR-ed in an order Postgres
-- does not promise; today it puts the later name first.)
ALTER POLICY member_badges_read ON public.member_badges USING (
  (SELECT public.is_staff()) OR "memberId" IN (SELECT public.club_member_ids())
);
ALTER POLICY member_grades_read ON public.member_grades USING (
  (SELECT public.is_staff()) OR "memberId" IN (SELECT public.club_member_ids())
);
ALTER POLICY member_medals_read ON public.member_medals USING (
  (SELECT public.is_staff()) OR "memberId" IN (SELECT public.club_member_ids())
);

-- Photos are stored as <member id>_<upload time in ms>.webp
-- (src/routes/dashboard/members/[memberId]/+page.svelte). Other names are
-- staff-only. split_part rather than storage.filename(): the name has no
-- folder. The write policies (is_writer) stay as they are.
ALTER POLICY avatars_read ON storage.objects USING (
  bucket_id = 'avatars'
  AND (
    (SELECT public.is_staff())
    OR split_part(name, '_', 1) IN (SELECT ids.id::text FROM public.club_member_ids() AS ids(id))
  )
);

-- The policy is moot if the bucket is public: Storage then serves every
-- file by URL to anyone. The app only downloads photos through the API
-- (never public URLs) and config.toml declares the bucket private, but the
-- hosted projects' bucket was created by hand. Where the migration may not
-- change storage.buckets, it goes on with a warning: check it by hand
-- (docs/MEMBER_SIGN_IN.md).
DO $$
BEGIN
  UPDATE storage.buckets SET public = false WHERE id = 'avatars' AND public;
  IF FOUND THEN
    RAISE NOTICE 'avatars bucket made private';
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'avatars bucket not checked (%); make sure it is private', SQLERRM;
END $$;

-----------------
-- The directory, on the same set
-----------------

-- Same columns and rows as 20261027120000_member_access_requires_membership.sql;
-- which members it lists now comes from club_member_ids().
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
  WITH listed AS (
    SELECT public.club_member_ids() AS id
  ),
  mine AS (
    SELECT public.my_member_ids() AS id
  ),
  window_start AS (
    SELECT to_char(max(date)::date - 365, 'YYYY-MM-DD') AS d
    FROM public.logs
    WHERE date ~ '^\d{4}-\d{2}-\d{2}$'
  ),
  trained AS (
    SELECT
      l."memberId" AS id,
      array_agg(DISTINCT t.section ORDER BY t.section) FILTER (WHERE t.section IS NOT NULL) AS sections
    FROM public.logs l
    JOIN public.trainings t ON t.id = l."trainingId"
    WHERE l."memberId" IN (SELECT id FROM listed)
      AND l.date >= (SELECT d FROM window_start)
    GROUP BY l."memberId"
  )
  SELECT
    m.id,
    m.firstname,
    m.lastname,
    m.img,
    m."imgUploaded",
    coalesce(s.sections, '{}'),
    m.id IN (SELECT id FROM mine)
  FROM public.members m
  JOIN listed ON listed.id = m.id
  LEFT JOIN trained s ON s.id = m.id
  ORDER BY m.firstname, m.lastname;
$$;

-----------------
-- One member
-----------------

-- Same as 20260913140000_relock_security_definer_functions.sql, guarded by
-- can_see_member() instead of is_approved_user(). set_attendance() calls it
-- as a writer (staff), so the check-in celebration is unchanged.
CREATE OR REPLACE FUNCTION public.get_member_badges(p_member_id integer)
RETURNS TABLE (
  "badgeId" text,
  category text,
  emoji text,
  "sortOrder" integer,
  "earnedAt" timestamptz,
  season integer,
  context text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT bd.id, bd.category, bd.emoji, bd."sortOrder", mb."earnedAt", mb.season, mb.context
    FROM public.member_badges mb
    JOIN public.badge_definitions bd ON bd.id = mb."badgeId"
    WHERE mb."memberId" = p_member_id
      AND (SELECT public.can_see_member(p_member_id))
    ORDER BY bd."sortOrder" DESC, mb.season DESC;
$$;

-- Same as 20261021120000_q_exams.sql, guarded by can_see_member()
CREATE OR REPLACE FUNCTION public.get_member_current_grades(p_member_id integer)
RETURNS TABLE (
  section text,
  grade text,
  "gradeRank" integer,
  "beltColor" text,
  "isDan" boolean,
  "examDate" text,
  "nextGrade" text,
  "beltColor2" text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT DISTINCT ON (mg.section)
        mg.section,
        mg.grade,
        gd."gradeRank",
        gd."beltColor",
        gd."isDan",
        mg."examDate",
        (
            SELECT g2.grade FROM public.grade_definitions g2
            WHERE g2.section = mg.section AND g2."gradeRank" = gd."gradeRank" + 1
        ) AS "nextGrade",
        gd."beltColor2"
    FROM public.member_grades mg
    JOIN public.grade_definitions gd ON gd.section = mg.section AND gd.grade = mg.grade
    WHERE mg."memberId" = p_member_id
      AND (SELECT public.can_see_member(p_member_id))
    ORDER BY mg.section, gd."gradeRank" DESC, mg."examDate" DESC;
$$;

-- Same as 20260913140000_relock_security_definer_functions.sql, except the
-- gate: training, trainer, event and season counts and the longest streak
-- are attendance, so only staff and the member's own accounts get them.
-- Others are refused as before (the club page asks only for its own).
-- Calls without a user JWT (direct SQL, service role) still pass.
CREATE OR REPLACE FUNCTION public.get_member_badge_progress(p_member_id integer)
RETURNS TABLE (
  category text,
  current_count integer,
  next_badge_id text,
  next_badge_emoji text,
  next_threshold integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_attendance_count int;
    v_trainer_count int;
    v_event_count int;
    v_max_streak int;
    v_year int := EXTRACT(YEAR FROM now())::int;
    v_season_count int;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.can_see_member(p_member_id, p_own_only => true) THEN
        RAISE EXCEPTION 'NOT_ALLOWED' USING HINT = 'Staff or the member''s own account required.';
    END IF;

    SELECT COUNT(*)::int INTO v_attendance_count
    FROM public.logs WHERE "memberId" = p_member_id;

    SELECT COUNT(*)::int INTO v_trainer_count
    FROM public.logs WHERE "memberId" = p_member_id AND "trainerRole" = 'main_trainer';

    SELECT COUNT(*)::int INTO v_event_count
    FROM public.event_logs WHERE "memberId" = p_member_id;

    SELECT COUNT(*)::int INTO v_season_count
    FROM public.logs WHERE "memberId" = p_member_id AND date LIKE v_year::text || '-%';

    WITH member_trainings AS (
        SELECT DISTINCT "trainingId"
        FROM public.logs WHERE "memberId" = p_member_id
    ),
    training_dates AS (
        SELECT mt."trainingId", l.date,
            ROW_NUMBER() OVER (PARTITION BY mt."trainingId" ORDER BY l.date) AS date_rank
        FROM member_trainings mt
        JOIN (SELECT DISTINCT "trainingId", date FROM public.logs) l ON l."trainingId" = mt."trainingId"
    ),
    member_attendance AS (
        SELECT td."trainingId", td.date, td.date_rank,
            CASE WHEN EXISTS (
                SELECT 1 FROM public.logs
                WHERE "trainingId" = td."trainingId" AND date = td.date AND "memberId" = p_member_id
            ) THEN 1 ELSE 0 END AS attended
        FROM training_dates td
    ),
    streak_groups AS (
        SELECT "trainingId", date, attended,
            date_rank - ROW_NUMBER() OVER (
                PARTITION BY "trainingId", attended ORDER BY date_rank
            ) AS grp
        FROM member_attendance
    ),
    streak_lengths AS (
        SELECT COUNT(*)::int AS streak_len
        FROM streak_groups WHERE attended = 1
        GROUP BY "trainingId", grp
    )
    SELECT COALESCE(MAX(streak_len), 0) INTO v_max_streak FROM streak_lengths;

    RETURN QUERY
    SELECT bd.category, v_season_count, bd.id, bd.emoji, bd.threshold
    FROM public.badge_definitions bd
    WHERE bd.id = 'season_regular'
      AND NOT EXISTS (
          SELECT 1 FROM public.member_badges
          WHERE "memberId" = p_member_id AND "badgeId" = 'season_regular' AND season = v_year
      );

    RETURN QUERY
    SELECT bd.category, v_attendance_count, bd.id, bd.emoji, bd.threshold
    FROM public.badge_definitions bd
    WHERE bd.category = 'attendance' AND bd.threshold > v_attendance_count
    ORDER BY bd.threshold ASC LIMIT 1;

    RETURN QUERY
    SELECT bd.category, v_max_streak, bd.id, bd.emoji, bd.threshold
    FROM public.badge_definitions bd
    WHERE bd.category = 'streak' AND bd.threshold > v_max_streak
    ORDER BY bd.threshold ASC LIMIT 1;

    RETURN QUERY
    SELECT bd.category, v_trainer_count, bd.id, bd.emoji, bd.threshold
    FROM public.badge_definitions bd
    WHERE bd.category = 'trainer' AND bd.threshold > v_trainer_count
    ORDER BY bd.threshold ASC LIMIT 1;

    RETURN QUERY
    SELECT bd.category, v_event_count, bd.id, bd.emoji, bd.threshold
    FROM public.badge_definitions bd
    WHERE bd.category = 'event' AND bd.threshold > v_event_count
    ORDER BY bd.threshold ASC LIMIT 1;
END;
$$;

-----------------
-- Lists the club area shows: the club's members only
-----------------

-- Same as 20261021120000_q_exams.sql; /club/members and the check-in page
CREATE OR REPLACE FUNCTION public.get_members_current_grades()
RETURNS TABLE (
  "memberId" integer,
  section text,
  grade text,
  "gradeRank" integer,
  "beltColor" text,
  "isDan" boolean,
  "beltColor2" text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT DISTINCT ON (mg."memberId", mg.section)
        mg."memberId",
        mg.section,
        mg.grade,
        gd."gradeRank",
        gd."beltColor",
        gd."isDan",
        gd."beltColor2"
    FROM public.member_grades mg
    JOIN public.grade_definitions gd ON gd.section = mg.section AND gd.grade = mg.grade
    WHERE (SELECT public.is_staff())
       OR mg."memberId" IN (SELECT public.club_member_ids())
    ORDER BY mg."memberId", mg.section, gd."gradeRank" DESC, mg."examDate" DESC;
$$;

-- Same as 20260930150000_hide_black_belt_top_badge.sql; /club/members,
-- the member list and the check-in page
CREATE OR REPLACE FUNCTION public.get_members_top_badges()
RETURNS TABLE ("memberId" integer, emoji text, "badgeId" text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT DISTINCT ON (mb."memberId")
        mb."memberId",
        bd.emoji,
        bd.id AS "badgeId"
    FROM public.member_badges mb
    JOIN public.badge_definitions bd ON bd.id = mb."badgeId"
    WHERE bd.category <> 'grade'
      AND (
        (SELECT public.is_staff())
        OR mb."memberId" IN (SELECT public.club_member_ids())
      )
    ORDER BY mb."memberId", bd."sortOrder" DESC;
$$;

-----------------
-- Lists only staff pages show
-----------------

-- Same as 20260913140000_relock_security_definer_functions.sql; check-in page
CREATE OR REPLACE FUNCTION public.get_members_medal_counts()
RETURNS TABLE ("memberId" integer, gold bigint, silver bigint, bronze bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        "memberId",
        COUNT(*) FILTER (WHERE medal = 'gold'),
        COUNT(*) FILTER (WHERE medal = 'silver'),
        COUNT(*) FILTER (WHERE medal = 'bronze')
    FROM public.member_medals
    WHERE (SELECT public.is_staff())
    GROUP BY "memberId";
$$;

-- Same as 20260913140000_relock_security_definer_functions.sql; dashboard.
-- The limit comes from an admin setting without a maximum: at most 100.
CREATE OR REPLACE FUNCTION public.get_recent_achievements(p_limit integer DEFAULT 10)
RETURNS TABLE (
  "memberId" integer,
  lastname text,
  firstname text,
  "badgeId" text,
  emoji text,
  category text,
  "earnedAt" timestamptz,
  season integer,
  context text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        m.id AS "memberId",
        m.lastname,
        m.firstname,
        mb."badgeId",
        bd.emoji,
        bd.category,
        mb."earnedAt",
        mb.season,
        mb.context
    FROM public.member_badges mb
    JOIN public.members m ON m.id = mb."memberId"
    JOIN public.badge_definitions bd ON bd.id = mb."badgeId"
    WHERE (SELECT public.is_staff())
    ORDER BY mb."earnedAt" DESC
    LIMIT least(greatest(coalesce(p_limit, 10), 0), 100);
$$;

-- Same as 20260930150000_hide_black_belt_top_badge.sql; statistics page
CREATE OR REPLACE FUNCTION public.get_badge_leaderboard()
RETURNS TABLE (
  "memberId" integer,
  lastname text,
  firstname text,
  "badgeCount" bigint,
  "topBadgeEmoji" text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
              AND bd.category <> 'grade'
            ORDER BY bd."sortOrder" DESC
            LIMIT 1
        ) AS "topBadgeEmoji"
    FROM public.members m
    JOIN public.member_badges mb ON mb."memberId" = m.id
    WHERE (SELECT public.is_staff())
    GROUP BY m.id, m.lastname, m.firstname
    ORDER BY COUNT(mb."badgeId") DESC, m.lastname, m.firstname
    LIMIT 20;
$$;

-----------------
-- The Webling sync predicts statuses with a port of these two rules, to
-- refuse a run that would lock out many member accounts at once (it runs
-- against prod before migrations are promoted, so it cannot call them)
-----------------
COMMENT ON FUNCTION public.member_status_from_labels(jsonb, text) IS
  'membership_status from labels and provider link. Ported to status_from_labels() in webling-sync/src/sync_rules.py (the sync''s guard): change both together.';
COMMENT ON FUNCTION public.member_grants_access(text, timestamptz, jsonb) IS
  'A member record lets a member account in: active or passive, not archived, no trial label (phase 1b). Ported to counts() in webling-sync/src/sync_rules.py: change both together.';

-----------------
-- Function privileges. New functions are executable by PUBLIC (and on
-- Supabase by anon); CREATE OR REPLACE keeps the existing privileges.
-- get_members_top_badges and get_badge_leaderboard regained anon when
-- 20260930150000 dropped and recreated them; no anonymous page calls them.
-----------------
REVOKE EXECUTE ON FUNCTION public.club_member_ids()                FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.club_member_ids()                TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.can_see_member(integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.can_see_member(integer, boolean) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_members_top_badges()         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_badge_leaderboard()          FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_members_top_badges()         TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.get_badge_leaderboard()          TO authenticated, service_role;
