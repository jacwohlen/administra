-- Lifetime milestone badges (attendance, streak, trainer, event) were only
-- ever awarded, never taken back. A check-in that is removed again - e.g. a
-- member ticked on the wrong training or date on the check-in page - left the
-- badge in place, so the check-in page showed a badge (next to the name and
-- in the celebration) that the member's attendance no longer supports.
--
-- refresh_member_badges now keeps these badges in sync with the data, the same
-- way the season badges already are: awarded when the threshold is met,
-- removed when it is not. Badges that stay keep their original earnedAt.
-- Grade, medal and season badges are maintained by their own functions and
-- are not touched here.
--
-- A streak also depends on the other members: it counts consecutive dates on
-- which a training ran. A check-in that adds a date to a training in the past
-- (backfilling) can split another member's run, and removing the last
-- check-in of a past date can join two runs. In those cases the trigger on
-- logs now refreshes every member of that training, not only the one whose
-- check-in changed. Adding or removing the latest date cannot change anyone
-- else's longest streak, so the usual check-in on the day stays cheap.

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

    -- Longest run of consecutive dates of one training the member attended
    WITH member_trainings AS (
        SELECT DISTINCT "trainingId"
        FROM public.logs
        WHERE "memberId" = p_member_id
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
                WHERE "trainingId" = td."trainingId"
                  AND date = td.date
                  AND "memberId" = p_member_id
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
        SELECT COUNT(*) AS streak_len
        FROM streak_groups
        WHERE attended = 1
        GROUP BY "trainingId", grp
    )
    SELECT COALESCE(MAX(streak_len), 0) INTO v_max_streak FROM streak_lengths;

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

-- Trigger for training check-ins. event_logs keeps trigger_refresh_badges_on_log,
-- since event attendance has no training dates.
CREATE OR REPLACE FUNCTION public.trigger_refresh_badges_on_training_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_member int;
    v_training int;
    v_date text;
    v_date_changed boolean;
    v_other record;
BEGIN
    IF current_setting('app.skip_badge_refresh', true) = 'true' THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        v_member := OLD."memberId"; v_training := OLD."trainingId"; v_date := OLD.date;
    ELSE
        v_member := NEW."memberId"; v_training := NEW."trainingId"; v_date := NEW.date;
    END IF;

    IF v_member IS NOT NULL THEN
        PERFORM public.refresh_member_badges(v_member);
    END IF;

    -- Did this change add the date to the training (first check-in) or remove
    -- it (last check-in gone)?
    v_date_changed := NOT EXISTS (
        SELECT 1 FROM public.logs
        WHERE "trainingId" = v_training
          AND date = v_date
          AND (TG_OP = 'DELETE' OR "memberId" IS DISTINCT FROM v_member)
    );

    -- Only a date before the training's latest one can change other streaks
    IF v_training IS NOT NULL AND v_date_changed AND EXISTS (
        SELECT 1 FROM public.logs WHERE "trainingId" = v_training AND date > v_date
    ) THEN
        FOR v_other IN
            SELECT DISTINCT "memberId" AS id
            FROM public.logs
            WHERE "trainingId" = v_training
              AND "memberId" IS NOT NULL
              AND "memberId" IS DISTINCT FROM v_member
        LOOP
            PERFORM public.refresh_member_badges(v_other.id);
        END LOOP;
    END IF;

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trigger_refresh_badges_on_training_log() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_badges_on_log ON public.logs;
CREATE TRIGGER trg_badges_on_log
    AFTER INSERT OR DELETE ON public.logs
    FOR EACH ROW EXECUTE FUNCTION public.trigger_refresh_badges_on_training_log();

-- Clean up badges that were left behind by removed check-ins or broken streaks.
DO $$
DECLARE
    v_member record;
BEGIN
    FOR v_member IN
        SELECT DISTINCT mb."memberId" AS id
        FROM public.member_badges mb
        JOIN public.badge_definitions bd ON bd.id = mb."badgeId"
        WHERE bd.category IN ('attendance', 'streak', 'trainer', 'event')
    LOOP
        PERFORM public.refresh_member_badges(v_member.id);
    END LOOP;
END;
$$;
