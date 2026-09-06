-- Trial candidates state which section they are interested in when registering.
-- That answer used to be prepended to `notes` as free text ("Sektion: Judo"),
-- which read as raw data in the UI and could not be filtered on. Give it its
-- own column and expose it through the trial overview.

ALTER TABLE public.members ADD COLUMN "trialSection" text;

DROP VIEW IF EXISTS public.view_trial_members;

CREATE VIEW public.view_trial_members
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
    COALESCE(log_count.count, 0)::int AS "attendedCount"
FROM public.members AS m
LEFT JOIN (
    SELECT "memberId", COUNT(*) AS count
    FROM public.logs
    GROUP BY "memberId"
) AS log_count ON log_count."memberId" = m.id
WHERE m.labels @> '["probetraining"]'::jsonb;
