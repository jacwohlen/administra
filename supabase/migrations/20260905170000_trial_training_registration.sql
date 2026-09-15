-- Trial training registration feature.
-- Adds a contact email, free-form notes, and a registration timestamp on members,
-- plus optional age ranges on trainings so a suitable training can be suggested
-- for trial candidates based on their age.

ALTER TABLE public.members ADD COLUMN email text;
ALTER TABLE public.members ADD COLUMN notes text;
ALTER TABLE public.members ADD COLUMN "trialRegisteredAt" timestamptz;

ALTER TABLE public.trainings ADD COLUMN "ageFrom" smallint;
ALTER TABLE public.trainings ADD COLUMN "ageTo" smallint;
ALTER TABLE public.trainings
  ADD CONSTRAINT trainings_age_range_valid
  CHECK ("ageFrom" IS NULL OR "ageTo" IS NULL OR "ageFrom" <= "ageTo");

-- All members with the 'probetraining' label, including their total attended training count.
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
    m."trialRegisteredAt",
    COALESCE(log_count.count, 0)::int AS "attendedCount"
FROM public.members AS m
LEFT JOIN (
    SELECT "memberId", COUNT(*) AS count
    FROM public.logs
    GROUP BY "memberId"
) AS log_count ON log_count."memberId" = m.id
WHERE m.labels @> '["probetraining"]'::jsonb;
