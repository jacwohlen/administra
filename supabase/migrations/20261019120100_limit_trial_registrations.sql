-- Rate limits and link-spam checks for the public trial registration.
--
-- register_trial() is callable by anon (the /probetraining form, and
-- directly through PostgREST with the public anon key), and every
-- registration through /api/probetraining/register sends a thank-you mail
-- through the club's SMTP server to the given address, with the given names
-- in the body. Without limits that is a free spam relay. Now:
--
--   * at most TRIAL_MAX_PER_EMAIL registrations per e-mail address
--     (case-insensitive) within 24 hours — more than one, so parents can
--     register siblings with the same address;
--   * at most TRIAL_MAX_PER_HOUR registrations per hour overall;
--   * names must not contain links or markup (://, www., @, < or >).
--
-- Both limits raise SQLSTATE 'PT429'. PostgREST answers such errors with
-- HTTP 429, and the endpoint maps the code to a 429 with a generic message.
-- Registrations are counted by "trialRegisteredAt", which only this
-- function sets and which stays when a candidate is archived or becomes a
-- member.
--
-- Otherwise a verbatim copy of 20260928090000_trial_status_page.sql.

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
  -- Limits. The club gets a handful of registrations per week; raise these
  -- only if real candidates are turned away.
  TRIAL_MAX_PER_EMAIL constant integer := 3;  -- per address within 24 hours
  TRIAL_MAX_PER_HOUR constant integer := 20;  -- all registrations within 1 hour
  -- Links or markup in a name are spam, never a real name.
  NAME_SPAM_PATTERN constant text := '(://|www\.|[@<>])';

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
  IF v_firstname ~* NAME_SPAM_PATTERN OR v_lastname ~* NAME_SPAM_PATTERN THEN
    RAISE EXCEPTION 'invalid name' USING ERRCODE = '22023';
  END IF;

  -- Serialize registrations so concurrent requests cannot all pass the
  -- limits below at once. Held until the transaction ends.
  PERFORM pg_advisory_xact_lock(hashtext('public.register_trial'));

  IF (
    SELECT count(*) FROM public.members
    WHERE lower(email) = lower(v_email)
      AND "trialRegisteredAt" > now() - interval '24 hours'
  ) >= TRIAL_MAX_PER_EMAIL THEN
    RAISE EXCEPTION 'too many registrations for this email' USING ERRCODE = 'PT429';
  END IF;
  IF (
    SELECT count(*) FROM public.members
    WHERE "trialRegisteredAt" > now() - interval '1 hour'
  ) >= TRIAL_MAX_PER_HOUR THEN
    RAISE EXCEPTION 'too many registrations' USING ERRCODE = 'PT429';
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

-- CREATE OR REPLACE keeps the existing grants; restated so this file shows
-- who may call the function.
REVOKE EXECUTE ON FUNCTION public.register_trial(text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_trial(text, text, text, text, text, text, text, text) TO anon, authenticated, service_role;
