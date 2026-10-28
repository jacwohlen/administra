-- End dates, all-day events and Webling's holidays (integrations phase 4,
-- docs/INTEGRATIONS.md, docs/TRAINING_PLAN.md).
--
-- events.date_to (phase 2) is used from now on: every date filter of the
-- app is an overlap (date <= day AND coalesce(date_to, date) >= day), the
-- forms and the Daten-Assistent write it. events.all_day says that an event
-- has no times; the legacy sync writes Webling's all-day entries as 00:00 to
-- 00:00, which a trigger stores as all day, whoever writes.
--
-- The integration layer understands both (capabilities version 2: ends_on
-- and all_day; an adapter sends them only to such a database). Webling no
-- longer owns the event description: its portal link is the link's url.
-- Webling's calendar "Ferien und Feiertage" now fills training_plan_breaks
-- (holidays of the training plan) instead of events.
--
-- Production runs the legacy sync until phase 3 switches it to the layer:
-- it upserts events by id with times, title, place, section and the portal
-- link as description, and knows neither date_to nor all_day. All of it
-- keeps working (supabase/checks/event_dates.sql). Holidays reach the plan
-- only through the layer: until the switch they stay events (as today) and
-- the TK enters holidays by hand; the first layer run afterwards brings the
-- calendar's holidays as breaks and deletes the events the legacy sync had
-- written for them (kept as the app's when something uses them).

-----------------
-- All-day events
-----------------

ALTER TABLE public.events ADD COLUMN all_day boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.events.all_day IS
  'No times: the whole day (or days, with date_to). 00:00 to 00:00, as the legacy Webling sync writes all-day entries, is stored as all day without times.';

-- Whether an event is all day, from what a write sets and what it was:
-- 00:00 to 00:00 (or no end) is all day; real times written to an all-day
-- event make it timed again (the legacy sync writes times only), unless
-- the write itself makes it all day (p_was false or NULL for an insert)
CREATE OR REPLACE FUNCTION public.event_all_day(p_all_day boolean, p_was boolean, p_from text, p_to text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_from = '00:00' AND coalesce(p_to, '00:00') = '00:00' THEN true
    WHEN coalesce(p_was, false) AND coalesce(p_all_day, false)
         AND (p_from IS NOT NULL OR p_to IS NOT NULL) THEN false
    ELSE coalesce(p_all_day, false)
  END;
$$;

-- Rows the legacy sync wrote for all-day entries
UPDATE public.events
   SET all_day = true, "timeFrom" = NULL, "timeTo" = NULL
 WHERE "timeFrom" = '00:00' AND coalesce("timeTo", '00:00') = '00:00';

-- An all-day event has no times, whoever writes it (the legacy sync goes on
-- writing 00:00 to 00:00 until phase 3 switches it)
CREATE OR REPLACE FUNCTION public.trigger_event_all_day()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.all_day := public.event_all_day(NEW.all_day, CASE WHEN TG_OP = 'UPDATE' THEN OLD.all_day END,
                                      NEW."timeFrom", NEW."timeTo");
  IF NEW.all_day THEN
    NEW."timeFrom" := NULL;
    NEW."timeTo" := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- BEFORE triggers fire by name: before events_guard_provider_fields, which
-- so compares the values as they will be stored
CREATE TRIGGER events_all_day
  BEFORE INSERT OR UPDATE OF all_day, "timeFrom", "timeTo" ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.trigger_event_all_day();

-----------------
-- Dates: ISO days, compared as text; overlaps
-----------------

-- events.date has always been written as YYYY-MM-DD (form, assistant, sync)
-- and the filters compare it as text. NOT VALID: rows written otherwise
-- long ago stay readable (an update of one fails until its date is fixed).
ALTER TABLE public.events
  ADD CONSTRAINT events_date_check CHECK (date ~ '^\d{4}-\d{2}-\d{2}$') NOT VALID;

-- Named in the promotion's log: such a row refuses every update, also the
-- legacy sync's nightly upsert of a Webling event
DO $$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad FROM public.events WHERE date !~ '^\d{4}-\d{2}-\d{2}$';
  IF v_bad > 0 THEN
    RAISE NOTICE '% events have a date that is not YYYY-MM-DD; fix them, updates fail until then', v_bad;
  END IF;
END;
$$;

-- The overlap filters: date <= day AND coalesce(date_to, date) >= day
CREATE INDEX events_date_span_idx ON public.events (date, (coalesce(date_to, date)));

-- Until now the Daten-Assistent wrote a multi-day event's last day as the
-- first line of its description ("bis 16.11.2026", "until 16.11.2026"):
-- moved to date_to, the line removed. Events a provider maintains are its
-- own (none of them has such a line).
WITH parsed AS (
  SELECT e.id,
         regexp_match(split_part(e.description, E'\n', 1),
                      '^\s*(?:bis|until)\s+(\d{1,2})\.(\d{1,2})\.(\d{4})\s*$', 'i') AS m
    FROM public.events e
   WHERE e.date_to IS NULL AND e.description IS NOT NULL AND e.date ~ '^\d{4}-\d{2}-\d{2}$'
     AND NOT EXISTS (SELECT 1 FROM public.event_links l WHERE l.event_id = e.id AND l.gone_at IS NULL)
), dated AS (
  SELECT p.id,
         public.integration_iso_date(p.m[3] || '-' || lpad(p.m[2], 2, '0') || '-' || lpad(p.m[1], 2, '0'),
                                     '1900-01-01', '2200-12-31') AS date_to
    FROM parsed p
   WHERE p.m IS NOT NULL
)
UPDATE public.events e
   SET date_to = d.date_to,
       description = nullif(btrim(substr(e.description, length(split_part(e.description, E'\n', 1)) + 2),
                                  E' \t\r\n'), '')
  FROM dated d
 WHERE e.id = d.id AND d.date_to > e.date;

-----------------
-- Integration layer, capabilities version 2: ends_on and all_day
-----------------

-- As in 20261029120000, plus event.all_day
CREATE OR REPLACE FUNCTION public.integration_field_policy_ok(p jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN jsonb_typeof(p) IS DISTINCT FROM 'object' THEN false ELSE NOT EXISTS (
    SELECT 1 FROM jsonb_each(p) e
     WHERE e.key NOT IN ('member.firstname', 'member.lastname', 'member.birthday', 'member.mobile',
                         'member.email', 'member.labels',
                         'event.title', 'event.date', 'event.date_to', 'event.all_day', 'event.timeFrom',
                         'event.timeTo', 'event.location', 'event.section', 'event.maxParticipants',
                         'event.description',
                         'break.title', 'break.date_from', 'break.date_to', 'break.cancels_training')
        OR jsonb_typeof(e.value) <> 'string'
        OR (e.value #>> '{}') NOT IN ('owned', 'fill', 'initial'))
  END;
$$;

-- Event data: {calendar: {id, name}, title, starts_on, ends_on, all_day,
-- time_from, time_to, location, max_participants, description, url,
-- cancelled, participants: null | [{member, state}], problem}. Dates are
-- local (Europe/Zurich) days, ends_on inclusive (the last day); times
-- HH:MM; all_day true: no times (null clears it to false). Only the keys
-- sent are kept. A start that is not a real date is 'invalid_date' (the
-- adapter sends 'no_date' for a provider's unset date, e.g. Webling's epoch).
CREATE OR REPLACE FUNCTION public.integration_normalize_event(p jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH f AS (
    SELECT
      public.integration_iso_date(p->>'starts_on', '1900-01-01', '2200-12-31') AS starts_on,
      public.integration_iso_date(p->>'ends_on', '1900-01-01', '2200-12-31') AS ends_on,
      coalesce(nullif(btrim(public.integration_text(p->'calendar'->'id')), ''),
               nullif(btrim(p->'calendar'->>'name'), '')) AS cal_key,
      nullif(btrim(p->'calendar'->>'name'), '') AS cal_name,
      CASE WHEN p->>'problem' ~ '^[a-z_]{1,40}$' THEN p->>'problem' END AS problem,
      CASE WHEN jsonb_typeof(p->'all_day') = 'boolean' THEN (p->>'all_day')::boolean
           WHEN p->'all_day' = 'null'::jsonb THEN false END AS all_day
  )
  SELECT jsonb_strip_nulls(jsonb_build_object(
           'calendar', CASE WHEN f.cal_key IS NOT NULL
                            THEN jsonb_build_object('key', f.cal_key, 'name', coalesce(f.cal_name, f.cal_key)) END,
           'title', coalesce(nullif(btrim(public.integration_text(p->'title')), ''), 'Untitled Event'),
           'starts_on', f.starts_on,
           'url', CASE WHEN p->>'url' ~ '^https://' AND length(p->>'url') <= 500 THEN p->>'url' END,
           'cancelled', coalesce(p->>'cancelled' = 'true', false),
           'problem', coalesce(f.problem, CASE WHEN f.cal_key IS NULL THEN 'no_calendar'
                                               WHEN f.starts_on IS NULL THEN 'invalid_date' END)))
      || CASE WHEN p ? 'ends_on'
              THEN jsonb_build_object('ends_on', CASE WHEN f.ends_on > f.starts_on THEN f.ends_on END)
              ELSE '{}'::jsonb END
      || CASE WHEN f.all_day IS NOT NULL THEN jsonb_build_object('all_day', f.all_day) ELSE '{}'::jsonb END
      -- All day: no times (the write clears them, also where they are only filled)
      || CASE WHEN f.all_day THEN jsonb_build_object('time_from', NULL, 'time_to', NULL)
              ELSE
                CASE WHEN p ? 'time_from' AND (p->'time_from' = 'null'::jsonb OR public.integration_hhmm(p->>'time_from') IS NOT NULL)
                     THEN jsonb_build_object('time_from', public.integration_hhmm(p->>'time_from')) ELSE '{}'::jsonb END
                || CASE WHEN p ? 'time_to' AND (p->'time_to' = 'null'::jsonb OR public.integration_hhmm(p->>'time_to') IS NOT NULL)
                        THEN jsonb_build_object('time_to', public.integration_hhmm(p->>'time_to')) ELSE '{}'::jsonb END
         END
      || CASE WHEN p ? 'location'
              THEN jsonb_build_object('location', nullif(btrim(coalesce(public.integration_text(p->'location'), '')), ''))
              ELSE '{}'::jsonb END
      || CASE WHEN p ? 'max_participants' AND (p->'max_participants' = 'null'::jsonb
                                               OR public.integration_text(p->'max_participants') ~ '^\d{1,6}$')
              THEN jsonb_build_object('max_participants',
                     CASE WHEN public.integration_text(p->'max_participants') ~ '^\d{1,6}$'
                          THEN (public.integration_text(p->'max_participants'))::integer END)
              ELSE '{}'::jsonb END
      || CASE WHEN p ? 'description' THEN jsonb_build_object('description', public.integration_text(p->'description'))
              ELSE '{}'::jsonb END
      || CASE WHEN jsonb_typeof(p->'participants') = 'array' THEN jsonb_build_object('participants', (
             SELECT coalesce(jsonb_agg(jsonb_build_object('member', btrim(public.integration_text(x->'member')),
                                                          'state', coalesce(x->>'state', '')))
                             FILTER (WHERE coalesce(btrim(public.integration_text(x->'member')), '')
                                           ~ '^[A-Za-z0-9_.:@/+=-]{1,200}$'), '[]'::jsonb)
               FROM jsonb_array_elements(p->'participants') x)) ELSE '{}'::jsonb END
      || jsonb_build_object('invalid', to_jsonb(array_remove(ARRAY[
             CASE WHEN p ? 'time_from' AND p->'time_from' <> 'null'::jsonb AND f.all_day IS NOT TRUE
                       AND public.integration_hhmm(p->>'time_from') IS NULL THEN 'time_from' END,
             CASE WHEN p ? 'time_to' AND p->'time_to' <> 'null'::jsonb AND f.all_day IS NOT TRUE
                       AND public.integration_hhmm(p->>'time_to') IS NULL THEN 'time_to' END,
             CASE WHEN p ? 'max_participants' AND p->'max_participants' <> 'null'::jsonb
                       AND coalesce(public.integration_text(p->'max_participants'), '') !~ '^\d{1,6}$'
                  THEN 'max_participants' END,
             CASE WHEN p ? 'all_day' AND f.all_day IS NULL THEN 'all_day' END], NULL)))
  FROM f;
$$;

-- Whether nothing in the app uses an event: no attendance, no registration
-- of the app's (the provider's own carry source_connection, or the legacy
-- sync's notes prefix), no exam day, no medal
CREATE OR REPLACE FUNCTION public.integration_event_unused(p_event integer, p_c public.integration_connections)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.event_logs x WHERE x."eventId" = p_event)
     AND NOT EXISTS (SELECT 1 FROM public.event_participants x
                      WHERE x."eventId" = p_event
                        AND x.source_connection IS DISTINCT FROM p_c.id
                        AND NOT (x.source_connection IS NULL AND p_c.legacy_note_prefix IS NOT NULL
                                 AND x.notes LIKE p_c.legacy_note_prefix || '%'))
     AND NOT EXISTS (SELECT 1 FROM public.exams x WHERE x.event_id = p_event)
     AND NOT EXISTS (SELECT 1 FROM public.member_medals x WHERE x."eventId" = p_event);
$$;

-- One event or holiday record (own subtransaction, see integration_write_events).
-- As in 20261029120000, plus: all_day; a description that is only the
-- link's url is cleared when the provider does not own descriptions (the
-- legacy sync put the portal link there); a holiday replaces the event the
-- legacy sync wrote for it.
CREATE OR REPLACE FUNCTION public.integration_write_event(
  p_c public.integration_connections, p_r public.integration_records, p_now timestamptz
)
RETURNS text
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pol jsonb := p_c.field_policy;
  d jsonb := p_r.data;
  v_creating boolean := p_r.action = 'insert';
  v_id bigint := p_r.target_id;
  v_section text;
  v_closed_max integer;
  e public.events%ROWTYPE;
  b public.training_plan_breaks%ROWTYPE;
  v_title text;
  v_date text;
  v_date_to text;
  v_all_day boolean;
  -- The provider says all day: the times go, also those it only fills
  v_says_all_day boolean := coalesce(v_pol->>'event.all_day' IN ('owned', 'fill') AND d->>'all_day' = 'true', false);
  v_from text;
  v_to text;
  v_location text;
  v_max text;
  v_desc text;
  v_sec text;
  v_url text;
  v_result text;
  v_legacy integer;
  v_n integer;
BEGIN
  SELECT ic.section, ic.closed_max_days INTO v_section, v_closed_max
    FROM public.integration_calendars ic WHERE ic.id = p_r.calendar_id;

  IF p_r.route = 'break' THEN
    v_date_to := coalesce(d->>'ends_on', d->>'starts_on');
    IF v_creating THEN
      INSERT INTO public.training_plan_breaks (title, date_from, date_to, cancels_training, connection,
                                               external_id, calendar_id, last_seen_at)
      VALUES (d->>'title', d->>'starts_on', v_date_to,
              v_closed_max IS NULL OR v_date_to::date - (d->>'starts_on')::date + 1 <= v_closed_max,
              p_c.id, p_r.external_id, p_r.calendar_id, p_now)
      RETURNING id INTO v_id;
      UPDATE public.integration_records SET target_id = v_id
       WHERE run_id = p_r.run_id AND external_id = p_r.external_id;
      v_result := 'inserted';
    ELSE
      SELECT * INTO b FROM public.training_plan_breaks WHERE id = v_id FOR UPDATE;
      v_title := coalesce(public.integration_pick(v_pol->>'break.title', true, d->>'title', b.title, false), b.title);
      v_from := coalesce(public.integration_pick(v_pol->>'break.date_from', true, d->>'starts_on', b.date_from, false), b.date_from);
      v_to := coalesce(public.integration_pick(v_pol->>'break.date_to', true, v_date_to, b.date_to, false), b.date_to);
      UPDATE public.training_plan_breaks
         SET title = v_title, date_from = v_from, date_to = v_to,
             connection = p_c.id, external_id = p_r.external_id, calendar_id = p_r.calendar_id,
             last_seen_at = p_now
       WHERE id = v_id;
      v_result := CASE WHEN p_r.action = 'adopt' THEN 'adopted'
                       WHEN (b.title, b.date_from, b.date_to) IS DISTINCT FROM (v_title, v_from, v_to) THEN 'updated'
                       ELSE 'unchanged' END;
    END IF;

    -- The same holiday as the legacy sync wrote it: an event with the
    -- provider's id, never linked, the portal link as description (before
    -- phase 3, or after a rollback to it). The holiday replaces it: deleted
    -- when nothing in the app uses it, else kept as the app's (a gone link,
    -- so it is not matched again)
    IF p_c.event_ids = 'external' AND p_r.external_id ~ '^[1-9]\d{0,8}$' AND d->>'url' IS NOT NULL THEN
      SELECT ev.id INTO v_legacy FROM public.events ev
       WHERE ev.id = p_r.external_id::integer AND ev.description = d->>'url'
         AND NOT EXISTS (SELECT 1 FROM public.event_links l WHERE l.event_id = ev.id);
      IF v_legacy IS NOT NULL THEN
        IF public.integration_event_unused(v_legacy, p_c) THEN
          DELETE FROM public.events WHERE id = v_legacy;
          UPDATE public.integration_records SET match = 'legacy_deleted', match_id = v_legacy
           WHERE run_id = p_r.run_id AND external_id = p_r.external_id;
        ELSE
          INSERT INTO public.event_links (connection, external_id, event_id, calendar_id, url, last_seen_at, gone_at)
          VALUES (p_c.id, p_r.external_id, v_legacy, p_r.calendar_id, d->>'url', p_now, p_now)
          ON CONFLICT DO NOTHING;
          UPDATE public.integration_records SET match = 'legacy_kept', match_id = v_legacy
           WHERE run_id = p_r.run_id AND external_id = p_r.external_id;
        END IF;
      END IF;
    END IF;
    RETURN v_result;
  END IF;

  IF v_creating THEN
    IF v_id IS NULL THEN
      v_id := nextval(pg_get_serial_sequence('public.events', 'id'));
    END IF;
    v_from := public.integration_pick(v_pol->>'event.timeFrom', d ? 'time_from', d->>'time_from', NULL, true);
    v_to := public.integration_pick(v_pol->>'event.timeTo', d ? 'time_to', d->>'time_to', NULL, true);
    v_all_day := coalesce(public.integration_pick(v_pol->>'event.all_day', d ? 'all_day', d->>'all_day',
                                                  NULL, true)::boolean, false);
    IF v_says_all_day THEN
      v_from := NULL;
      v_to := NULL;
    END IF;
    v_all_day := public.event_all_day(v_all_day, NULL, v_from, v_to);
    INSERT INTO public.events (id, title, date, date_to, all_day, "timeFrom", "timeTo", location, section,
                               "maxParticipants", description)
    VALUES (v_id, d->>'title', d->>'starts_on',
            public.integration_pick(v_pol->>'event.date_to', d ? 'ends_on', d->>'ends_on', NULL, true),
            v_all_day,
            CASE WHEN NOT v_all_day THEN v_from END,
            CASE WHEN NOT v_all_day THEN v_to END,
            public.integration_pick(v_pol->>'event.location', d ? 'location', d->>'location', NULL, true),
            public.integration_pick(v_pol->>'event.section', true, v_section, NULL, true),
            public.integration_pick(v_pol->>'event.maxParticipants', d ? 'max_participants',
                                    d->>'max_participants', NULL, true)::integer,
            public.integration_pick(v_pol->>'event.description', d ? 'description', d->>'description', NULL, true));
    INSERT INTO public.event_links (connection, external_id, event_id, calendar_id, url, last_seen_at)
    VALUES (p_c.id, p_r.external_id, v_id, p_r.calendar_id, d->>'url', p_now);
    UPDATE public.integration_records SET target_id = v_id
     WHERE run_id = p_r.run_id AND external_id = p_r.external_id;
    RETURN 'inserted';
  END IF;

  IF p_r.action = 'adopt' THEN
    INSERT INTO public.event_links (connection, external_id, event_id, calendar_id, url, last_seen_at)
    VALUES (p_c.id, p_r.external_id, v_id, p_r.calendar_id, d->>'url', p_now)
    RETURNING url INTO v_url;
  ELSE
    UPDATE public.event_links
       SET gone_at = NULL, last_seen_at = p_now, calendar_id = p_r.calendar_id,
           url = coalesce(d->>'url', url)
     WHERE connection = p_c.id AND external_id = p_r.external_id
    RETURNING url INTO v_url;
  END IF;

  SELECT * INTO e FROM public.events WHERE id = v_id FOR UPDATE;
  v_title := coalesce(public.integration_pick(v_pol->>'event.title', true, d->>'title', e.title, false), e.title);
  v_date := coalesce(public.integration_pick(v_pol->>'event.date', true, d->>'starts_on', e.date, false), e.date);
  v_date_to := public.integration_pick(v_pol->>'event.date_to', d ? 'ends_on', d->>'ends_on', e.date_to, false);
  v_from := public.integration_pick(v_pol->>'event.timeFrom', d ? 'time_from', d->>'time_from', e."timeFrom", false);
  v_to := public.integration_pick(v_pol->>'event.timeTo', d ? 'time_to', d->>'time_to', e."timeTo", false);
  v_all_day := coalesce(public.integration_pick(v_pol->>'event.all_day', d ? 'all_day', d->>'all_day',
                                                e.all_day::text, false)::boolean, e.all_day);
  v_location := public.integration_pick(v_pol->>'event.location', d ? 'location', d->>'location', e.location, false);
  v_sec := public.integration_pick(v_pol->>'event.section', true, v_section, e.section, false);
  v_max := public.integration_pick(v_pol->>'event.maxParticipants', d ? 'max_participants',
                                   d->>'max_participants', e."maxParticipants"::text, false);
  v_desc := public.integration_pick(v_pol->>'event.description', d ? 'description', d->>'description',
                                    e.description, false);
  -- A one-day event cannot end before it starts
  IF v_date_to <= v_date THEN
    v_date_to := NULL;
  END IF;
  -- The same rule as the trigger events_all_day, so an unchanged record
  -- compares equal
  IF v_says_all_day THEN
    v_from := NULL;
    v_to := NULL;
  END IF;
  v_all_day := public.event_all_day(v_all_day, e.all_day, v_from, v_to);
  IF v_all_day THEN
    v_from := NULL;
    v_to := NULL;
  END IF;
  -- Until phase 4 the provider's link stood in the description (legacy
  -- sync); it is the link's url now
  IF NOT (v_pol ? 'event.description') AND v_desc = v_url THEN
    v_desc := NULL;
  END IF;

  UPDATE public.events
     SET title = v_title, date = v_date, date_to = v_date_to, all_day = v_all_day, "timeFrom" = v_from,
         "timeTo" = v_to, location = v_location, section = v_sec, "maxParticipants" = v_max::integer,
         description = v_desc, "updatedAt" = p_now
   WHERE id = v_id
     AND (title, date, date_to, all_day, "timeFrom", "timeTo", location, section, "maxParticipants", description)
         IS DISTINCT FROM (v_title, v_date, v_date_to, v_all_day, v_from, v_to, v_location, v_sec,
                           v_max::integer, v_desc);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN CASE p_r.action WHEN 'adopt' THEN 'adopted' WHEN 'revive' THEN 'revived'
                         ELSE CASE WHEN v_n > 0 THEN 'updated' ELSE 'unchanged' END END;
END;
$$;

-- As in 20261029120000, plus the counts of holiday events the legacy sync
-- had written that the holidays replaced (holiday_events_deleted / _kept)
CREATE OR REPLACE FUNCTION public.integration_write_events(
  p_run bigint, p_c public.integration_connections, p_now timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_scope jsonb;
  v_from text;
  v_today text := to_char((now() AT TIME ZONE 'Europe/Zurich')::date, 'YYYY-MM-DD');
  r public.integration_records%ROWTYPE;
  v_result text;
  v_state text;
  v_gone integer := 0;
  v_deleted integer := 0;
  v_b_deleted integer := 0;
  v_adopted_regs integer := 0;
  v_added integer;
  v_removed integer;
BEGIN
  SELECT scope INTO v_scope FROM public.integration_runs WHERE id = p_run;
  v_from := v_scope->>'from';

  FOR r IN SELECT * FROM public.integration_records
            WHERE run_id = p_run AND action IN ('insert', 'adopt', 'revive', 'update')
            ORDER BY external_id
  LOOP
    BEGIN
      v_result := public.integration_write_event(p_c, r, p_now);
      UPDATE public.integration_records SET result = v_result
       WHERE run_id = p_run AND external_id = r.external_id;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      UPDATE public.integration_records SET action = 'error', result = 'error', error = lower(v_state)
       WHERE run_id = p_run AND external_id = r.external_id;
    END;
  END LOOP;

  -- Seen without being written (problem, before the window, failed write)
  UPDATE public.event_links l SET last_seen_at = p_now
    FROM public.integration_records r2
   WHERE r2.run_id = p_run AND l.connection = p_c.id AND l.external_id = r2.external_id
     AND l.gone_at IS NULL AND (r2.problem IS NOT NULL OR r2.action IN ('out_of_scope', 'error'));
  UPDATE public.training_plan_breaks b SET last_seen_at = p_now
    FROM public.integration_records r2
   WHERE r2.run_id = p_run AND b.connection = p_c.id AND b.external_id = r2.external_id
     AND (r2.problem IS NOT NULL OR r2.action IN ('out_of_scope', 'error'));

  -- Gone (see integration_plan_events): marked; future events nobody used
  -- in the app are deleted, the others kept as the app's (issue). Gone
  -- holidays are deleted (nothing refers to them).
  IF coalesce((v_scope->>'complete')::boolean, false) THEN
    WITH cal AS (
      SELECT ic.id FROM public.integration_calendars ic
       WHERE ic.connection = p_c.id
         AND ic.external_id IN (SELECT jsonb_array_elements_text(v_scope->'calendars'))
    )
    UPDATE public.event_links l SET gone_at = p_now
      FROM public.events e
     WHERE e.id = l.event_id AND l.connection = p_c.id AND l.gone_at IS NULL
       AND l.calendar_id IN (SELECT id FROM cal)
       AND coalesce(e.date_to, e.date) >= v_from
       AND NOT EXISTS (
         SELECT 1 FROM public.integration_records r2
          WHERE r2.run_id = p_run AND r2.external_id = l.external_id
            AND (r2.problem IS NOT NULL OR r2.action = 'out_of_scope' OR r2.route = 'event')
            AND coalesce(r2.action, '') NOT IN ('cancelled', 'ignored'));
    GET DIAGNOSTICS v_gone = ROW_COUNT;

    DELETE FROM public.events e
     USING public.event_links l
     WHERE l.event_id = e.id AND l.connection = p_c.id AND l.gone_at = p_now
       AND e.date >= v_today
       AND NOT EXISTS (SELECT 1 FROM public.event_logs x WHERE x."eventId" = e.id)
       AND NOT EXISTS (SELECT 1 FROM public.event_participants x
                        WHERE x."eventId" = e.id AND x.source_connection IS DISTINCT FROM p_c.id)
       AND NOT EXISTS (SELECT 1 FROM public.exams x WHERE x.event_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM public.member_medals x WHERE x."eventId" = e.id);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    WITH cal AS (
      SELECT ic.id FROM public.integration_calendars ic
       WHERE ic.connection = p_c.id
         AND ic.external_id IN (SELECT jsonb_array_elements_text(v_scope->'calendars'))
    )
    DELETE FROM public.training_plan_breaks b
     WHERE b.connection = p_c.id AND b.calendar_id IN (SELECT id FROM cal) AND b.date_to >= v_from
       AND NOT EXISTS (
         SELECT 1 FROM public.integration_records r2
          WHERE r2.run_id = p_run AND r2.external_id = b.external_id
            AND (r2.problem IS NOT NULL OR r2.action = 'out_of_scope' OR r2.route = 'break')
            AND coalesce(r2.action, '') NOT IN ('cancelled', 'ignored'));
    GET DIAGNOSTICS v_b_deleted = ROW_COUNT;
  END IF;

  -- Registrations of events not over yet whose participant list was read:
  -- confirmed members (through their live links of this connection) are
  -- added; the provider's own rows no longer confirmed are removed unless
  -- the app changed them since (attendance, another status, event_logs).
  -- App rows are never touched.
  IF p_c.legacy_note_prefix IS NOT NULL THEN
    UPDATE public.event_participants p SET source_connection = p_c.id
      FROM public.integration_records r2
     WHERE r2.run_id = p_run AND r2.route = 'event' AND r2.result IS NOT NULL AND r2.result <> 'error'
       AND p."eventId" = r2.target_id AND p.source_connection IS NULL
       AND p.notes LIKE p_c.legacy_note_prefix || '%';
    GET DIAGNOSTICS v_adopted_regs = ROW_COUNT;
  END IF;

  WITH open AS (
    SELECT r2.target_id::integer AS event_id, r2.data->'participants' AS participants
      FROM public.integration_records r2
     WHERE r2.run_id = p_run AND r2.route = 'event' AND r2.result IS NOT NULL AND r2.result <> 'error'
       AND jsonb_typeof(r2.data->'participants') = 'array'
       AND coalesce(r2.data->>'ends_on', r2.data->>'starts_on') >= v_today
  ), confirmed AS (
    SELECT DISTINCT o.event_id, l.member_id
      FROM open o, jsonb_array_elements(o.participants) x
      JOIN public.member_links l
        ON l.connection = p_c.id AND l.external_id = x->>'member' AND l.gone_at IS NULL
     WHERE x->>'state' = ANY (p_c.confirmed_states)
  ), del AS (
    DELETE FROM public.event_participants p
     USING open o
     WHERE p."eventId" = o.event_id AND p.source_connection = p_c.id
       AND p."attendanceStatus" = 'registered'
       AND NOT EXISTS (SELECT 1 FROM confirmed c
                        WHERE c.event_id = p."eventId" AND c.member_id = p."memberId")
       AND NOT EXISTS (SELECT 1 FROM public.event_logs x
                        WHERE x."eventId" = p."eventId" AND x."memberId" = p."memberId")
    RETURNING 1
  ), ins AS (
    INSERT INTO public.event_participants ("eventId", "memberId", "attendanceStatus", notes,
                                           source_connection)
    SELECT c.event_id, c.member_id, 'registered', p_c.settings->>'participant_note', p_c.id
      FROM confirmed c
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM del), (SELECT count(*) FROM ins) INTO v_removed, v_added;

  RETURN (
    SELECT jsonb_build_object(
      'received', count(*),
      'inserted', count(*) FILTER (WHERE route = 'event' AND result = 'inserted'),
      'adopted', count(*) FILTER (WHERE route = 'event' AND result = 'adopted'),
      'revived', count(*) FILTER (WHERE route = 'event' AND result = 'revived'),
      'updated', count(*) FILTER (WHERE route = 'event' AND result = 'updated'),
      'unchanged', count(*) FILTER (WHERE route = 'event' AND result = 'unchanged'),
      'gone', v_gone,
      'deleted', v_deleted,
      'kept', v_gone - v_deleted,
      'breaks_inserted', count(*) FILTER (WHERE route = 'break' AND result = 'inserted'),
      'breaks_adopted', count(*) FILTER (WHERE route = 'break' AND result = 'adopted'),
      'breaks_updated', count(*) FILTER (WHERE route = 'break' AND result = 'updated'),
      'breaks_deleted', v_b_deleted,
      'holiday_events_deleted', count(*) FILTER (WHERE route = 'break' AND match = 'legacy_deleted'
                                                   AND result <> 'error'),
      'holiday_events_kept', count(*) FILTER (WHERE route = 'break' AND match = 'legacy_kept'
                                                AND result <> 'error'),
      'registrations_added', v_added,
      'registrations_removed', v_removed,
      'registrations_adopted', v_adopted_regs,
      'invalid', count(*) FILTER (WHERE action = 'invalid'),
      'conflicts', count(*) FILTER (WHERE action = 'conflict'),
      'write_failed', count(*) FILTER (WHERE action = 'error'),
      'ignored', count(*) FILTER (WHERE action IN ('ignored', 'cancelled')),
      'out_of_scope', count(*) FILTER (WHERE action = 'out_of_scope'))
    FROM public.integration_records WHERE run_id = p_run);
END;
$$;

-- As in 20261029120000; capabilities version 2: events take all_day, and
-- an adapter sends ends_on and all_day only from this version on (the app
-- shows end dates and all-day events from this migration on)
CREATE OR REPLACE FUNCTION public.integration_begin(
  p_connection text,
  p_kind text,
  p_options jsonb DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_c public.integration_connections%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Europe/Zurich')::date;
  v_options jsonb := CASE WHEN jsonb_typeof(p_options) = 'object' THEN p_options ELSE '{}'::jsonb END;
  v_in jsonb;
  v_scope jsonb;
  v_trigger text;
  v_runner text;
  v_id bigint;
BEGIN
  PERFORM public.integration_authorize(p_connection);
  SELECT * INTO v_c FROM public.integration_connections WHERE id = p_connection;
  IF NOT FOUND OR NOT v_c.enabled THEN
    RAISE EXCEPTION 'UNKNOWN_CONNECTION' USING ERRCODE = 'P0001';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('members', 'events') THEN
    RAISE EXCEPTION 'invalid kind' USING ERRCODE = '22023';
  END IF;

  v_in := CASE WHEN jsonb_typeof(v_options->'scope') = 'object' THEN v_options->'scope' ELSE '{}'::jsonb END;
  IF p_kind = 'members' THEN
    v_scope := jsonb_build_object('complete', coalesce(v_in->>'complete' = 'true', false));
  ELSE
    IF v_in ? 'calendars' AND jsonb_typeof(v_in->'calendars') <> 'array' THEN
      RAISE EXCEPTION 'invalid scope' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_in->'calendars', '[]'::jsonb)) x
                WHERE coalesce(public.integration_text(x), '') !~ '^[A-Za-z0-9_.:@/+=-]{1,200}$') THEN
      RAISE EXCEPTION 'invalid scope: calendar ids' USING ERRCODE = '22023';
    END IF;
    v_scope := jsonb_build_object(
      'complete', coalesce(v_in->>'complete' = 'true', false),
      'calendars', (SELECT coalesce(jsonb_agg(DISTINCT x), '[]'::jsonb)
                      FROM jsonb_array_elements_text(coalesce(v_in->'calendars', '[]'::jsonb)) x),
      'from', coalesce(public.integration_iso_date(v_in->>'from', '1900-01-01', '2200-12-31'),
                       to_char(date_trunc('year', v_today), 'YYYY-MM-DD')));
  END IF;
  v_trigger := coalesce(v_options->>'trigger',
                        CASE WHEN public.integration_is_service() THEN 'schedule' ELSE 'app' END);
  IF v_trigger NOT IN ('schedule', 'manual', 'app') THEN
    RAISE EXCEPTION 'invalid trigger' USING ERRCODE = '22023';
  END IF;
  v_runner := CASE WHEN v_options->>'runner' ~ '^[a-z]{1,20}:[A-Za-z0-9._-]{1,60}$' THEN v_options->>'runner' END;

  PERFORM pg_advisory_xact_lock(hashtext('integration:' || p_connection || ':' || p_kind));
  -- A run left open for an hour (runner killed; the workflow stops after
  -- 30 minutes): never applied is failed, applied but not finished a warning
  UPDATE public.integration_runs
     SET status = CASE status WHEN 'applied' THEN 'warning' ELSE 'failed' END,
         error = CASE status WHEN 'applied' THEN 'not_finished' ELSE 'abandoned' END,
         finished_at = now()
   WHERE status IN ('running', 'applied') AND started_at < now() - interval '1 hour';
  -- Staged records of closed runs (any connection): no personal data stays
  DELETE FROM public.integration_records r
   USING public.integration_runs u
   WHERE r.run_id = u.id AND (u.finished_at IS NOT NULL OR u.status NOT IN ('running', 'applied'));
  IF EXISTS (SELECT 1 FROM public.integration_runs
              WHERE connection = p_connection AND kind = p_kind AND status IN ('running', 'applied')) THEN
    RAISE EXCEPTION 'RUN_IN_PROGRESS' USING ERRCODE = 'PT409';
  END IF;
  -- Housekeeping: runs for 400 days, issues half a year after they closed
  -- (a dismissed issue only once no run has seen it for half a year)
  DELETE FROM public.integration_runs WHERE started_at < now() - interval '400 days';
  DELETE FROM public.integration_issues
   WHERE (resolved_at < now() - interval '180 days')
      OR (dismissed_at IS NOT NULL AND last_seen_at < now() - interval '180 days');

  INSERT INTO public.integration_runs (connection, kind, scope, trigger, runner, dry_run)
  VALUES (p_connection, p_kind, v_scope, v_trigger, v_runner, coalesce(v_options->>'dry_run' = 'true', false))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'run', v_id,
    'kind', p_kind,
    'scope', v_scope,
    'today', to_char(v_today, 'YYYY-MM-DD'),
    'settings', v_c.settings,
    'capabilities', jsonb_build_object(
      'version', 2,
      'member_keys', jsonb_build_array('firstname', 'lastname', 'birthday', 'mobile', 'email', 'groups',
                                       'link_to', 'problem'),
      'event_keys', jsonb_build_array('calendar', 'title', 'starts_on', 'ends_on', 'all_day', 'time_from',
                                      'time_to', 'location', 'max_participants', 'description', 'url',
                                      'cancelled', 'participants', 'problem'),
      'calendar_targets', jsonb_build_array('event', 'break', 'ignore'),
      'max_records_per_call', 1000)
  );
END;
$$;

-----------------
-- Webling: dates and all day owned, the description no longer
-----------------

-- The portal link is the link's url (the event page links to it), so the
-- description is the app's for linked events too (it stays read-only on the
-- page while linked; the field is free in the database)
UPDATE public.integration_connections
   SET field_policy = (field_policy - 'event.description') || '{"event.all_day": "owned"}',
       updated_at = now()
 WHERE id = 'webling';

-- Descriptions that only repeat the link's url (the legacy sync's portal
-- link) are cleared; the layer does the same for events it links later
UPDATE public.events e
   SET description = NULL
  FROM public.event_links l
  JOIN public.integration_connections c ON c.id = l.connection
 WHERE l.event_id = e.id AND l.gone_at IS NULL
   AND NOT (c.field_policy ? 'event.description')
   AND e.description = l.url;

-----------------
-- Webling's "Ferien und Feiertage" fills the training plan's holidays
-----------------

-- A period of at most 3 days closes the dojo (public holidays, bridge
-- days), longer ones are school holidays (A13); the TK's "Dojo zu" wins
-- afterwards. Left alone when an admin mapped the calendar otherwise.
UPDATE public.integration_calendars
   SET target = 'break', closed_max_days = coalesce(closed_max_days, 3), updated_at = now()
 WHERE connection = 'webling' AND name = 'Ferien und Feiertage' AND target = 'event';

-- Events still linked to a calendar that holds holidays now (only after the
-- phase 3 switch; before it nothing is linked and the legacy sync's holiday
-- events are replaced by the first layer run, integration_write_event).
-- Here rather than in the next run, which would count them under the
-- events gone guard: unused ones of this year are deleted (the next run
-- brings them as holidays), the others stay as the app's (gone link).
DO $$
DECLARE
  v_from text := to_char(date_trunc('year', (now() AT TIME ZONE 'Europe/Zurich')::date), 'YYYY-MM-DD');
  v_deleted integer;
  v_kept integer;
BEGIN
  WITH del AS (
    DELETE FROM public.events e
     USING public.event_links l, public.integration_calendars ic, public.integration_connections c
     WHERE l.event_id = e.id AND l.gone_at IS NULL AND ic.id = l.calendar_id AND ic.target = 'break'
       AND c.id = l.connection AND coalesce(e.date_to, e.date) >= v_from
       AND public.integration_event_unused(e.id, c)
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM del;

  UPDATE public.event_links l SET gone_at = now()
    FROM public.integration_calendars ic
   WHERE ic.id = l.calendar_id AND ic.target = 'break' AND l.gone_at IS NULL;
  GET DIAGNOSTICS v_kept = ROW_COUNT;

  RAISE NOTICE 'holiday events: % deleted, % kept as the app''s', v_deleted, v_kept;
END;
$$;

-----------------
-- Function privileges (see 20261029120000): event_all_day runs in the
-- writer's trigger, so the API roles that write events may execute it
-----------------
REVOKE EXECUTE ON FUNCTION
  public.trigger_event_all_day(),
  public.integration_event_unused(integer, public.integration_connections)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.event_all_day(boolean, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_all_day(boolean, boolean, text, text) TO authenticated, service_role;
