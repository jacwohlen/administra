-- Re-lock SECURITY DEFINER functions and tighten the public trial-insert policy.
--
-- 20260906130000_add_user_management.sql gated every SECURITY DEFINER badge
-- function on is_approved_user() / is_writer() and revoked EXECUTE from anon.
-- The later migrations 20260907000000_season_badges.sql and
-- 20260908000000_grades_and_medals.sql dropped or replaced several of those
-- functions (and added new ones) without re-applying the gates, the REVOKEs
-- or a pinned search_path. Supabase grants EXECUTE on newly created functions
-- to anon and authenticated by default, so those functions became callable
-- through PostgREST (/rest/v1/rpc/...) without a login, bypassing RLS:
--   - get_member_badges / get_recent_achievements exposed member names,
--   - get_members_current_grades / get_members_medal_counts exposed grades
--     and medals,
--   - set_lifetime_badge / sync_section_season_badge and the other refresh
--     helpers allowed unauthenticated writes to member_badges.
-- This migration restores the intended access rules and pins search_path on
-- every function the Supabase linter flags as mutable.

-- ---------------------------------------------------------------------------
-- 1. Internal helpers: only called from triggers or other SECURITY DEFINER
--    functions (those run as the function owner), never through the API.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.refresh_member_season_badges(int, int)             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_section_season_badge(text, text, int, int[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_section_season_badges(text, int)          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_member_grade_medal_badges(int)            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_lifetime_badge(int, text, boolean)            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_refresh_season_badges_on_log()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_refresh_grade_medal_badges()              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_refresh_badges_on_log()                   FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Read functions used by the app: bodies unchanged except for the
--    is_approved_user() gate (pending users also hold the authenticated role)
--    and a pinned search_path.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_member_badges(p_member_id int)
RETURNS TABLE (
    "badgeId" text,
    category text,
    emoji text,
    "sortOrder" int,
    "earnedAt" timestamptz,
    season int,
    context text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT bd.id, bd.category, bd.emoji, bd."sortOrder", mb."earnedAt", mb.season, mb.context
    FROM public.member_badges mb
    JOIN public.badge_definitions bd ON bd.id = mb."badgeId"
    WHERE mb."memberId" = p_member_id
      AND public.is_approved_user()
    ORDER BY bd."sortOrder" DESC, mb.season DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_recent_achievements(p_limit int DEFAULT 10)
RETURNS TABLE (
    "memberId" int,
    lastname text,
    firstname text,
    "badgeId" text,
    emoji text,
    category text,
    "earnedAt" timestamptz,
    season int,
    context text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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
    WHERE public.is_approved_user()
    ORDER BY mb."earnedAt" DESC
    LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION public.get_member_current_grades(p_member_id int)
RETURNS TABLE (
    section text,
    grade text,
    "gradeRank" int,
    "beltColor" text,
    "isDan" boolean,
    "examDate" text,
    "nextGrade" text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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
        ) AS "nextGrade"
    FROM public.member_grades mg
    JOIN public.grade_definitions gd ON gd.section = mg.section AND gd.grade = mg.grade
    WHERE mg."memberId" = p_member_id
      AND public.is_approved_user()
    ORDER BY mg.section, gd."gradeRank" DESC, mg."examDate" DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_members_current_grades()
RETURNS TABLE (
    "memberId" int,
    section text,
    grade text,
    "gradeRank" int,
    "beltColor" text,
    "isDan" boolean
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT DISTINCT ON (mg."memberId", mg.section)
        mg."memberId",
        mg.section,
        mg.grade,
        gd."gradeRank",
        gd."beltColor",
        gd."isDan"
    FROM public.member_grades mg
    JOIN public.grade_definitions gd ON gd.section = mg.section AND gd.grade = mg.grade
    WHERE public.is_approved_user()
    ORDER BY mg."memberId", mg.section, gd."gradeRank" DESC, mg."examDate" DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_members_medal_counts()
RETURNS TABLE (
    "memberId" int,
    gold bigint,
    silver bigint,
    bronze bigint
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT
        "memberId",
        COUNT(*) FILTER (WHERE medal = 'gold'),
        COUNT(*) FILTER (WHERE medal = 'silver'),
        COUNT(*) FILTER (WHERE medal = 'bronze')
    FROM public.member_medals
    WHERE public.is_approved_user()
    GROUP BY "memberId";
$$;

CREATE OR REPLACE FUNCTION public.get_member_badge_progress(p_member_id int)
RETURNS TABLE (
    category text,
    current_count int,
    next_badge_id text,
    next_badge_emoji text,
    next_threshold int
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_attendance_count int;
    v_trainer_count int;
    v_event_count int;
    v_max_streak int;
    v_year int := EXTRACT(YEAR FROM now())::int;
    v_season_count int;
BEGIN
    -- Only gate calls that arrive with a user JWT (PostgREST / RPC); anon has
    -- EXECUTE revoked below and direct SQL sessions have no auth.uid().
    IF auth.uid() IS NOT NULL AND NOT public.is_approved_user() THEN
        RAISE EXCEPTION 'NOT_ALLOWED' USING HINT = 'Approved account required.';
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

-- ---------------------------------------------------------------------------
-- 3. Full refresh: still callable from the stats page, but only by writers.
--    Body unchanged from 20260908000000 apart from the gate.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_all_member_badges()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_member record;
    v_my record;
    v_sy record;
BEGIN
    -- Only gate calls that arrive with a user JWT (PostgREST / RPC). Direct SQL
    -- sessions such as seed.sql or the service role have no auth.uid() and pass.
    IF auth.uid() IS NOT NULL AND NOT public.is_writer() THEN
        RAISE EXCEPTION 'NOT_ALLOWED' USING HINT = 'Trainer or admin role required.';
    END IF;

    FOR v_member IN SELECT id FROM public.members LOOP
        PERFORM public.refresh_member_badges(v_member.id);
        PERFORM public.refresh_member_grade_medal_badges(v_member.id);
    END LOOP;

    FOR v_my IN
        SELECT DISTINCT "memberId" AS id, left(date, 4)::int AS y
        FROM public.logs
        WHERE "memberId" IS NOT NULL AND date ~ '^\d{4}-'
    LOOP
        PERFORM public.refresh_member_season_badges(v_my.id, v_my.y);
    END LOOP;

    FOR v_sy IN
        SELECT DISTINCT t.section, left(l.date, 4)::int AS y
        FROM public.logs l
        JOIN public.trainings t ON t.id = l."trainingId"
        WHERE t.section IS NOT NULL AND l.date ~ '^\d{4}-'
    LOOP
        PERFORM public.refresh_section_season_badges(v_sy.section, v_sy.y);
    END LOOP;
END;
$$;

-- Anon must not reach the gated functions at all; authenticated keeps EXECUTE
-- and the body gates decide.
REVOKE EXECUTE ON FUNCTION public.get_member_badges(int)          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_recent_achievements(int)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_member_badge_progress(int)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_member_current_grades(int)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_members_current_grades()    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_members_medal_counts()      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.refresh_all_member_badges()     FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 4. Pin search_path on the remaining functions the Supabase security linter
--    flags as mutable (SECURITY DEFINER helpers and older invoker functions).
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.refresh_member_badges(int)                          SET search_path = public;
ALTER FUNCTION public.refresh_member_season_badges(int, int)              SET search_path = public;
ALTER FUNCTION public.sync_section_season_badge(text, text, int, int[])   SET search_path = public;
ALTER FUNCTION public.refresh_section_season_badges(text, int)            SET search_path = public;
ALTER FUNCTION public.refresh_member_grade_medal_badges(int)              SET search_path = public;
ALTER FUNCTION public.set_lifetime_badge(int, text, boolean)              SET search_path = public;
ALTER FUNCTION public.trigger_refresh_badges_on_log()                     SET search_path = public;
ALTER FUNCTION public.trigger_refresh_season_badges_on_log()              SET search_path = public;
ALTER FUNCTION public.trigger_refresh_grade_medal_badges()                SET search_path = public;
ALTER FUNCTION public.update_updated_at_column()                          SET search_path = public;
ALTER FUNCTION public.get_event_participants_stats(integer)               SET search_path = public;
ALTER FUNCTION public.get_top_event_participants(text, text)              SET search_path = public;
ALTER FUNCTION public.get_upcoming_events(integer)                        SET search_path = public;
ALTER FUNCTION public.get_top_event_coaches(text, text)                   SET search_path = public;
ALTER FUNCTION public.get_top_event_coaches_from_section(text, text)      SET search_path = public;

-- ---------------------------------------------------------------------------
-- 5. Public trial registration: the anonymous insert must not smuggle in an
--    image reference — the form never sends one, and img is rendered by the
--    app for trainers.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS members_insert_trial ON public.members;
CREATE POLICY members_insert_trial ON public.members FOR INSERT TO anon, authenticated
  WITH CHECK (
    labels = '["probetraining"]'::jsonb
    AND "trialRegisteredAt" IS NOT NULL
    AND img IS NULL
    AND "imgUploaded" IS NULL
  );
