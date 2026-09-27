-- Public status page for trial candidates (/probetraining/status/<token>).
--
-- Every candidate gets an unguessable token; the link goes out in their
-- mails. Two SECURITY DEFINER functions are the only way in, so the page
-- works without an account and without exposing members to anon:
--
--   get_trial_status(token)  first name, status, dates and assigned
--                            trainings — nothing else about the candidate
--   cancel_trial(token)      the candidate withdraws; marked as
--                            "trialSelfCancelled" so staff can tell it apart
--                            from a cancellation they recorded
--
-- register_trial() now also returns the token, so the confirmation page and
-- the thank-you mail can link to the status page right away.

ALTER TABLE public.members ADD COLUMN "trialToken" uuid;
ALTER TABLE public.members ADD COLUMN "trialSelfCancelled" boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX members_trial_token_key ON public.members ("trialToken");

UPDATE public.members
SET "trialToken" = gen_random_uuid()
WHERE labels @> '["probetraining"]'::jsonb AND "trialToken" IS NULL;

-- Same rules as before (see 20260927130000_trial_status_and_waitlist.sql),
-- plus: every candidate gets a token, and the self-cancelled flag only
-- survives while the candidate stays cancelled.
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

-- ---------------------------------------------------------------------------
-- Status page
-- ---------------------------------------------------------------------------

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
          'section', t.section
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

CREATE OR REPLACE FUNCTION public.cancel_trial(p_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.members
  SET "trialStatus" = 'cancelled', "trialSelfCancelled" = true
  WHERE p_token IS NOT NULL
    AND "trialToken" = p_token
    AND labels @> '["probetraining"]'::jsonb
    AND "trialStatus" IS DISTINCT FROM 'cancelled';
  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_trial_status(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_trial(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_trial_status(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_trial(uuid) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- register_trial(): unchanged checks, now also returns the status token.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_trial(
  p_firstname text,
  p_lastname text,
  p_birthday text,
  p_email text,
  p_mobile text DEFAULT NULL,
  p_section text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_locale text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_firstname text := nullif(btrim(p_firstname), '');
  v_lastname text := nullif(btrim(p_lastname), '');
  v_email text := nullif(btrim(p_email), '');
  v_birthday text := nullif(btrim(p_birthday), '');
  v_member_id integer;
  v_status_token uuid;
  v_email_id bigint;
  v_token uuid := gen_random_uuid();
BEGIN
  IF v_firstname IS NULL OR v_lastname IS NULL OR v_email IS NULL OR v_birthday IS NULL THEN
    RAISE EXCEPTION 'firstname, lastname, birthday and email are required'
      USING ERRCODE = '22023';
  END IF;
  IF length(v_firstname) > 100 OR length(v_lastname) > 100 OR length(v_email) > 254
     OR length(coalesce(p_mobile, '')) > 40 OR length(coalesce(p_section, '')) > 60
     OR length(coalesce(p_notes, '')) > 2000 THEN
    RAISE EXCEPTION 'input too long' USING ERRCODE = '22001';
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'invalid email' USING ERRCODE = '22023';
  END IF;
  IF v_birthday !~ '^\d{4}-\d{2}-\d{2}$' OR v_birthday::date > current_date THEN
    RAISE EXCEPTION 'invalid birthday' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.members (
    firstname, lastname, birthday, email, mobile, "trialSection", notes,
    labels, "trialRegisteredAt", "trialLocale"
  ) VALUES (
    v_firstname, v_lastname, v_birthday, v_email,
    nullif(btrim(p_mobile), ''), nullif(btrim(p_section), ''), nullif(btrim(p_notes), ''),
    '["probetraining"]'::jsonb, now(),
    CASE WHEN p_locale IN ('de', 'en') THEN p_locale END
  )
  RETURNING id, "trialToken" INTO v_member_id, v_status_token;

  INSERT INTO public.trial_emails (member_id, kind, to_email, token, created_by)
  VALUES (v_member_id, 'welcome', v_email, v_token, NULL)
  RETURNING id INTO v_email_id;

  RETURN jsonb_build_object('emailId', v_email_id, 'token', v_token, 'statusToken', v_status_token);
END;
$$;

-- ---------------------------------------------------------------------------
-- Trial overview: expose token and self-cancellation (appended columns).
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
    m."trialSelfCancelled"
FROM public.members AS m
LEFT JOIN (
    SELECT "memberId", COUNT(*) AS count
    FROM public.logs
    GROUP BY "memberId"
) AS log_count ON log_count."memberId" = m.id
WHERE m.labels @> '["probetraining"]'::jsonb;
