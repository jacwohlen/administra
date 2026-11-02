-- The API's second use (docs/API.md): a report program (a server) fetches
-- who took part in an event. Participants are personal data, so their
-- scope is for servers only: a key with event_participants:read lists no
-- websites (no CORS), so its answers can never be read in a browser.
--
--   event_participants:read   a new scope
--   api_events()              the events of a period with their counts, so
--                             the program finds the event's id
--   api_event_participants()  one event and its participants: names,
--                             registered, attended, coach
--
-- Both are granted to anon like api_training_plan(): the key is the only
-- credential, checked first with api_key_use().

ALTER TABLE public.api_keys DROP CONSTRAINT api_keys_scopes_check;
ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_scopes_check
  CHECK (scopes <@ ARRAY['training_plan:read', 'event_participants:read']::text[]);

-- Personal data never in a browser: such a key lists no websites
ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_personal_data_server_only
  CHECK (NOT ('event_participants:read' = ANY (scopes)) OR cardinality(allowed_origins) = 0);

-- An event as the API shows it (no description: it can hold anything)
CREATE OR REPLACE FUNCTION public.api_event_json(p_event public.events)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', p_event.id,
    'title', p_event.title,
    'date', p_event.date,
    'date_to', p_event.date_to,
    'all_day', p_event.all_day,
    'timeFrom', p_event."timeFrom",
    'timeTo', p_event."timeTo",
    'location', p_event.location,
    'section', p_event.section,
    -- Registrations not cancelled, and members recorded as attended
    'registered', (SELECT count(*) FROM public.event_participants p
                   WHERE p."eventId" = p_event.id
                     AND coalesce(p."attendanceStatus", 'registered') <> 'cancelled'),
    'attended', (SELECT count(DISTINCT l."memberId") FROM public.event_logs l
                 WHERE l."eventId" = p_event.id)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.api_event_json(public.events) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_event_json(public.events) TO service_role;

-- The events overlapping a period (at most 400 days), for a key with
-- event_participants:read; NULL for any other key
CREATE OR REPLACE FUNCTION public.api_events(p_key text, p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key public.api_keys;
  v_from text;
  v_to text;
BEGIN
  v_key := public.api_key_use(p_key, 'event_participants:read');
  IF v_key.id IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 400 THEN
    RAISE EXCEPTION 'INVALID_RANGE' USING ERRCODE = '22023';
  END IF;
  v_from := to_char(p_from, 'YYYY-MM-DD');
  v_to := to_char(p_to, 'YYYY-MM-DD');

  RETURN jsonb_build_object(
    'allowed_origins', to_jsonb(v_key.allowed_origins),
    'events', COALESCE((
      SELECT jsonb_agg(public.api_event_json(e)
                       ORDER BY e.date, e."timeFrom" NULLS FIRST, e.id)
      FROM public.events e
      WHERE e.date <= v_to AND coalesce(e.date_to, e.date) >= v_from
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.api_events(text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.api_events(text, date, date)
  TO anon, authenticated, service_role;

-- One event and who took part, for a key with event_participants:read;
-- NULL for any other key, {"event": null} for an unknown event. A
-- participant is a member registered (not cancelled) or recorded as
-- attended; only id and name, never contact data, birthday or notes.
CREATE OR REPLACE FUNCTION public.api_event_participants(p_key text, p_event_id integer)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key public.api_keys;
  v_event public.events;
BEGIN
  v_key := public.api_key_use(p_key, 'event_participants:read');
  IF v_key.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed_origins', to_jsonb(v_key.allowed_origins), 'event', NULL);
  END IF;

  RETURN jsonb_build_object(
    'allowed_origins', to_jsonb(v_key.allowed_origins),
    'event', public.api_event_json(v_event),
    'participants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id,
        'firstname', btrim(coalesce(m.firstname, '')),
        'lastname', btrim(coalesce(m.lastname, '')),
        'registered', x.registered,
        'attended', x.attended,
        'coach', x.coach
      ) ORDER BY lower(btrim(coalesce(m.lastname, ''))), lower(btrim(coalesce(m.firstname, ''))), m.id)
      FROM (
        SELECT ids.member_id,
               bool_or(ids.registered) AS registered,
               bool_or(ids.attended) AS attended,
               bool_or(ids.coach) AS coach
        FROM (
          SELECT p."memberId" AS member_id,
                 coalesce(p."attendanceStatus", 'registered') <> 'cancelled' AS registered,
                 p."attendanceStatus" = 'attended' AS attended,
                 false AS coach
          FROM public.event_participants p
          WHERE p."eventId" = v_event.id
          UNION ALL
          SELECT l."memberId", false, true, l."isCoach"
          FROM public.event_logs l
          WHERE l."eventId" = v_event.id
        ) ids
        GROUP BY ids.member_id
      ) x
      JOIN public.members m ON m.id = x.member_id
      -- A cancelled registration without attendance is no participant
      WHERE x.registered OR x.attended
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.api_event_participants(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.api_event_participants(text, integer)
  TO anon, authenticated, service_role;
