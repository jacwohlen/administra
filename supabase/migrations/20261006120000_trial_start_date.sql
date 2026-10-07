-- First trial session: when a candidate is assigned to a training, staff
-- pick the date of the first session they should come to (the next one by
-- default, or a later one, e.g. when the group is full this week). The
-- date goes into the "training assigned" mail and onto the status page.
--
-- Stored per assignment, since a candidate can be assigned to more than
-- one training. Regular participants leave it empty.

ALTER TABLE public.participants ADD COLUMN "trialStartDate" date;

-- Same as in 20260928090000_trial_status_page.sql, plus the start date of
-- each assigned training.
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
