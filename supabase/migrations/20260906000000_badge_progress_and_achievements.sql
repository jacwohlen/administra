-- Function to get badge progress for a member (next badge per category)
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
BEGIN
    -- Count total training attendance
    SELECT COUNT(*)::int INTO v_attendance_count
    FROM public.logs WHERE "memberId" = p_member_id;

    -- Count trainer sessions
    SELECT COUNT(*)::int INTO v_trainer_count
    FROM public.logs WHERE "memberId" = p_member_id AND "trainerRole" = 'main_trainer';

    -- Count event attendance
    SELECT COUNT(*)::int INTO v_event_count
    FROM public.event_logs WHERE "memberId" = p_member_id;

    -- Compute max consecutive streak (same logic as refresh_member_badges)
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

    -- Return next unearned badge per category with current progress
    RETURN QUERY
    SELECT bd.category, v_attendance_count, bd.id, bd.emoji, bd.threshold
    FROM public.badge_definitions bd
    WHERE bd.category = 'attendance'
      AND bd.threshold > v_attendance_count
    ORDER BY bd.threshold ASC LIMIT 1;

    RETURN QUERY
    SELECT bd.category, v_max_streak, bd.id, bd.emoji, bd.threshold
    FROM public.badge_definitions bd
    WHERE bd.category = 'streak'
      AND bd.threshold > v_max_streak
    ORDER BY bd.threshold ASC LIMIT 1;

    RETURN QUERY
    SELECT bd.category, v_trainer_count, bd.id, bd.emoji, bd.threshold
    FROM public.badge_definitions bd
    WHERE bd.category = 'trainer'
      AND bd.threshold > v_trainer_count
    ORDER BY bd.threshold ASC LIMIT 1;

    RETURN QUERY
    SELECT bd.category, v_event_count, bd.id, bd.emoji, bd.threshold
    FROM public.badge_definitions bd
    WHERE bd.category = 'event'
      AND bd.threshold > v_event_count
    ORDER BY bd.threshold ASC LIMIT 1;
END;
$$;

-- Function to get recent badge achievements across all members
CREATE OR REPLACE FUNCTION public.get_recent_achievements(p_limit int DEFAULT 10)
RETURNS TABLE (
    "memberId" int,
    lastname text,
    firstname text,
    "badgeId" text,
    emoji text,
    category text,
    "earnedAt" timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT
        m.id AS "memberId",
        m.lastname,
        m.firstname,
        mb."badgeId",
        bd.emoji,
        bd.category,
        mb."earnedAt"
    FROM public.member_badges mb
    JOIN public.members m ON m.id = mb."memberId"
    JOIN public.badge_definitions bd ON bd.id = mb."badgeId"
    ORDER BY mb."earnedAt" DESC
    LIMIT p_limit;
$$;

-- Function to detect newly earned badges for a member (earned today)
CREATE OR REPLACE FUNCTION public.get_new_badges_for_member(p_member_id int)
RETURNS TABLE (
    "badgeId" text,
    emoji text,
    category text,
    "earnedAt" timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT mb."badgeId", bd.emoji, bd.category, mb."earnedAt"
    FROM public.member_badges mb
    JOIN public.badge_definitions bd ON bd.id = mb."badgeId"
    WHERE mb."memberId" = p_member_id
      AND mb."earnedAt" >= now() - interval '30 seconds'
    ORDER BY bd."sortOrder" DESC;
$$;
