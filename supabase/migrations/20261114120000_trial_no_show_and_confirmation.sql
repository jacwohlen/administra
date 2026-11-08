-- Trial candidates who do not show up, and candidates who confirm they come.
--
-- Background: on 2026-11-06 the assignment mails of eight candidates had
-- landed in spam, nobody came, and the trainer removed them from the
-- training's check-in list. Removing a candidate's last training put them
-- back to 'new', so they looked like fresh registrations again.
--
-- 1. New status 'no_show'. remove_trial_participant() is what the check-in
--    list calls for a trial candidate: it removes the training and, when it
--    was the candidate's last one, marks them 'no_show' instead of 'new', so
--    whoever handles trial registrations follows up. Unassigning in the
--    trial overview (a plain DELETE) still means 'new'.
-- 2. members."trialConfirmedAt": the candidate confirms on the status page
--    (confirm_trial(token)) that they will come. The assignment mail asks
--    for it, so staff see who has not answered and can call before the
--    training. It belongs to the current assignment: any status change
--    clears it. A button on the page, not a link in the mail: mail filters
--    open links, which would confirm for everyone.

-- ---------------------------------------------------------------------------
-- Status 'no_show'
-- ---------------------------------------------------------------------------
ALTER TABLE public.members DROP CONSTRAINT members_trial_status_valid;
ALTER TABLE public.members ADD CONSTRAINT members_trial_status_valid
  CHECK ("trialStatus" IS NULL OR "trialStatus" IN ('new', 'waitlist', 'assigned', 'no_show', 'cancelled'));

-- ---------------------------------------------------------------------------
-- Confirmation
-- ---------------------------------------------------------------------------
ALTER TABLE public.members ADD COLUMN "trialConfirmedAt" timestamptz;

-- Same as in 20260928090000_trial_status_page.sql, plus: a status change
-- clears the confirmation.
CREATE OR REPLACE FUNCTION public.trigger_set_trial_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.labels @> '["probetraining"]'::jsonb THEN
      NEW."trialStatus" := 'new';
    END IF;
  ELSIF NEW."trialStatus" IS NULL AND NEW.labels @> '["probetraining"]'::jsonb THEN
    NEW."trialStatus" := 'new';
  END IF;

  IF TG_OP = 'INSERT' OR NEW."trialStatus" IS DISTINCT FROM OLD."trialStatus" THEN
    NEW."trialStatusChangedAt" := CASE WHEN NEW."trialStatus" IS NULL THEN NULL ELSE now() END;
    NEW."trialConfirmedAt" := NULL;
  END IF;

  IF NEW."trialStatus" IS NOT NULL AND NEW."trialToken" IS NULL THEN
    NEW."trialToken" := gen_random_uuid();
  END IF;
  IF NEW."trialStatus" IS DISTINCT FROM 'cancelled' THEN
    NEW."trialSelfCancelled" := false;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trigger_set_trial_status() FROM PUBLIC, anon, authenticated;

-- The candidate confirms through their status link. True when the
-- assignment is confirmed (now or before), false for any other status.
CREATE OR REPLACE FUNCTION public.confirm_trial(p_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.members
  SET "trialConfirmedAt" = COALESCE("trialConfirmedAt", now())
  WHERE p_token IS NOT NULL
    AND "trialToken" = p_token
    AND labels @> '["probetraining"]'::jsonb
    AND "trialStatus" = 'assigned';
  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_trial(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_trial(uuid) TO anon, authenticated, service_role;

-- Same as in 20261006120000_trial_start_date.sql, plus the confirmation.
CREATE OR REPLACE FUNCTION public.get_trial_status(p_token uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'firstname', m.firstname,
    -- A candidate taken on as a member no longer carries the trial label.
    'status', CASE WHEN m.labels @> '["probetraining"]'::jsonb THEN m."trialStatus" ELSE 'member' END,
    'selfCancelled', m."trialSelfCancelled",
    'section', m."trialSection",
    'locale', m."trialLocale",
    'registeredAt', m."trialRegisteredAt",
    'statusChangedAt', m."trialStatusChangedAt",
    'confirmedAt', m."trialConfirmedAt",
    'trainings', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'title', t.title,
          'weekday', t.weekday,
          'dateFrom', t."dateFrom",
          'dateTo', t."dateTo",
          'section', t.section,
          'startDate', p."trialStartDate"
        )
        ORDER BY t.id
      )
      FROM public.participants AS p
      JOIN public.trainings AS t ON t.id = p."trainingId"
      WHERE p."memberId" = m.id
    ), '[]'::jsonb)
  )
  FROM public.members AS m
  WHERE p_token IS NOT NULL
    AND m."trialToken" = p_token
    AND m."trialStatus" IS NOT NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.get_trial_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_trial_status(uuid) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Removing a trial candidate from a check-in list
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER: the caller's RLS decides (trainers and admins write
-- participants and members). Returns the candidate's status afterwards.
CREATE OR REPLACE FUNCTION public.remove_trial_participant(p_training_id integer, p_member_id integer)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  DELETE FROM public.participants
  WHERE "trainingId" = p_training_id AND "memberId" = p_member_id;

  -- The participants trigger has just put a candidate without trainings
  -- back to 'new'; from a check-in list that means they did not come.
  UPDATE public.members AS m
  SET "trialStatus" = 'no_show'
  WHERE m.id = p_member_id
    AND m.labels @> '["probetraining"]'::jsonb
    AND m."trialStatus" IN ('new', 'assigned')
    AND NOT EXISTS (SELECT 1 FROM public.participants AS p WHERE p."memberId" = m.id);

  SELECT "trialStatus" INTO v_status FROM public.members WHERE id = p_member_id;
  RETURN v_status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.remove_trial_participant(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_trial_participant(integer, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Trial overview: expose the confirmation (appended column).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.view_trial_members
WITH (security_invoker = on) AS
SELECT
    m.id,
    m.firstname,
    m.lastname,
    m.birthday,
    m.email,
    m.mobile,
    m.notes,
    m.labels,
    m."trialSection",
    m."trialRegisteredAt",
    COALESCE(log_count.count, 0)::int AS "attendedCount",
    m."trialStatus",
    m."trialStatusChangedAt",
    m."trialLocale",
    m."trialToken",
    m."trialSelfCancelled",
    log_count.last_date AS "lastAttendedAt",
    m."archivedAt",
    m."trialConfirmedAt"
FROM public.members AS m
LEFT JOIN (
    SELECT logs."memberId", count(*) AS count, max(logs.date) AS last_date
    FROM public.logs
    GROUP BY logs."memberId"
) AS log_count ON log_count."memberId" = m.id
WHERE m.labels @> '["probetraining"]'::jsonb;
