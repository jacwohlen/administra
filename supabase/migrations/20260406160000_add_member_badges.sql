-- Badge definitions (reference table, seeded with badge types)
CREATE TABLE IF NOT EXISTS public.badge_definitions (
    id text PRIMARY KEY,
    category text NOT NULL,
    emoji text NOT NULL,
    threshold int,
    "sortOrder" int NOT NULL DEFAULT 0
);

-- Earned badges per member
CREATE TABLE IF NOT EXISTS public.member_badges (
    "memberId" int NOT NULL,
    "badgeId" text NOT NULL,
    "earnedAt" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT member_badges_pkey PRIMARY KEY ("memberId", "badgeId"),
    CONSTRAINT member_badges_member_fkey FOREIGN KEY ("memberId") REFERENCES public.members(id) ON DELETE CASCADE,
    CONSTRAINT member_badges_badge_fkey FOREIGN KEY ("badgeId") REFERENCES public.badge_definitions(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_member_badges_member ON public.member_badges("memberId");
CREATE INDEX IF NOT EXISTS idx_member_badges_badge ON public.member_badges("badgeId");

-- RLS
ALTER TABLE public.badge_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read badge_definitions" ON public.badge_definitions
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated read member_badges" ON public.member_badges
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated insert member_badges" ON public.member_badges
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated delete member_badges" ON public.member_badges
    FOR DELETE TO authenticated USING (true);

-- Seed badge definitions
INSERT INTO public.badge_definitions (id, category, emoji, threshold, "sortOrder") VALUES
    -- Attendance milestones
    ('attendance_10',  'attendance', '🥋', 10,  10),
    ('attendance_25',  'attendance', '🟡', 25,  20),
    ('attendance_50',  'attendance', '🟠', 50,  30),
    ('attendance_100', 'attendance', '🟢', 100, 40),
    ('attendance_200', 'attendance', '⬛', 200, 50),
    -- Streak badges
    ('streak_5',  'streak', '🔥', 5,  15),
    ('streak_10', 'streak', '⚡', 10, 25),
    ('streak_20', 'streak', '🔗', 20, 35),
    -- Trainer badges
    ('trainer_10',  'trainer', '🤝', 10,  12),
    ('trainer_50',  'trainer', '🥷', 50,  32),
    ('trainer_100', 'trainer', '👑', 100, 45),
    -- Event badges
    ('event_3',  'event', '🧭', 3,  11),
    ('event_10', 'event', '🏆', 10, 22),
    ('event_25', 'event', '⭐', 25, 42),
    -- Top performer
    ('top_3', 'top_performer', '🏅', NULL, 55);

-- Function to compute and sync badges for a single member
CREATE OR REPLACE FUNCTION public.refresh_member_badges(p_member_id int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_attendance_count int;
    v_trainer_count int;
    v_event_count int;
    v_max_streak int;
    v_badge record;
BEGIN
    -- Count total training attendance
    SELECT COUNT(*) INTO v_attendance_count
    FROM public.logs WHERE "memberId" = p_member_id;

    -- Count trainer sessions (main_trainer role)
    SELECT COUNT(*) INTO v_trainer_count
    FROM public.logs WHERE "memberId" = p_member_id AND "trainerRole" = 'main_trainer';

    -- Count event attendance
    SELECT COUNT(*) INTO v_event_count
    FROM public.event_logs WHERE "memberId" = p_member_id;

    -- Compute max consecutive attendance streak across all trainings
    -- For each training the member attends, we look at all dates that training ran
    -- and find the longest consecutive run where the member was present
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

    -- Award attendance badges
    FOR v_badge IN SELECT id, threshold FROM public.badge_definitions WHERE category = 'attendance' LOOP
        IF v_attendance_count >= v_badge.threshold THEN
            INSERT INTO public.member_badges ("memberId", "badgeId")
            VALUES (p_member_id, v_badge.id)
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;

    -- Award streak badges
    FOR v_badge IN SELECT id, threshold FROM public.badge_definitions WHERE category = 'streak' LOOP
        IF v_max_streak >= v_badge.threshold THEN
            INSERT INTO public.member_badges ("memberId", "badgeId")
            VALUES (p_member_id, v_badge.id)
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;

    -- Award trainer badges
    FOR v_badge IN SELECT id, threshold FROM public.badge_definitions WHERE category = 'trainer' LOOP
        IF v_trainer_count >= v_badge.threshold THEN
            INSERT INTO public.member_badges ("memberId", "badgeId")
            VALUES (p_member_id, v_badge.id)
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;

    -- Award event badges
    FOR v_badge IN SELECT id, threshold FROM public.badge_definitions WHERE category = 'event' LOOP
        IF v_event_count >= v_badge.threshold THEN
            INSERT INTO public.member_badges ("memberId", "badgeId")
            VALUES (p_member_id, v_badge.id)
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;
END;
$$;

-- Function to refresh ALL members' badges
CREATE OR REPLACE FUNCTION public.refresh_all_member_badges()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_member record;
BEGIN
    FOR v_member IN SELECT id FROM public.members LOOP
        PERFORM public.refresh_member_badges(v_member.id);
    END LOOP;
END;
$$;

-- Function to get badges for a member (used by frontend)
CREATE OR REPLACE FUNCTION public.get_member_badges(p_member_id int)
RETURNS TABLE (
    "badgeId" text,
    category text,
    emoji text,
    "sortOrder" int,
    "earnedAt" timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT bd.id, bd.category, bd.emoji, bd."sortOrder", mb."earnedAt"
    FROM public.member_badges mb
    JOIN public.badge_definitions bd ON bd.id = mb."badgeId"
    WHERE mb."memberId" = p_member_id
    ORDER BY bd."sortOrder" DESC;
$$;

-- Function to get badge leaderboard (members with most badges)
CREATE OR REPLACE FUNCTION public.get_badge_leaderboard()
RETURNS TABLE (
    "memberId" int,
    lastname text,
    firstname text,
    "badgeCount" bigint,
    "topBadgeEmoji" text
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
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
    GROUP BY m.id, m.lastname, m.firstname
    ORDER BY COUNT(mb."badgeId") DESC, m.lastname, m.firstname
    LIMIT 20;
$$;

-- Function to get top badges for multiple members (for list views)
CREATE OR REPLACE FUNCTION public.get_members_top_badges()
RETURNS TABLE (
    "memberId" int,
    emoji text,
    "badgeId" text
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT DISTINCT ON (mb."memberId")
        mb."memberId",
        bd.emoji,
        bd.id AS "badgeId"
    FROM public.member_badges mb
    JOIN public.badge_definitions bd ON bd.id = mb."badgeId"
    ORDER BY mb."memberId", bd."sortOrder" DESC;
$$;

-- Trigger: auto-refresh badges when a training log is inserted or deleted
CREATE OR REPLACE FUNCTION public.trigger_refresh_badges_on_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM public.refresh_member_badges(OLD."memberId");
        RETURN OLD;
    ELSE
        PERFORM public.refresh_member_badges(NEW."memberId");
        RETURN NEW;
    END IF;
END;
$$;

CREATE TRIGGER trg_badges_on_log
    AFTER INSERT OR DELETE ON public.logs
    FOR EACH ROW EXECUTE FUNCTION public.trigger_refresh_badges_on_log();

CREATE TRIGGER trg_badges_on_event_log
    AFTER INSERT OR DELETE ON public.event_logs
    FOR EACH ROW EXECUTE FUNCTION public.trigger_refresh_badges_on_log();
