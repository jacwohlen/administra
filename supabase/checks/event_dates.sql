-- Checks for end dates, all-day events and Webling's holidays
-- (integrations phase 4, 20261030120000_event_end_dates_and_holidays.sql,
-- docs/INTEGRATIONS.md, docs/TRAINING_PLAN.md).
--
-- Runs like integration_layer.sql: on a database with every migration and
-- the seed, as postgres, inside one transaction that is rolled back; each
-- scenario sits in a savepoint. A failed check raises and stops:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/checks/event_dates.sql
--
--   B  what the migration left behind (meaningful on a database that had
--      events before it: the prod order; trivially true after a reset)
--   A  all day: 00:00 to 00:00 is all day, whoever writes; the legacy sync
--      (a start it moves takes the last day along, events_keep_span)
--   C  the date checks
--   O  the app's overlap filters (multi-day events, the year boundary)
--   P  capabilities version 2 and Webling's field policy
--   L  the layer writes end dates and all day
--   H  "Ferien und Feiertage" fills the holidays; the legacy sync's holiday
--      events before the switch, and after a rollback to it
--   I  issues of phase 4's records (integration_note_event_issues of the
--      integration layer): a holiday's issue names its calendar, no event;
--      an event under way is not over until its last day

\set ON_ERROR_STOP 1
\o /dev/null
SET client_min_messages = notice;

BEGIN;

-----------------
-- Helpers (as in integration_layer.sql)
-----------------

CREATE FUNCTION pg_temp.ok(p_name text, p_cond boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: %', p_name;
  END IF;
  RAISE NOTICE 'ok   %', p_name;
END $$;

CREATE FUNCTION pg_temp.eq(p_name text, p_actual text, p_expected text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'FAIL: %: got %, expected %', p_name, coalesce(p_actual, 'NULL'), coalesce(p_expected, 'NULL');
  END IF;
  RAISE NOTICE 'ok   %', p_name;
END $$;

-- The SQLSTATE and message prefix (or constraint) a statement raises, '' when it does not
CREATE FUNCTION pg_temp.err(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_constraint text;
BEGIN
  EXECUTE p_sql;
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
  RETURN SQLSTATE || ' ' || coalesce(nullif(v_constraint, ''), split_part(SQLERRM, ':', 1));
END $$;

CREATE FUNCTION pg_temp.sign_up(p_id uuid, p_email text, p_role text) RETURNS uuid
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  VALUES ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
          now(), '{}', '{}', now(), now());
  UPDATE public.user_profiles SET role = p_role::public.user_role, status = 'approved' WHERE user_id = p_id;
  RETURN p_id;
END $$;

CREATE FUNCTION pg_temp.act_as(p_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
END $$;

CREATE FUNCTION pg_temp.as_sync() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role": "service_role"}', true);
  SET LOCAL ROLE service_role;
END $$;

-- One whole run as the current role (begin, stage, apply, finish); the
-- apply's answer plus the final status as 'final'
CREATE FUNCTION pg_temp.run(p_kind text, p_scope jsonb, p_records jsonb, p_dry boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_run bigint;
  v_applied jsonb;
  v_finished jsonb;
BEGIN
  v_run := (public.integration_begin('webling', p_kind,
              jsonb_build_object('scope', p_scope, 'dry_run', p_dry, 'runner', 'check:1'))->>'run')::bigint;
  PERFORM public.integration_stage(v_run, p_records);
  v_applied := public.integration_apply(v_run, '{}');
  v_finished := public.integration_finish(v_run, '{"errors": 0}');
  RETURN v_applied || jsonb_build_object('final', v_finished->>'status');
END $$;

-- A day relative to today, as the app and the sync write it
CREATE FUNCTION pg_temp.d(p_day integer) RETURNS text
LANGUAGE sql AS $$ SELECT to_char(current_date + p_day, 'YYYY-MM-DD') $$;

CREATE FUNCTION pg_temp.link(p_id integer) RETURNS text
LANGUAGE sql AS $$ SELECT 'https://club.webling.ch/portal#/calendar/event/' || p_id $$;

-- The legacy sync's event upsert (events.py: PostgREST merge-duplicates on
-- the primary key, times as Webling has them, portal link as description)
CREATE FUNCTION pg_temp.legacy_upsert(p_id integer, p_title text, p_date text, p_from text, p_to text,
                                      p_section text DEFAULT 'General') RETURNS void
LANGUAGE sql AS $$
  INSERT INTO public.events (id, title, description, date, "timeFrom", "timeTo", section)
  VALUES (p_id, p_title, pg_temp.link(p_id), p_date, p_from, p_to, p_section)
  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description,
    date = EXCLUDED.date, "timeFrom" = EXCLUDED."timeFrom", "timeTo" = EXCLUDED."timeTo",
    section = EXCLUDED.section;
$$;

-- An event record as the Webling adapter stages it (version 2)
CREATE FUNCTION pg_temp.rec(p_id integer, p_cal text, p_cal_name text, p_title text, p_data jsonb) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT jsonb_build_object('external_id', p_id::text, 'data',
    jsonb_build_object('calendar', jsonb_build_object('id', p_cal, 'name', p_cal_name), 'title', p_title,
                       'url', pg_temp.link(p_id)) || p_data);
$$;

-- Webling's id of "Ferien und Feiertage": c7 until a run has bound it
CREATE FUNCTION pg_temp.holidays() RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce((SELECT external_id FROM public.integration_calendars
                    WHERE connection = 'webling' AND name = 'Ferien und Feiertage' LIMIT 1), 'c7');
$$;

CREATE FUNCTION pg_temp.scope(p_calendar text) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT jsonb_build_object('complete', true, 'calendars', jsonb_build_array(p_calendar),
                            'from', to_char(current_date - 100, 'YYYY-MM-DD'));
$$;

CREATE FUNCTION pg_temp.ev(p_id integer) RETURNS text
LANGUAGE sql AS $$
  SELECT concat_ws('|', date, coalesce(date_to, '-'), all_day::text, coalesce("timeFrom", '-'), coalesce("timeTo", '-'),
                   coalesce(description, '-'))
    FROM public.events WHERE id = p_id;
$$;

-- The events the app shows for one day (dashboard "Aktuell", check-in):
-- date <= day AND (date >= day OR date_to >= day), as PostgREST sends it
CREATE FUNCTION pg_temp.on_day(p_day text, p_min integer) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(id::text, ',' ORDER BY id), '') FROM public.events
   WHERE id BETWEEN p_min AND 92099 AND date <= p_day AND (date >= p_day OR date_to >= p_day);
$$;

-----------------
-- B What the migration left behind
-----------------
SAVEPOINT s;
DO $$
BEGIN
  PERFORM pg_temp.eq('B1 no unlinked event keeps its last day as a first description line',
    (SELECT count(*)::text FROM (
       SELECT e.date, regexp_match(split_part(e.description, E'\n', 1),
                                   '^\s*(?:bis|until)\s+(\d{1,2})\.(\d{1,2})\.(\d{4})\s*$', 'i') AS m
         FROM public.events e
        WHERE e.date_to IS NULL
          AND NOT EXISTS (SELECT 1 FROM public.event_links l WHERE l.event_id = e.id AND l.gone_at IS NULL)) x
      WHERE x.m IS NOT NULL
        AND public.integration_iso_date(x.m[3] || '-' || lpad(x.m[2], 2, '0') || '-' || lpad(x.m[1], 2, '0'),
                                        '1900-01-01', '2200-12-31') > x.date), '0');
  PERFORM pg_temp.eq('B2 no event stored as 00:00 to 00:00, all-day events without times',
    (SELECT count(*)::text FROM public.events
      WHERE ("timeFrom" = '00:00' AND coalesce("timeTo", '00:00') = '00:00')
         OR (all_day AND ("timeFrom" IS NOT NULL OR "timeTo" IS NOT NULL))), '0');
  PERFORM pg_temp.eq('B3 no linked Webling event repeats its portal link as description',
    (SELECT count(*)::text FROM public.events e JOIN public.event_links l ON l.event_id = e.id AND l.gone_at IS NULL
      WHERE l.connection = 'webling' AND e.description = l.url), '0');
  PERFORM pg_temp.eq('B4 no event linked to a calendar that holds holidays',
    (SELECT count(*)::text FROM public.event_links l JOIN public.integration_calendars ic ON ic.id = l.calendar_id
      WHERE l.gone_at IS NULL AND ic.target = 'break'), '0');
  PERFORM pg_temp.eq('B5 "Ferien und Feiertage" holds holidays; up to 3 days close the dojo',
    (SELECT string_agg(target || '/' || closed_max_days, ',') FROM public.integration_calendars
      WHERE connection = 'webling' AND name = 'Ferien und Feiertage'), 'break/3');
  PERFORM pg_temp.ok('B6 the date check (NOT VALID) and the overlap index exist',
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_date_check' AND conrelid = 'public.events'::regclass)
    AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'events_date_span_idx'));
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- A All day, whoever writes; the legacy sync keeps working (also with a
--   last day it does not know)
-----------------
SAVEPOINT s;
DO $$
DECLARE
  v_trainer uuid := pg_temp.sign_up('a0000000-0000-0000-0000-000000000021', 'ed-trainer@example.com', 'trainer');
  r jsonb;
BEGIN
  PERFORM pg_temp.as_sync();
  PERFORM pg_temp.legacy_upsert(91001, 'Sommerlager', pg_temp.d(30), '00:00', '00:00');
  PERFORM pg_temp.legacy_upsert(91002, 'Training', pg_temp.d(31), '18:30', '20:00', 'Judo');
  PERFORM pg_temp.legacy_upsert(91003, 'Ohne Ende', pg_temp.d(32), '00:00', NULL);
  RESET ROLE;
  PERFORM pg_temp.eq('A1 the legacy sync''s 00:00 to 00:00 is all day without times',
    pg_temp.ev(91001), pg_temp.d(30) || '|-|true|-|-|' || pg_temp.link(91001));
  PERFORM pg_temp.eq('A1 a timed event stays timed', pg_temp.ev(91002), pg_temp.d(31) || '|-|false|18:30|20:00|' || pg_temp.link(91002));
  PERFORM pg_temp.eq('A1 00:00 without an end is all day', pg_temp.ev(91003), pg_temp.d(32) || '|-|true|-|-|' || pg_temp.link(91003));

  PERFORM pg_temp.as_sync();
  PERFORM pg_temp.legacy_upsert(91001, 'Sommerlager', pg_temp.d(30), '00:00', '00:00');
  PERFORM pg_temp.legacy_upsert(91003, 'Ohne Ende', pg_temp.d(32), '10:00', '12:00');
  RESET ROLE;
  PERFORM pg_temp.eq('A2 the nightly upsert keeps it all day', pg_temp.ev(91001),
    pg_temp.d(30) || '|-|true|-|-|' || pg_temp.link(91001));
  PERFORM pg_temp.eq('A2 real times from Webling make it timed again', pg_temp.ev(91003),
    pg_temp.d(32) || '|-|false|10:00|12:00|' || pg_temp.link(91003));

  -- The app (form): all day drops the times; unticked with times: timed
  PERFORM pg_temp.act_as(v_trainer);
  INSERT INTO public.events (id, title, date, date_to, all_day, "timeFrom", "timeTo", section)
  VALUES (91004, 'Lager', pg_temp.d(40), pg_temp.d(42), true, '09:00', '17:00', 'Judo');
  UPDATE public.events SET all_day = false, "timeFrom" = '09:00', "timeTo" = '17:00' WHERE id = 91001;
  UPDATE public.events SET all_day = true WHERE id = 91002;
  RESET ROLE;
  PERFORM pg_temp.eq('A3 the form''s all day drops the times', pg_temp.ev(91004), pg_temp.d(40) || '|' || pg_temp.d(42) || '|true|-|-|-');
  PERFORM pg_temp.eq('A3 unticked with times: timed', pg_temp.ev(91001),
    pg_temp.d(30) || '|-|false|09:00|17:00|' || pg_temp.link(91001));
  PERFORM pg_temp.eq('A3 ticked: the times go', pg_temp.ev(91002), pg_temp.d(31) || '|-|true|-|-|' || pg_temp.link(91002));

  -- Legacy registrations as before
  PERFORM pg_temp.as_sync();
  INSERT INTO public.event_participants ("eventId", "memberId", "attendanceStatus", notes)
  VALUES (91002, (SELECT min(id) FROM public.members), 'registered', 'Imported from Webling - Confirmed: confirmed')
  ON CONFLICT DO NOTHING;
  RESET ROLE;
  PERFORM pg_temp.ok('A4 legacy registrations as before',
    EXISTS (SELECT 1 FROM public.event_participants WHERE "eventId" = 91002));

  -- A last day the app (Bis) gave a Webling event, or a layer run before a
  -- rollback: the legacy sync, which knows none, moves the start
  PERFORM pg_temp.as_sync();
  PERFORM pg_temp.legacy_upsert(91005, 'Lager', pg_temp.d(50), '09:00', '17:00', 'Judo');
  RESET ROLE;
  PERFORM pg_temp.act_as(v_trainer);
  UPDATE public.events SET date_to = pg_temp.d(52) WHERE id = 91005;
  RESET ROLE;
  PERFORM pg_temp.as_sync();
  PERFORM pg_temp.legacy_upsert(91005, 'Lager', pg_temp.d(57), '09:00', '17:00', 'Judo');
  RESET ROLE;
  PERFORM pg_temp.eq('A5 the legacy sync moves the start later: the last day moves along, no error',
    pg_temp.ev(91005), pg_temp.d(57) || '|' || pg_temp.d(59) || '|false|09:00|17:00|' || pg_temp.link(91005));
  PERFORM pg_temp.as_sync();
  PERFORM pg_temp.legacy_upsert(91005, 'Lager', pg_temp.d(57), '09:00', '17:00', 'Judo');
  RESET ROLE;
  PERFORM pg_temp.eq('A5 the same start again: unchanged',
    pg_temp.ev(91005), pg_temp.d(57) || '|' || pg_temp.d(59) || '|false|09:00|17:00|' || pg_temp.link(91005));
  PERFORM pg_temp.as_sync();
  PERFORM pg_temp.legacy_upsert(91005, 'Lager', pg_temp.d(45), '09:00', '17:00', 'Judo');
  RESET ROLE;
  PERFORM pg_temp.eq('A5 earlier: still three days, not stretched',
    pg_temp.ev(91005), pg_temp.d(45) || '|' || pg_temp.d(47) || '|false|09:00|17:00|' || pg_temp.link(91005));

  -- Staff send both days (the form checks them): nothing moves along
  PERFORM pg_temp.act_as(v_trainer);
  UPDATE public.events SET date = pg_temp.d(46), date_to = pg_temp.d(47) WHERE id = 91005;
  PERFORM pg_temp.eq('A6 staff: a start after the last day is refused, not moved along',
    pg_temp.err(format($q$UPDATE public.events SET date = %L WHERE id = 91005$q$, pg_temp.d(48))),
    '23514 events_date_to_check');
  RESET ROLE;
  PERFORM pg_temp.eq('A6 staff move only the start: the last day stays as sent',
    pg_temp.ev(91005), pg_temp.d(46) || '|' || pg_temp.d(47) || '|false|09:00|17:00|' || pg_temp.link(91005));

  -- The layer (SECURITY DEFINER, current_user its owner) writes the last day it gets
  PERFORM pg_temp.as_sync();
  PERFORM pg_temp.run('events', '{"complete": false}', jsonb_build_array(
    pg_temp.rec(91006, 'c1', 'Judo Agenda', 'Seminar',
                jsonb_build_object('starts_on', pg_temp.d(70), 'ends_on', pg_temp.d(74), 'all_day', true))));
  r := pg_temp.run('events', '{"complete": false}', jsonb_build_array(
    pg_temp.rec(91006, 'c1', 'Judo Agenda', 'Seminar',
                jsonb_build_object('starts_on', pg_temp.d(72), 'ends_on', pg_temp.d(74), 'all_day', true))));
  RESET ROLE;
  PERFORM pg_temp.eq('A7 a layer run moves the start, the same last day: kept as sent',
    concat_ws(' ', r->>'final', r->'result'->>'updated', pg_temp.ev(91006)),
    'ok 1 ' || pg_temp.d(72) || '|' || pg_temp.d(74) || '|true|-|-|-');
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- C The date checks
-----------------
SAVEPOINT s;
DO $$
DECLARE
  v_trainer uuid := pg_temp.sign_up('a0000000-0000-0000-0000-000000000022', 'ed-c@example.com', 'trainer');
BEGIN
  PERFORM pg_temp.act_as(v_trainer);
  PERFORM pg_temp.eq('C1 a date that is not YYYY-MM-DD is refused',
    pg_temp.err($q$INSERT INTO public.events (title, date, section) VALUES ('x', '2026-1-5', 'Judo')$q$),
    '23514 events_date_check');
  PERFORM pg_temp.eq('C2 an end before or on the start is refused',
    pg_temp.err(format($q$INSERT INTO public.events (title, date, date_to, section) VALUES ('x', %L, %L, 'Judo')$q$,
                       pg_temp.d(5), pg_temp.d(5))), '23514 events_date_to_check');
  RESET ROLE;
  PERFORM pg_temp.as_sync();
  PERFORM pg_temp.eq('C3 the legacy sync cannot write a date it could not read either',
    pg_temp.err($q$SELECT pg_temp.legacy_upsert(91010, 'x', '2026-13-45 10:00:00', NULL, NULL)$q$),
    '23514 events_date_check');
  RESET ROLE;
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- O The app's overlap filters
-----------------
SAVEPOINT s;
DO $$
DECLARE
  v_viewer uuid := pg_temp.sign_up('a0000000-0000-0000-0000-000000000023', 'ed-o@example.com', 'viewer');
BEGIN
  INSERT INTO public.events (id, title, date, date_to, section) VALUES
    (92001, 'Turnier', '2031-11-14', NULL, 'Judo'),
    (92002, 'Lager', '2031-11-13', '2031-11-16', 'Judo'),
    (92003, 'Silvesterlager', '2031-12-30', '2032-01-02', 'Judo'),
    (92004, 'Kurs', '2031-11-17', NULL, 'Judo'),
    (92005, 'Läuft', pg_temp.d(-2), pg_temp.d(1), 'Judo'),
    (92006, 'Vorbei', pg_temp.d(-5), pg_temp.d(-1), 'Judo');
  PERFORM pg_temp.act_as(v_viewer);
  PERFORM pg_temp.eq('O1 a day inside a multi-day event shows it', pg_temp.on_day('2031-11-15', 92001), '92002');
  PERFORM pg_temp.eq('O1 its first day shows it next to the one-day event', pg_temp.on_day('2031-11-14', 92001), '92001,92002');
  PERFORM pg_temp.eq('O1 the day after shows only that day''s', pg_temp.on_day('2031-11-17', 92001), '92004');
  PERFORM pg_temp.eq('O2 New Year''s Day shows the event from the year before', pg_temp.on_day('2032-01-01', 92001), '92003');
  PERFORM pg_temp.eq('O2 a year (training plan) holds what overlaps it',
    (SELECT string_agg(id::text, ',' ORDER BY id) FROM public.events
      WHERE id BETWEEN 92001 AND 92099 AND date <= '2032-12-31' AND (date >= '2032-01-01' OR date_to >= '2032-01-01')), '92003');
  PERFORM pg_temp.eq('O3 today: ongoing, not past; past by the end',
    concat_ws(' ', pg_temp.on_day(pg_temp.d(0), 92005),
              (SELECT string_agg(id::text, ',' ORDER BY id) FROM public.events
                WHERE id BETWEEN 92005 AND 92099 AND coalesce(date_to, date) < pg_temp.d(0))), '92005 92006');
  PERFORM pg_temp.eq('O4 exam days link to events not over yet',
    (SELECT string_agg(id::text, ',' ORDER BY id) FROM public.events
      WHERE id BETWEEN 92005 AND 92099 AND (date >= pg_temp.d(0) OR date_to >= pg_temp.d(0))), '92005');
  RESET ROLE;
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- P Capabilities version 2 and Webling's field policy
-----------------
SAVEPOINT s;
DO $$
DECLARE
  r jsonb;
BEGIN
  PERFORM pg_temp.as_sync();
  r := public.integration_begin('webling', 'events', '{"scope": {"complete": false}, "dry_run": true}');
  PERFORM public.integration_finish((r->>'run')::bigint, '{}');
  RESET ROLE;
  PERFORM pg_temp.eq('P1 capabilities version 2', r->'capabilities'->>'version', '2');
  PERFORM pg_temp.ok('P1 events take ends_on and all_day',
    r->'capabilities'->'event_keys' @> '["ends_on", "all_day"]'::jsonb);
  PERFORM pg_temp.eq('P2 Webling owns dates and all day, no longer the description',
    (SELECT concat_ws('/', field_policy->>'event.date', field_policy->>'event.date_to', field_policy->>'event.all_day',
                      coalesce(field_policy->>'event.description', 'absent'))
       FROM public.integration_connections WHERE id = 'webling'), 'owned/owned/owned/absent');
  PERFORM pg_temp.ok('P3 the policy check knows event.all_day and still refuses unknown fields',
    public.integration_field_policy_ok('{"event.all_day": "owned"}')
    AND NOT public.integration_field_policy_ok('{"event.weather": "owned"}'));
  PERFORM pg_temp.eq('P4 all day drops the times a record sends; a bad value is noted',
    concat_ws(' ', public.integration_normalize_event(
                     '{"calendar": {"id": "c"}, "title": "T", "starts_on": "2031-05-01", "all_day": true,
                       "time_from": "00:00", "time_to": "00:00"}') - 'calendar' - 'title' - 'cancelled',
              public.integration_normalize_event(
                     '{"calendar": {"id": "c"}, "title": "T", "starts_on": "2031-05-01", "all_day": "ja"}')->>'invalid'),
    '{"all_day": true, "invalid": [], "time_to": null, "starts_on": "2031-05-01", "time_from": null} ["all_day"]');
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- L The layer writes end dates and all day
-----------------
SAVEPOINT s;
DO $$
DECLARE
  v_trainer uuid := pg_temp.sign_up('a0000000-0000-0000-0000-000000000024', 'ed-l@example.com', 'trainer');
  v_recs jsonb;
  r jsonb;
BEGIN
  v_recs := jsonb_build_array(
    pg_temp.rec(93001, 'c1', 'Judo Agenda', 'Lager', jsonb_build_object('starts_on', pg_temp.d(10), 'ends_on', pg_temp.d(12),
      'all_day', true, 'time_from', '00:00', 'time_to', '00:00', 'description', pg_temp.link(93001))),
    pg_temp.rec(93002, 'c1', 'Judo Agenda', 'Training', jsonb_build_object('starts_on', pg_temp.d(20), 'all_day', false,
      'time_from', '18:30', 'time_to', '20:00')),
    pg_temp.rec(93003, 'c1', 'Judo Agenda', 'Seminar', jsonb_build_object('starts_on', pg_temp.d(-102), 'ends_on', pg_temp.d(-99),
      'all_day', true)),
    pg_temp.rec(93004, 'c1', 'Judo Agenda', 'Kurz', jsonb_build_object('starts_on', pg_temp.d(25), 'ends_on', pg_temp.d(24),
      'all_day', false, 'time_from', '10:00', 'time_to', '11:00')));
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('events', pg_temp.scope('c1'), v_recs);
  RESET ROLE;
  PERFORM pg_temp.eq('L1 inserted, none out of the window (it ends inside it)',
    concat_ws('/', r->>'final', r->'result'->>'inserted', r->'result'->>'out_of_scope'), 'ok/4/0');
  PERFORM pg_temp.eq('L1 a multi-day all-day event: end date, no times, no description',
    pg_temp.ev(93001), pg_temp.d(10) || '|' || pg_temp.d(12) || '|true|-|-|-');
  PERFORM pg_temp.eq('L1 a timed one', pg_temp.ev(93002), pg_temp.d(20) || '|-|false|18:30|20:00|-');
  PERFORM pg_temp.eq('L1 an end before the start is dropped', pg_temp.ev(93004), pg_temp.d(25) || '|-|false|10:00|11:00|-');

  PERFORM pg_temp.as_sync();
  r := pg_temp.run('events', pg_temp.scope('c1'), v_recs);
  RESET ROLE;
  PERFORM pg_temp.eq('L2 the same records again: unchanged', concat_ws('/', r->>'final', r->'result'->>'unchanged'), 'ok/4');

  -- Webling: the camp gets times, the training becomes all day (its times are only filled)
  v_recs := jsonb_set(v_recs, '{0,data}', (v_recs->0->'data') || '{"all_day": false, "time_from": "09:00", "time_to": "17:00"}');
  v_recs := jsonb_set(v_recs, '{1,data}', (v_recs->1->'data') || '{"all_day": true, "time_from": null, "time_to": null}');
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('events', pg_temp.scope('c1'), v_recs);
  RESET ROLE;
  PERFORM pg_temp.eq('L3 all day changed in Webling: updated', r->'result'->>'updated', '2');
  PERFORM pg_temp.eq('L3 timed now', pg_temp.ev(93001), pg_temp.d(10) || '|' || pg_temp.d(12) || '|false|09:00|17:00|-');
  PERFORM pg_temp.eq('L3 all day now, the filled times cleared', pg_temp.ev(93002), pg_temp.d(20) || '|-|true|-|-|-');

  -- An adapter of version 1 (no all_day, 00:00 to 00:00 as the legacy sync) changes nothing
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('events', '{"complete": false}', jsonb_build_array(
         pg_temp.rec(93002, 'c1', 'Judo Agenda', 'Training',
                     jsonb_build_object('starts_on', pg_temp.d(20), 'time_from', '00:00', 'time_to', '00:00'))));
  RESET ROLE;
  PERFORM pg_temp.eq('L4 a version 1 record of an all-day event: unchanged', r->'result'->>'unchanged', '1');

  -- Staff: dates and all day are Webling's, the description is the app's
  PERFORM pg_temp.act_as(v_trainer);
  PERFORM pg_temp.eq('L5 staff cannot change the end date',
    pg_temp.err($q$UPDATE public.events SET date_to = NULL WHERE id = 93001$q$), 'P0001 MANAGED_BY_PROVIDER');
  PERFORM pg_temp.eq('L5 nor all day',
    pg_temp.err($q$UPDATE public.events SET all_day = true WHERE id = 93001$q$), 'P0001 MANAGED_BY_PROVIDER');
  UPDATE public.events SET description = 'Mit Übernachtung' WHERE id = 93001;
  RESET ROLE;
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('events', pg_temp.scope('c1'), v_recs);
  RESET ROLE;
  PERFORM pg_temp.eq('L5 the app''s description stays', (SELECT description FROM public.events WHERE id = 93001),
    'Mit Übernachtung');

  -- A legacy event (portal link as description) adopted: the link is the link's url now
  PERFORM pg_temp.as_sync();
  PERFORM pg_temp.legacy_upsert(93005, 'Altes', pg_temp.d(5), '00:00', '00:00', 'Judo');
  r := pg_temp.run('events', '{"complete": false}', jsonb_build_array(
         pg_temp.rec(93005, 'c1', 'Judo Agenda', 'Altes', jsonb_build_object('starts_on', pg_temp.d(5), 'ends_on', pg_temp.d(6),
                     'all_day', true))));
  RESET ROLE;
  PERFORM pg_temp.eq('L6 adopted: end date, the portal link leaves the description',
    concat_ws(' ', r->'result'->>'adopted', pg_temp.ev(93005)), '1 ' || pg_temp.d(5) || '|' || pg_temp.d(6) || '|true|-|-|-');
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- H Holidays: "Ferien und Feiertage" fills training_plan_breaks
-----------------
SAVEPOINT s;
DO $$
DECLARE
  v_tk uuid := pg_temp.sign_up('a0000000-0000-0000-0000-000000000025', 'ed-tk@example.com', 'trainer');
  v_recs jsonb;
  r jsonb;
BEGIN
  UPDATE public.user_profiles SET exam_role = 'manager' WHERE user_id = v_tk;
  INSERT INTO public.training_plan_breaks (title, date_from, date_to, cancels_training)
  VALUES ('Herbstferien', pg_temp.d(10), pg_temp.d(23), false);

  -- Before the switch: the legacy sync writes the holidays as events, as today
  PERFORM pg_temp.as_sync();
  PERFORM pg_temp.legacy_upsert(94001, 'Herbstferien', pg_temp.d(10), '00:00', '00:00');
  PERFORM pg_temp.legacy_upsert(94002, 'Feiertag', pg_temp.d(30), '00:00', '00:00');
  PERFORM pg_temp.legacy_upsert(94003, 'Weihnachtsferien', pg_temp.d(50), '00:00', '00:00');
  PERFORM pg_temp.legacy_upsert(94004, 'Brückentag', pg_temp.d(40), '00:00', '00:00');
  PERFORM pg_temp.legacy_upsert(94005, 'Auffahrt', pg_temp.d(60), '00:00', '00:00');
  RESET ROLE;
  PERFORM pg_temp.eq('H1 the legacy sync still writes holiday events',
    (SELECT count(*)::text FROM public.events WHERE id BETWEEN 94001 AND 94005 AND all_day AND section = 'General'), '5');
  -- Used in the app: attendance; another one's description changed in the app
  INSERT INTO public.event_logs ("eventId", "memberId", "attendedAt") VALUES (94004, (SELECT min(id) FROM public.members), now());
  UPDATE public.events SET description = 'Kein Training' WHERE id = 94005;

  -- The first layer run (the switch): holidays, the legacy events replaced
  v_recs := jsonb_build_array(
    pg_temp.rec(94001, pg_temp.holidays(), 'Ferien und Feiertage', 'Herbstferien',
                jsonb_build_object('starts_on', pg_temp.d(10), 'ends_on', pg_temp.d(23), 'all_day', true)),
    pg_temp.rec(94002, pg_temp.holidays(), 'Ferien und Feiertage', 'Feiertag', jsonb_build_object('starts_on', pg_temp.d(30), 'all_day', true)),
    pg_temp.rec(94003, pg_temp.holidays(), 'Ferien und Feiertage', 'Weihnachtsferien',
                jsonb_build_object('starts_on', pg_temp.d(50), 'ends_on', pg_temp.d(64), 'all_day', true)),
    pg_temp.rec(94004, pg_temp.holidays(), 'Ferien und Feiertage', 'Brückentag', jsonb_build_object('starts_on', pg_temp.d(40), 'all_day', true)),
    pg_temp.rec(94005, pg_temp.holidays(), 'Ferien und Feiertage', 'Auffahrt', jsonb_build_object('starts_on', pg_temp.d(60), 'all_day', true)));
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('events', pg_temp.scope(pg_temp.holidays()), v_recs, true);
  RESET ROLE;
  PERFORM pg_temp.eq('H2 a dry run deletes nothing',
    concat_ws('/', r->'result'->>'holiday_events_deleted',
              (SELECT count(*) FROM public.events WHERE id BETWEEN 94001 AND 94005)::text), '3/5');
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('events', pg_temp.scope(pg_temp.holidays()), v_recs);
  RESET ROLE;
  PERFORM pg_temp.eq('H2 holidays come (one taken over from the TK), no events',
    concat_ws('/', r->>'final', r->'result'->>'breaks_inserted', r->'result'->>'breaks_adopted',
              r->'result'->>'inserted', r->'result'->>'adopted'), 'ok/4/1/0/0');
  PERFORM pg_temp.eq('H2 the legacy holiday events go, a used one stays as the app''s',
    concat_ws('/', r->'result'->>'holiday_events_deleted', r->'result'->>'holiday_events_kept',
              (SELECT string_agg(id::text, ',' ORDER BY id) FROM public.events WHERE id BETWEEN 94001 AND 94005)),
    '3/1/94004,94005');
  PERFORM pg_temp.ok('H2 the kept one has a gone link and is reported',
    EXISTS (SELECT 1 FROM public.event_links WHERE event_id = 94004 AND gone_at IS NOT NULL)
    AND EXISTS (SELECT 1 FROM public.integration_issues WHERE code = 'event_gone_kept' AND event_id = 94004));
  PERFORM pg_temp.eq('H2 up to 3 days close the dojo, longer ones are school holidays, the TK''s choice stays',
    (SELECT string_agg(title || '=' || cancels_training || ':' || (date_to::date - date_from::date + 1), ','
                       ORDER BY date_from) FROM public.training_plan_breaks WHERE connection = 'webling'),
    'Herbstferien=false:14,Feiertag=true:1,Brückentag=true:1,Weihnachtsferien=false:15,Auffahrt=true:1');

  PERFORM pg_temp.as_sync();
  r := pg_temp.run('events', pg_temp.scope(pg_temp.holidays()), v_recs);
  RESET ROLE;
  PERFORM pg_temp.eq('H3 the next run: nothing to replace, holidays unchanged',
    concat_ws('/', r->'result'->>'holiday_events_deleted', r->'result'->>'holiday_events_kept',
              r->'result'->>'breaks_inserted', r->'result'->>'breaks_updated'), '0/0/0/0');

  -- A rollback to the legacy sync writes a holiday event again; back on the layer it goes again
  PERFORM pg_temp.as_sync();
  PERFORM pg_temp.legacy_upsert(94002, 'Feiertag', pg_temp.d(30), '00:00', '00:00');
  r := pg_temp.run('events', pg_temp.scope(pg_temp.holidays()), v_recs);
  RESET ROLE;
  PERFORM pg_temp.eq('H4 after a rollback the layer replaces it again',
    concat_ws('/', r->'result'->>'holiday_events_deleted', (SELECT count(*) FROM public.events WHERE id = 94002)::text), '1/0');

  -- The TK: "Dojo zu" only
  PERFORM pg_temp.act_as(v_tk);
  UPDATE public.training_plan_breaks SET cancels_training = true WHERE external_id = '94003';
  PERFORM pg_temp.eq('H5 the TK cannot delete a Webling holiday',
    pg_temp.err($q$DELETE FROM public.training_plan_breaks WHERE external_id = '94003'$q$), 'P0001 MANAGED_BY_PROVIDER');
  RESET ROLE;
  PERFORM pg_temp.eq('H5 but sets "Dojo zu"',
    (SELECT cancels_training::text FROM public.training_plan_breaks WHERE external_id = '94003'), 'true');
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- I Issues of holidays and multi-day events
-----------------
SAVEPOINT s;
DO $$
DECLARE
  v_cal text := pg_temp.holidays();
  v_bad jsonb := jsonb_build_array(pg_temp.rec(95001, pg_temp.holidays(), 'Ferien und Feiertage', 'Feiertag',
                   jsonb_build_object('starts_on', pg_temp.d(30), 'all_day', 'ja')));
  v_part jsonb := '[{"member": "9999999", "state": "confirmed"}]';
  r jsonb;
BEGIN
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('events', pg_temp.scope(v_cal), v_bad);
  RESET ROLE;
  PERFORM pg_temp.eq('I1 a holiday with an invalid value: written, the issue names its calendar and no event',
    (SELECT concat_ws(' ', r->'result'->>'breaks_inserted', code, external_id, coalesce(event_id::text, '-'),
                      calendar, detail)
       FROM public.integration_issues WHERE kind = 'events' AND resolved_at IS NULL),
    '1 invalid_value 95001 - ' || v_cal || ' all_day');

  PERFORM pg_temp.as_sync();
  r := pg_temp.run('events', pg_temp.scope('c1'), jsonb_build_array(
         pg_temp.rec(95002, 'c1', 'Judo Agenda', 'Training', jsonb_build_object('starts_on', pg_temp.d(5)))));
  RESET ROLE;
  PERFORM pg_temp.eq('I2 a complete run of another calendar leaves the holiday''s issue open',
    (SELECT (resolved_at IS NULL)::text FROM public.integration_issues WHERE external_id = '95001'), 'true');

  PERFORM pg_temp.as_sync();
  r := pg_temp.run('events', pg_temp.scope(v_cal), jsonb_set(v_bad, '{0,data,all_day}', 'true'));
  RESET ROLE;
  PERFORM pg_temp.eq('I3 the holiday calendar read with the record fixed resolves it',
    (SELECT (resolved_at IS NOT NULL)::text FROM public.integration_issues WHERE external_id = '95001'), 'true');

  -- A camp under way since the day before yesterday, until the day after tomorrow
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('events', '{"complete": false}', jsonb_build_array(
         pg_temp.rec(95003, 'c1', 'Judo Agenda', 'Lager', jsonb_build_object('starts_on', pg_temp.d(-2),
                     'ends_on', pg_temp.d(2), 'all_day', true, 'participants', v_part))));
  RESET ROLE;
  PERFORM pg_temp.eq('I4 an unknown participant of a camp under way, with the calendar',
    (SELECT concat_ws(' ', (resolved_at IS NULL)::text, calendar) FROM public.integration_issues
      WHERE code = 'unknown_participant' AND external_id = '9999999'), 'true c1');
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('events', '{"complete": false}', jsonb_build_array(
         pg_temp.rec(95003, 'c1', 'Judo Agenda', 'Lager', jsonb_build_object('starts_on', pg_temp.d(-2),
                     'ends_on', pg_temp.d(2), 'all_day', true))));
  RESET ROLE;
  PERFORM pg_temp.eq('I4 its list could not be read while under way (begun before today): still open',
    (SELECT (resolved_at IS NULL)::text FROM public.integration_issues
      WHERE code = 'unknown_participant' AND external_id = '9999999'), 'true');
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('events', '{"complete": false}', jsonb_build_array(
         pg_temp.rec(95003, 'c1', 'Judo Agenda', 'Lager', jsonb_build_object('starts_on', pg_temp.d(-4),
                     'ends_on', pg_temp.d(-1), 'all_day', true))));
  RESET ROLE;
  PERFORM pg_temp.eq('I4 over after its last day: staged without its list, the issue resolves',
    concat_ws(' ', r->>'final', (SELECT (resolved_at IS NOT NULL)::text FROM public.integration_issues
                                  WHERE code = 'unknown_participant' AND external_id = '9999999')), 'ok true');
END $$;
ROLLBACK TO SAVEPOINT s;

ROLLBACK;

\o
\echo 'event_dates: all checks passed'
