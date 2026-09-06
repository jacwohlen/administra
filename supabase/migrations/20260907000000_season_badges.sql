-- Season badges: yearly recognition that starts fresh every calendar year but is
-- archived with its year, so "Top 3 · Judo 2026" and "Top 3 · Judo 2027" are
-- separate badges on the same profile. Lifetime badges keep season = 0.
--
-- Season badges are recomputed by a trigger on every attendance change, scoped
-- to the year of the changed log and the section of its training. A new year
-- therefore needs no manual step: the first check-in in January creates the
-- first rows for that year and leaves the previous year untouched.

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------
ALTER TABLE public.badge_definitions
    ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'lifetime';

ALTER TABLE public.member_badges
    ADD COLUMN IF NOT EXISTS season int NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS context text NOT NULL DEFAULT '';

ALTER TABLE public.member_badges DROP CONSTRAINT IF EXISTS member_badges_pkey;
ALTER TABLE public.member_badges
    ADD CONSTRAINT member_badges_pkey PRIMARY KEY ("memberId", "badgeId", season, context);

CREATE INDEX IF NOT EXISTS idx_member_badges_season ON public.member_badges(season);

-- ---------------------------------------------------------------------------
-- 2. Definitions
-- ---------------------------------------------------------------------------
-- Top 3 was defined but never awarded. It becomes a season badge per section.
UPDATE public.badge_definitions
SET category = 'season', scope = 'season', "sortOrder" = 55
WHERE id = 'top_3';

INSERT INTO public.badge_definitions (id, category, emoji, threshold, "sortOrder", scope) VALUES
    -- Lifetime: the ladder never ends
    ('attendance_500', 'attendance', '🏔️', 500, 60, 'lifetime'),
    -- Season: reset every year, archived with the year
    ('season_regular', 'season', '🗓️', 40,  38, 'season'),
    ('most_improved',  'season', '📈', NULL, 48, 'season'),
    ('coach_of_year',  'season', '🎖️', NULL, 56, 'season')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Season computation
-- ---------------------------------------------------------------------------

-- Per member and year: Season Regular (N sessions in the calendar year).
-- Revoked again if attendance for that year drops below the threshold,
-- e.g. after a mistaken check-in is removed.
CREATE OR REPLACE FUNCTION public.refresh_member_season_badges(p_member_id int, p_year int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_count int;
    v_threshold int;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM public.logs
    WHERE "memberId" = p_member_id
      AND date LIKE p_year::text || '-%';

    SELECT threshold INTO v_threshold
    FROM public.badge_definitions WHERE id = 'season_regular';

    IF v_threshold IS NOT NULL AND v_count >= v_threshold THEN
        INSERT INTO public.member_badges ("memberId", "badgeId", season)
        VALUES (p_member_id, 'season_regular', p_year)
        ON CONFLICT DO NOTHING;
    ELSE
        DELETE FROM public.member_badges
        WHERE "memberId" = p_member_id
          AND "badgeId" = 'season_regular'
          AND season = p_year;
    END IF;
END;
$$;

-- Make the holders of one section/year badge exactly the given members.
CREATE OR REPLACE FUNCTION public.sync_section_season_badge(
    p_badge_id text, p_section text, p_year int, p_members int[]
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    DELETE FROM public.member_badges
    WHERE "badgeId" = p_badge_id
      AND season = p_year
      AND lower(context) = lower(p_section)
      AND NOT ("memberId" = ANY (p_members));

    INSERT INTO public.member_badges ("memberId", "badgeId", season, context)
    SELECT m, p_badge_id, p_year, p_section
    FROM unnest(p_members) AS m
    ON CONFLICT DO NOTHING;
END;
$$;

-- Per section and year: Top 3, Most Improved, Coach of the Year.
-- Ranking matches the stats page: attendance counted per section for the year.
CREATE OR REPLACE FUNCTION public.refresh_section_season_badges(p_section text, p_year int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_this text := p_year::text || '-%';
    v_prev text := (p_year - 1)::text || '-%';
    v_top3 int[];
    v_improved int[];
    v_coach int[];
BEGIN
    -- Top 3 by attendance; ties share a place
    SELECT COALESCE(array_agg(r."memberId"), '{}') INTO v_top3
    FROM (
        SELECT l."memberId", RANK() OVER (ORDER BY COUNT(*) DESC) AS rnk
        FROM public.logs l
        JOIN public.trainings t ON t.id = l."trainingId"
        WHERE lower(t.section) = lower(p_section)
          AND l.date LIKE v_this
          AND l."memberId" IS NOT NULL
        GROUP BY l."memberId"
    ) r
    WHERE r.rnk <= 3;

    -- Most Improved: biggest increase over the previous year.
    -- Requires training in both years, so newcomers compete for Top 3 instead.
    SELECT COALESCE(array_agg(r."memberId"), '{}') INTO v_improved
    FROM (
        SELECT c."memberId", RANK() OVER (ORDER BY (c.n - p.n) DESC, c.n DESC) AS rnk
        FROM (
            SELECT l."memberId", COUNT(*) AS n
            FROM public.logs l
            JOIN public.trainings t ON t.id = l."trainingId"
            WHERE lower(t.section) = lower(p_section)
              AND l.date LIKE v_this
              AND l."memberId" IS NOT NULL
            GROUP BY l."memberId"
        ) c
        JOIN (
            SELECT l."memberId", COUNT(*) AS n
            FROM public.logs l
            JOIN public.trainings t ON t.id = l."trainingId"
            WHERE lower(t.section) = lower(p_section)
              AND l.date LIKE v_prev
              AND l."memberId" IS NOT NULL
            GROUP BY l."memberId"
        ) p ON p."memberId" = c."memberId"
        WHERE c.n > p.n
    ) r
    WHERE r.rnk = 1;

    -- Coach of the Year: most sessions led as main trainer
    SELECT COALESCE(array_agg(r."memberId"), '{}') INTO v_coach
    FROM (
        SELECT l."memberId", RANK() OVER (ORDER BY COUNT(*) DESC) AS rnk
        FROM public.logs l
        JOIN public.trainings t ON t.id = l."trainingId"
        WHERE lower(t.section) = lower(p_section)
          AND l.date LIKE v_this
          AND l."memberId" IS NOT NULL
          AND l."trainerRole" = 'main_trainer'
        GROUP BY l."memberId"
    ) r
    WHERE r.rnk = 1;

    PERFORM public.sync_section_season_badge('top_3', p_section, p_year, v_top3);
    PERFORM public.sync_section_season_badge('most_improved', p_section, p_year, v_improved);
    PERFORM public.sync_section_season_badge('coach_of_year', p_section, p_year, v_coach);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Trigger: recompute the affected member/year and section/year on every log change
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_refresh_season_badges_on_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_date text;
    v_member int;
    v_training int;
    v_year int;
    v_section text;
BEGIN
    IF current_setting('app.skip_badge_refresh', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        v_date := OLD.date; v_member := OLD."memberId"; v_training := OLD."trainingId";
    ELSE
        v_date := NEW.date; v_member := NEW."memberId"; v_training := NEW."trainingId";
    END IF;

    IF v_date ~ '^\d{4}-' THEN
        v_year := left(v_date, 4)::int;

        IF v_member IS NOT NULL THEN
            PERFORM public.refresh_member_season_badges(v_member, v_year);
        END IF;

        SELECT section INTO v_section FROM public.trainings WHERE id = v_training;
        IF v_section IS NOT NULL THEN
            PERFORM public.refresh_section_season_badges(v_section, v_year);
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_season_badges_on_log ON public.logs;
CREATE TRIGGER trg_season_badges_on_log
    AFTER INSERT OR DELETE ON public.logs
    FOR EACH ROW EXECUTE FUNCTION public.trigger_refresh_season_badges_on_log();

-- ---------------------------------------------------------------------------
-- 5. Full refresh now covers every season too (used by seed and the Refresh button)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_all_member_badges()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_member record;
    v_my record;
    v_sy record;
BEGIN
    FOR v_member IN SELECT id FROM public.members LOOP
        PERFORM public.refresh_member_badges(v_member.id);
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

-- ---------------------------------------------------------------------------
-- 6. Read functions now return season and context
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_member_badges(int);
CREATE FUNCTION public.get_member_badges(p_member_id int)
RETURNS TABLE (
    "badgeId" text,
    category text,
    emoji text,
    "sortOrder" int,
    "earnedAt" timestamptz,
    season int,
    context text
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT bd.id, bd.category, bd.emoji, bd."sortOrder", mb."earnedAt", mb.season, mb.context
    FROM public.member_badges mb
    JOIN public.badge_definitions bd ON bd.id = mb."badgeId"
    WHERE mb."memberId" = p_member_id
    ORDER BY bd."sortOrder" DESC, mb.season DESC;
$$;

DROP FUNCTION IF EXISTS public.get_recent_achievements(int);
CREATE FUNCTION public.get_recent_achievements(p_limit int DEFAULT 10)
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
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
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
    ORDER BY mb."earnedAt" DESC
    LIMIT p_limit;
$$;

-- The check-in page now detects new badges by comparing get_member_badges()
-- before and after the attendance change, which needs no time window.
DROP FUNCTION IF EXISTS public.get_new_badges_for_member(int);

-- Progress gains a row for this year's Season Regular target until it is earned.
CREATE OR REPLACE FUNCTION public.get_member_badge_progress(p_member_id int)
RETURNS TABLE (
    category text,
    current_count int,
    next_badge_id text,
    next_badge_emoji text,
    next_threshold int
) LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
    v_attendance_count int;
    v_trainer_count int;
    v_event_count int;
    v_max_streak int;
    v_year int := EXTRACT(YEAR FROM now())::int;
    v_season_count int;
BEGIN
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
