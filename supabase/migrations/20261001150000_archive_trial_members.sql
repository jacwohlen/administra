-- Archive for trial candidates.
--
-- Cancelling a candidate only sets "trialStatus" = 'cancelled' and removes
-- their training assignments; the member row stays and keeps showing up in
-- the member list and the participant search. Over time the trial overview
-- fills up with people who came once, long ago.
--
-- Archiving puts such a candidate away without deleting anything: the member
-- row, attendance logs and sent mails stay, so the club can still tell how
-- many trial sessions it ran. An archived member is hidden from the member
-- list and the participant/event search. Archiving also cancels the
-- candidate (if not already), which removes their training assignments
-- through the existing trigger and keeps the public status page consistent.
--
-- The trial overview additionally needs each candidate's last attendance, to
-- point out the ones who stopped coming.

ALTER TABLE public.members ADD COLUMN "archivedAt" timestamptz;

-- Archived members are no longer offered when adding participants.
CREATE OR REPLACE VIEW public.view_search_members
WITH (security_invoker = on) AS
SELECT
    id,
    concat(lastname, ' ', firstname) AS fullname,
    firstname,
    lastname
FROM public.members
WHERE "archivedAt" IS NULL;

-- New columns are appended so the existing view can be replaced in place.
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
    m."archivedAt"
FROM public.members AS m
LEFT JOIN (
    SELECT "memberId", COUNT(*) AS count, MAX(date) AS last_date
    FROM public.logs
    GROUP BY "memberId"
) AS log_count ON log_count."memberId" = m.id
WHERE m.labels @> '["probetraining"]'::jsonb;
