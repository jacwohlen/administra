-- Speed up the member RLS lookup and the badge triggers on logs.
--
-- my_member_ids() backs the *_read_own policies on members, logs,
-- event_logs and event_participants. Postgres evaluates it in every query on
-- those tables, also for staff, whose rows already come through *_read. Its
-- join used `id = member_id OR email matches`, which cannot use an index, so
-- every call compared the profile against all members (~14 ms in
-- production; the stats functions read logs several times and paid it on
-- each read). Split into two branches joined by UNION so the e-mail branch
-- uses idx_members_email_normalized. Same rows, ~0.8 ms.
--
-- Every check-in (insert or delete on logs) refreshes the member's badges
-- and the season badges of the training's section:
-- - refresh_member_badges computed the streak over the distinct dates of
--   every training in the club and then probed logs once per date. It now
--   reads only the trainings the member attended and joins the member's own
--   dates instead of probing.
-- - refresh_section_season_badges read the section's logs four times (top 3,
--   this and last year for most improved, coach of the year). It now counts
--   all three in a single pass.
-- Both were checked against production data before this change: identical
-- results for every member and every section/year, roughly half the time.

-----------------
-- RLS lookup
-----------------

CREATE OR REPLACE FUNCTION public.my_member_ids()
RETURNS SETOF integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id
  FROM public.user_profiles p
  JOIN public.members m ON m.id = p.member_id
  WHERE p.user_id = auth.uid()
    AND p.status = 'approved'
  UNION
  SELECT m.id
  FROM public.user_profiles p
  JOIN public.members m
    ON public.normalize_email(m.email) = public.normalize_email(p.email)
   AND m.email IS NOT NULL
  WHERE p.user_id = auth.uid()
    AND p.status = 'approved'
    AND NOT public.has_trial_label(m.labels);
$$;

REVOKE EXECUTE ON FUNCTION public.my_member_ids() FROM PUBLIC, anon;

-----------------
-- Member badges
-----------------

CREATE OR REPLACE FUNCTION public.refresh_member_badges(p_member_id int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_attendance_count int;
    v_trainer_count int;
    v_event_count int;
    v_max_streak int;
    v_badge record;
    v_count int;
BEGIN
    SELECT COUNT(*) INTO v_attendance_count
    FROM public.logs WHERE "memberId" = p_member_id;

    SELECT COUNT(*) INTO v_trainer_count
    FROM public.logs WHERE "memberId" = p_member_id AND "trainerRole" = 'main_trainer';

    SELECT COUNT(*) INTO v_event_count
    FROM public.event_logs WHERE "memberId" = p_member_id;

    -- Longest run of consecutive dates of one training the member attended.
    -- date_rank numbers the dates on which the training ran; within a run of
    -- attended dates, date_rank minus the member's own row number is constant.
    WITH member_dates AS (
        SELECT DISTINCT "trainingId", date
        FROM public.logs
        WHERE "memberId" = p_member_id
          AND "trainingId" IS NOT NULL
    ),
    training_dates AS (
        SELECT d."trainingId", d.date,
            ROW_NUMBER() OVER (PARTITION BY d."trainingId" ORDER BY d.date) AS date_rank
        FROM (
            SELECT DISTINCT l."trainingId", l.date
            FROM public.logs l
            WHERE l."trainingId" IN (SELECT "trainingId" FROM member_dates)
        ) d
    ),
    streak_groups AS (
        SELECT td."trainingId",
            td.date_rank - ROW_NUMBER() OVER (
                PARTITION BY td."trainingId" ORDER BY td.date_rank
            ) AS grp
        FROM training_dates td
        JOIN member_dates md ON md."trainingId" = td."trainingId" AND md.date = td.date
    )
    SELECT COALESCE(MAX(streak_len), 0) INTO v_max_streak
    FROM (
        SELECT COUNT(*) AS streak_len
        FROM streak_groups
        GROUP BY "trainingId", grp
    ) s;

    FOR v_badge IN
        SELECT id, category, threshold
        FROM public.badge_definitions
        WHERE category IN ('attendance', 'streak', 'trainer', 'event')
          AND threshold IS NOT NULL
    LOOP
        v_count := CASE v_badge.category
            WHEN 'attendance' THEN v_attendance_count
            WHEN 'streak'     THEN v_max_streak
            WHEN 'trainer'    THEN v_trainer_count
            WHEN 'event'      THEN v_event_count
        END;

        IF v_count >= v_badge.threshold THEN
            INSERT INTO public.member_badges ("memberId", "badgeId")
            VALUES (p_member_id, v_badge.id)
            ON CONFLICT DO NOTHING;
        ELSE
            DELETE FROM public.member_badges
            WHERE "memberId" = p_member_id
              AND "badgeId" = v_badge.id
              AND season = 0;
        END IF;
    END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refresh_member_badges(int) FROM PUBLIC, anon, authenticated;

-----------------
-- Section season badges
-----------------

CREATE OR REPLACE FUNCTION public.refresh_section_season_badges(p_section text, p_year int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_this text := p_year::text || '-%';
    v_prev text := (p_year - 1)::text || '-%';
    v_top3 int[];
    v_improved int[];
    v_coach int[];
BEGIN
    WITH counts AS (
        SELECT l."memberId",
            COUNT(*) FILTER (WHERE l.date LIKE v_this) AS n_this,
            COUNT(*) FILTER (WHERE l.date LIKE v_prev) AS n_prev,
            COUNT(*) FILTER (WHERE l.date LIKE v_this AND l."trainerRole" = 'main_trainer') AS n_coach
        FROM public.logs l
        WHERE l."trainingId" IN (
                SELECT t.id FROM public.trainings t WHERE lower(t.section) = lower(p_section)
            )
          AND l."memberId" IS NOT NULL
          AND (l.date LIKE v_this OR l.date LIKE v_prev)
        GROUP BY l."memberId"
    )
    SELECT
        -- Top 3 by attendance; ties share a place
        COALESCE((
            SELECT array_agg(r."memberId")
            FROM (
                SELECT "memberId", RANK() OVER (ORDER BY n_this DESC) AS rnk
                FROM counts WHERE n_this > 0
            ) r
            WHERE r.rnk <= 3
        ), '{}'),
        -- Most Improved: biggest increase over the previous year.
        -- Requires training in both years, so newcomers compete for Top 3 instead.
        COALESCE((
            SELECT array_agg(r."memberId")
            FROM (
                SELECT "memberId", RANK() OVER (ORDER BY (n_this - n_prev) DESC, n_this DESC) AS rnk
                FROM counts WHERE n_prev > 0 AND n_this > n_prev
            ) r
            WHERE r.rnk = 1
        ), '{}'),
        -- Coach of the Year: most sessions led as main trainer
        COALESCE((
            SELECT array_agg(r."memberId")
            FROM (
                SELECT "memberId", RANK() OVER (ORDER BY n_coach DESC) AS rnk
                FROM counts WHERE n_coach > 0
            ) r
            WHERE r.rnk = 1
        ), '{}')
    INTO v_top3, v_improved, v_coach;

    PERFORM public.sync_section_season_badge('top_3', p_section, p_year, v_top3);
    PERFORM public.sync_section_season_badge('most_improved', p_section, p_year, v_improved);
    PERFORM public.sync_section_season_badge('coach_of_year', p_section, p_year, v_coach);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refresh_section_season_badges(text, int) FROM PUBLIC, anon, authenticated;
