-- Trial candidates get an explicit status, so the club can run its intake
-- process: thank the candidate, then either assign a training or put them
-- on the waiting list (reviewed during the holidays), or record that they
-- cancelled. Until now the only "status" was whether a training had been
-- assigned.
--
--   new       registered, not handled yet
--   waitlist  no place right now, waiting for the next opening
--   assigned  assigned to at least one training
--   cancelled withdrew (or was withdrawn); training assignments are removed
--
-- Assigning or removing trainings keeps the status in sync through a
-- trigger on participants, so assignments made from the training pages
-- count too. Also adds view_training_activity: how many people are actually
-- training in each training, as the basis for placing candidates.

ALTER TABLE public.members ADD COLUMN "trialStatus" text;
ALTER TABLE public.members ADD COLUMN "trialStatusChangedAt" timestamptz;
ALTER TABLE public.members
  ADD CONSTRAINT members_trial_status_valid
  CHECK ("trialStatus" IS NULL OR "trialStatus" IN ('new', 'waitlist', 'assigned', 'cancelled'));

-- Existing candidates: assigned when they have a training, otherwise new.
UPDATE public.members AS m
SET "trialStatus" = CASE
      WHEN EXISTS (SELECT 1 FROM public.participants AS p WHERE p."memberId" = m.id)
        THEN 'assigned'
      ELSE 'new'
    END,
    "trialStatusChangedAt" = COALESCE(m."trialRegisteredAt", now())
WHERE m.labels @> '["probetraining"]'::jsonb;

-- ---------------------------------------------------------------------------
-- Status bookkeeping on members
-- ---------------------------------------------------------------------------

-- New candidates always start as 'new' (the public form cannot pick another
-- status), a candidate label added later starts the process too, and every
-- status change is timestamped.
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
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER members_set_trial_status
  BEFORE INSERT OR UPDATE OF "trialStatus", labels ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_trial_status();

-- A cancelled candidate no longer shows up on training attendance lists.
CREATE OR REPLACE FUNCTION public.trigger_trial_cancelled()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.participants WHERE "memberId" = NEW.id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER members_trial_cancelled
  AFTER UPDATE OF "trialStatus" ON public.members
  FOR EACH ROW
  WHEN (NEW."trialStatus" = 'cancelled' AND OLD."trialStatus" IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION public.trigger_trial_cancelled();

-- ---------------------------------------------------------------------------
-- Keep the status in sync with training assignments
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trigger_sync_trial_status_on_participants()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Assigning a training (again) makes the candidate 'assigned', also out
    -- of the waiting list or a cancellation.
    UPDATE public.members
    SET "trialStatus" = 'assigned'
    WHERE id = NEW."memberId"
      AND "trialStatus" IS NOT NULL
      AND "trialStatus" <> 'assigned';
  ELSE
    -- Last training removed: back to 'new' so the candidate is handled again.
    UPDATE public.members AS m
    SET "trialStatus" = 'new'
    WHERE m.id = OLD."memberId"
      AND m."trialStatus" = 'assigned'
      AND NOT EXISTS (SELECT 1 FROM public.participants AS p WHERE p."memberId" = m.id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER participants_sync_trial_status
  AFTER INSERT OR DELETE ON public.participants
  FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_trial_status_on_participants();

-- Trigger functions are never called through the API.
REVOKE EXECUTE ON FUNCTION public.trigger_set_trial_status()                   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_trial_cancelled()                    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_sync_trial_status_on_participants() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public registration: the status is set by the trigger above; keep the
-- policy explicit about it anyway.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS members_insert_trial ON public.members;
CREATE POLICY members_insert_trial ON public.members FOR INSERT TO anon, authenticated
  WITH CHECK (
    labels = '["probetraining"]'::jsonb
    AND "trialRegisteredAt" IS NOT NULL
    AND "trialStatus" = 'new'
    AND img IS NULL
    AND "imgUploaded" IS NULL
  );

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

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
    m."trialStatusChangedAt"
FROM public.members AS m
LEFT JOIN (
    SELECT "memberId", COUNT(*) AS count
    FROM public.logs
    GROUP BY "memberId"
) AS log_count ON log_count."memberId" = m.id
WHERE m.labels @> '["probetraining"]'::jsonb;

-- How full each training is, to decide where a candidate fits.
--   activeCount       distinct attendees (not trainers) over the training's
--                     last 8 sessions — counted by sessions held rather than
--                     calendar days, so the number stays meaningful during
--                     the holidays, when the waiting list is reviewed
--   participantCount  members on the training's participant list
--   trialCount        trial candidates among them
CREATE VIEW public.view_training_activity
WITH (security_invoker = on) AS
WITH sessions AS (
    SELECT "trainingId", date,
           row_number() OVER (PARTITION BY "trainingId" ORDER BY date DESC) AS recency
    FROM (SELECT DISTINCT "trainingId", date FROM public.logs WHERE "trainingId" IS NOT NULL) AS d
),
active AS (
    SELECT l."trainingId", COUNT(DISTINCT l."memberId") AS count
    FROM public.logs AS l
    JOIN sessions AS s ON s."trainingId" = l."trainingId" AND s.date = l.date AND s.recency <= 8
    WHERE l."trainerRole" = 'attendee'
    GROUP BY l."trainingId"
),
listed AS (
    SELECT p."trainingId",
           COUNT(*) AS count,
           COUNT(*) FILTER (WHERE m.labels @> '["probetraining"]'::jsonb) AS trial_count
    FROM public.participants AS p
    JOIN public.members AS m ON m.id = p."memberId"
    GROUP BY p."trainingId"
)
SELECT
    t.id AS "trainingId",
    COALESCE(a.count, 0)::int AS "activeCount",
    COALESCE(ls.count, 0)::int AS "participantCount",
    COALESCE(ls.trial_count, 0)::int AS "trialCount"
FROM public.trainings AS t
LEFT JOIN active AS a ON a."trainingId" = t.id
LEFT JOIN listed AS ls ON ls."trainingId" = t.id;

GRANT SELECT ON public.view_training_activity TO anon, authenticated, service_role;
