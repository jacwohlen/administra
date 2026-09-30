-- The black-belt badge (⚫) was picked as the member's top badge next to the
-- name, where it reads like the 200-trainings badge, which uses the same
-- emoji. The belt is already shown on its own, so skip grade badges when
-- picking the top badge; they still appear on the member's profile.

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
      AND bd.category <> 'grade'
    ORDER BY mb."memberId", bd."sortOrder" DESC;
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
              AND bd.category <> 'grade'
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
