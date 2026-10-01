-- Check a member in or out of a training in one call.
--
-- The checklist used four requests per click, one after the other: read the
-- member's badges, delete the log row, insert it again, read the badges once
-- more to find the new ones for the celebration. Each is a round trip to the
-- database, and a failure after the delete left the member checked out while
-- the checkbox still showed them as present.
--
-- set_attendance does the same in one transaction and returns the badges the
-- check-in earned (none when checking out). It runs with the caller's rights,
-- so the RLS policies on logs still decide who may write; the explicit check
-- only turns a silent no-op into an error the page can show.

CREATE OR REPLACE FUNCTION public.set_attendance(
    p_date text,
    p_training_id int,
    p_member_id int,
    p_present boolean,
    p_trainer_role public.trainer_role DEFAULT 'attendee'
)
RETURNS TABLE (
    "badgeId" text,
    category text,
    emoji text,
    "sortOrder" int,
    "earnedAt" timestamptz,
    season int,
    context text
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_before text[];
BEGIN
    IF NOT (SELECT public.is_writer()) THEN
        RAISE EXCEPTION 'NOT_ALLOWED' USING HINT = 'Trainer or admin role required.';
    END IF;

    -- Badges are awarded by triggers on logs, so the badges present afterwards
    -- but not before are exactly the ones this check-in earned.
    IF p_present THEN
        SELECT COALESCE(array_agg(b."badgeId" || ':' || COALESCE(b.season, 0) || ':' || COALESCE(b.context, '')), '{}')
        INTO v_before
        FROM public.get_member_badges(p_member_id) b;
    END IF;

    -- Delete and insert rather than update: the badge triggers fire on insert
    -- and delete, and a changed trainer role must refresh the trainer badges.
    DELETE FROM public.logs
    WHERE date = p_date
      AND "trainingId" = p_training_id
      AND "memberId" = p_member_id;

    IF NOT p_present THEN
        RETURN;
    END IF;

    INSERT INTO public.logs (date, "trainingId", "memberId", "trainerRole")
    VALUES (p_date, p_training_id, p_member_id, p_trainer_role);

    RETURN QUERY
    SELECT b."badgeId", b.category, b.emoji, b."sortOrder", b."earnedAt", b.season, b.context
    FROM public.get_member_badges(p_member_id) b
    WHERE NOT (b."badgeId" || ':' || COALESCE(b.season, 0) || ':' || COALESCE(b.context, '') = ANY (v_before));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_attendance(text, int, int, boolean, public.trainer_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_attendance(text, int, int, boolean, public.trainer_role) TO authenticated, service_role;
