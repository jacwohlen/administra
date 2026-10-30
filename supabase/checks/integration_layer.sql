-- Checks for the integration layer (integrations phase 2,
-- 20261029120000_integration_layer.sql, docs/INTEGRATIONS.md).
--
-- Runs like member_access.sql: on a database with every migration and the
-- seed, as postgres, inside one transaction that is rolled back; each
-- scenario sits in a savepoint. A failed check raises and stops:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/checks/integration_layer.sql
-- The sync acts as service_role, staff and admins through pg_temp.act_as().
--
--   E  the seeded catalog is the old status rule
--   P  who may call and read what (the status rule is internal)
--   M  Webling members through the layer: no-op first run, changes, guards,
--      problem records, one failing record, runs, issues, no names in the log
--   C  a CSV connection run by an admin in the app
--   G  admins change the mapping under the same guards
--   V  events, registrations, holidays
--   R  links to the provider's records (settings.record_urls)
--   L  the licence number (member.license_number) and connections on and off

\set ON_ERROR_STOP 1
\o /dev/null
SET client_min_messages = notice;

BEGIN;

-----------------
-- Helpers
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

-- The SQLSTATE and message prefix a statement raises, '' when it does not
CREATE FUNCTION pg_temp.err(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || split_part(SQLERRM, ':', 1);
END $$;

-- The message a statement raises, '' when it does not
CREATE FUNCTION pg_temp.msg(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;

-- An account with a role (NULL: waiting member account)
CREATE FUNCTION pg_temp.sign_up(p_id uuid, p_email text, p_role text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  VALUES ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
          now(), '{}', '{}', now(), now());
  IF p_role IS NOT NULL THEN
    UPDATE public.user_profiles SET role = p_role::public.user_role, status = 'approved' WHERE user_id = p_id;
  END IF;
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

-- One whole run as the current role: begin, stage (chunks of 1000), apply,
-- finish. Returns the apply's answer plus the final status as 'final'.
CREATE FUNCTION pg_temp.run(p_connection text, p_kind text, p_scope jsonb, p_records jsonb,
                            p_options jsonb DEFAULT '{}', p_dry boolean DEFAULT false,
                            p_report jsonb DEFAULT '{"errors": 0}') RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_run bigint;
  v_i integer := 0;
  v_n integer := jsonb_array_length(p_records);
  v_applied jsonb;
  v_finished jsonb;
BEGIN
  v_run := (public.integration_begin(p_connection, p_kind,
              jsonb_build_object('scope', p_scope, 'dry_run', p_dry, 'runner', 'check:1'))->>'run')::bigint;
  WHILE v_i < v_n LOOP
    PERFORM public.integration_stage(v_run, (SELECT jsonb_agg(e ORDER BY o)
      FROM jsonb_array_elements(p_records) WITH ORDINALITY x(e, o) WHERE o > v_i AND o <= v_i + 1000));
    v_i := v_i + 1000;
  END LOOP;
  v_applied := public.integration_apply(v_run, p_options);
  v_finished := public.integration_finish(v_run, p_report);
  RETURN v_applied || jsonb_build_object('final', v_finished->>'status');
END $$;

-- Group ids as Webling would have them (stable per title)
CREATE FUNCTION pg_temp.gid(p_title text) RETURNS text
LANGUAGE sql AS $$ SELECT 'g' || abs(hashtext(p_title)) $$;

-- The live Webling members as the adapter stages them: Webling's fields,
-- groups with ids, the old trial group under its Webling title
CREATE FUNCTION pg_temp.webling_snapshot() RETURNS jsonb
LANGUAGE sql AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'external_id', l.external_id,
    'data', jsonb_build_object(
      'firstname', m.firstname, 'lastname', m.lastname, 'birthday', m.birthday,
      'mobile', m.mobile, 'email', m.email,
      'groups', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', pg_temp.gid(g), 'name', g) ORDER BY o), '[]'::jsonb)
                   FROM (SELECT CASE WHEN x = 'Probetraining' THEN '04_Probetraining' ELSE x END AS g, o
                           FROM jsonb_array_elements_text(m.labels) WITH ORDINALITY y(x, o)) z)))
    ORDER BY l.external_id), '[]'::jsonb)
  FROM public.member_links l JOIN public.members m ON m.id = l.member_id
  WHERE l.connection = 'webling' AND l.gone_at IS NULL;
$$;

-- A snapshot with one record changed (data merged), added or removed
CREATE FUNCTION pg_temp.with_record(p_snap jsonb, p_id text, p_data jsonb) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT coalesce(jsonb_agg(CASE WHEN x->>'external_id' = p_id
                                 THEN jsonb_set(x, '{data}', (x->'data') || p_data) ELSE x END), '[]'::jsonb)
         || CASE WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_snap) y WHERE y->>'external_id' = p_id)
                 THEN jsonb_build_array(jsonb_build_object('external_id', p_id, 'data', p_data))
                 ELSE '[]'::jsonb END
    FROM jsonb_array_elements(p_snap) x;
$$;

CREATE FUNCTION pg_temp.without(p_snap jsonb, p_ids text[]) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM jsonb_array_elements(p_snap) x
   WHERE NOT (x->>'external_id' = ANY (p_ids));
$$;

CREATE FUNCTION pg_temp.st(p_member integer) RETURNS text
LANGUAGE sql AS $$ SELECT membership_status FROM public.members WHERE id = p_member $$;

-- Live Webling members of a status, by id
CREATE FUNCTION pg_temp.linked(p_status text, p_n integer) RETURNS text[]
LANGUAGE sql AS $$
  SELECT array_agg(l.external_id ORDER BY l.member_id) FROM (
    SELECT l.external_id, l.member_id FROM public.member_links l JOIN public.members m ON m.id = l.member_id
     WHERE l.connection = 'webling' AND l.gone_at IS NULL AND m.membership_status = p_status
       AND m."archivedAt" IS NULL AND NOT public.has_trial_label(m.labels)
     ORDER BY l.member_id LIMIT p_n) l;
$$;

-- Everything the run log holds, as text
CREATE FUNCTION pg_temp.run_log() RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(concat_ws(' ', r.scope, r.result, r.guard, r.accepted, r.adapter, r.error), ' '), '')
         || ' ' || coalesce((SELECT string_agg(concat_ws(' ', i.code, i.external_id, i.detail), ' ')
                               FROM public.integration_issues i), '')
    FROM public.integration_runs r;
$$;

-- Fixture: Webling events as the sync wrote them before the layer (portal
-- link in the description, registrations marked by the notes prefix)
CREATE TEMP TABLE fx_events (id integer, cal text, title text, day integer, time_from text, location text);
CREATE TEMP TABLE fx_part (event_id integer, external_id text);
-- the snapshots are built while acting as the sync
GRANT SELECT ON fx_events, fx_part TO service_role, authenticated;

CREATE FUNCTION pg_temp.fx_date(p_day integer) RETURNS text
LANGUAGE sql AS $$ SELECT to_char(current_date + p_day, 'YYYY-MM-DD') $$;

CREATE FUNCTION pg_temp.fx_setup() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO fx_events
  SELECT 61000 + i, CASE WHEN i <= 30 THEN 'c1' ELSE 'c2' END, 'Kurs ' || i,
         CASE WHEN i % 4 = 0 THEN -20 - i ELSE i * 3 END,
         CASE WHEN i % 3 = 0 THEN '00:00' ELSE '18:30' END,
         CASE WHEN i % 2 = 0 THEN 'Dojo' END
    FROM generate_series(1, 40) i;
  INSERT INTO public.events (id, title, date, "timeFrom", "timeTo", location, section, description)
  SELECT id, title, pg_temp.fx_date(day), time_from, CASE WHEN time_from = '00:00' THEN '00:00' ELSE '20:00' END,
         location, CASE WHEN cal = 'c1' THEN 'Judo' ELSE 'Aikido' END,
         'https://club.webling.ch/portal#/calendar/event/' || id
    FROM fx_events;
  -- registrations of the first three Webling members on 61001 and 61002
  INSERT INTO fx_part
  SELECT e, l.external_id FROM (VALUES (61001), (61002)) v(e),
         (SELECT external_id FROM public.member_links WHERE connection = 'webling' AND gone_at IS NULL
           ORDER BY member_id LIMIT 3) l;
  INSERT INTO public.event_participants ("eventId", "memberId", "attendanceStatus", notes)
  SELECT p.event_id, l.member_id, 'registered', 'Imported from Webling - Confirmed: confirmed'
    FROM fx_part p JOIN public.member_links l ON l.connection = 'webling' AND l.external_id = p.external_id;
END $$;

-- The fixture events as the adapter stages them
CREATE FUNCTION pg_temp.ev_snapshot() RETURNS jsonb
LANGUAGE sql AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'external_id', e.id::text,
    'data', jsonb_build_object(
      'calendar', jsonb_build_object('id', e.cal, 'name', CASE WHEN e.cal = 'c1' THEN 'Judo Agenda' ELSE 'Aikido Agenda' END),
      'title', e.title, 'starts_on', pg_temp.fx_date(e.day),
      'time_from', e.time_from, 'time_to', CASE WHEN e.time_from = '00:00' THEN '00:00' ELSE '20:00' END,
      'location', e.location, 'max_participants', NULL,
      'description', 'https://club.webling.ch/portal#/calendar/event/' || e.id,
      'url', 'https://club.webling.ch/portal#/calendar/event/' || e.id,
      'participants', CASE WHEN e.day >= 0 THEN (
        SELECT coalesce(jsonb_agg(jsonb_build_object('member', p.external_id, 'state', 'confirmed')
                                  ORDER BY p.external_id), '[]'::jsonb)
          FROM fx_part p WHERE p.event_id = e.id) END))
    ORDER BY e.id), '[]'::jsonb)
  FROM fx_events e;
$$;

CREATE FUNCTION pg_temp.ev_scope(p_calendars text[] DEFAULT '{c1,c2}') RETURNS jsonb
LANGUAGE sql AS $$
  SELECT jsonb_build_object('complete', true, 'calendars', to_jsonb(p_calendars),
                            'from', to_char(current_date - 100, 'YYYY-MM-DD'));
$$;

-----------------
-- E The seeded catalog is the old status rule
-----------------
SAVEPOINT s;
DO $$
BEGIN
  PERFORM pg_temp.eq('E1 stored statuses follow the catalog',
    (SELECT count(*)::text FROM public.members
      WHERE membership_status IS DISTINCT FROM public.member_status_for(id, labels)), '0');
  PERFORM pg_temp.eq('E2 every combination of status labels and link as member_status_from_labels',
    (WITH lbl(l) AS (VALUES ('03_Austritt'), ('Aktiv'), ('Passiv'), ('Ehrenmitglieder'),
                            ('Nicht-Mitglieder'), ('probetraining'), ('Probetraining'), ('Vorstand')),
          arr AS (SELECT (SELECT coalesce(jsonb_agg(l), '[]') FROM
                           (SELECT l, row_number() OVER (ORDER BY l) n FROM lbl) x
                          WHERE (i >> (n - 1)::int) & 1 = 1) a
                    FROM generate_series(0, 255) i)
     SELECT count(*)::text FROM arr, (VALUES ('active'), ('gone'), (NULL)) k(link)
      WHERE public.member_status_from_labels(a, link) IS DISTINCT FROM
            public.integration_member_status(a, CASE WHEN link = 'active' THEN 'webling' END, link)),
    '0');
  PERFORM pg_temp.eq('E3 member_status_for is phase 1b''s rule for every member',
    (SELECT count(*)::text FROM public.members m
      WHERE public.member_status_for(m.id, m.labels) IS DISTINCT FROM public.member_status_from_labels(
              m.labels, coalesce(public.provider_link_state(m.id),
                                 CASE WHEN m.id >= 1000 AND m.id < 10000000 THEN 'active' END))), '0');
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- P Who may call and read what
-----------------
SAVEPOINT s;
DO $$
DECLARE
  v_admin uuid := pg_temp.sign_up('a0000000-0000-0000-0000-00000000000a', 'p-admin@example.com', 'admin');
  v_trainer uuid := pg_temp.sign_up('a0000000-0000-0000-0000-00000000000b', 'p-trainer@example.com', 'trainer');
  v_run bigint;
BEGIN
  SET LOCAL ROLE anon;
  PERFORM pg_temp.eq('P1 anon cannot call the API',
    pg_temp.err($q$SELECT public.integration_begin('webling', 'members')$q$), '42501 permission denied for function integration_begin');
  PERFORM pg_temp.eq('P1 anon reads no configuration',
    pg_temp.err('SELECT 1 FROM public.integration_connections'), '42501 permission denied for table integration_connections');
  RESET ROLE;

  PERFORM pg_temp.act_as(v_trainer);
  PERFORM pg_temp.eq('P2 a trainer cannot run a connection',
    pg_temp.err($q$SELECT public.integration_begin('webling', 'members')$q$), '42501 NOT_ALLOWED');
  PERFORM pg_temp.eq('P2 a trainer cannot change the mapping',
    pg_temp.err($q$SELECT public.integration_set_mapping('webling', '{}')$q$), '42501 NOT_ALLOWED');
  PERFORM pg_temp.ok('P2 staff read connections, groups and calendars',
    (SELECT count(*) FROM public.integration_connections) = 2
    AND (SELECT count(*) FROM public.integration_member_groups) = 16
    AND (SELECT count(*) FROM public.integration_calendars) = 6);
  PERFORM pg_temp.eq('P2 the seeded calendars carry Webling''s titles',
    (SELECT string_agg(name, ', ' ORDER BY name) FROM public.integration_calendars),
    'Aikido Agenda, Club Agenda, Ferien und Feiertage, Judo Agenda, Judo Erwachsene Trainings, Judo Herren SMM');
  PERFORM pg_temp.eq('P2 staff cannot write the configuration',
    pg_temp.err($q$UPDATE public.integration_connections SET gone_min = 1000$q$),
    '42501 permission denied for table integration_connections');
  PERFORM pg_temp.eq('P2 staged records are nobody''s to read',
    pg_temp.err('SELECT 1 FROM public.integration_records'), '42501 permission denied for table integration_records');
  RESET ROLE;

  PERFORM pg_temp.act_as(v_admin);
  PERFORM pg_temp.eq('P3 an admin cannot run a connection that runs in the sync',
    pg_temp.err($q$SELECT public.integration_begin('webling', 'members')$q$), '42501 NOT_ALLOWED');
  PERFORM pg_temp.eq('P3 an admin cannot write runs or the catalog directly',
    pg_temp.err($q$UPDATE public.integration_member_groups SET status = 'active'$q$),
    '42501 permission denied for table integration_member_groups');
  PERFORM pg_temp.ok('P3 an admin reads the status summary',
    jsonb_array_length(public.integration_status()) = 2);
  RESET ROLE;

  -- PostgREST logs in as 'authenticator' and always switches to an API role;
  -- without one nothing is allowed. Only a superuser may become another
  -- session user: the local postgres is one, the postgres of the Supabase
  -- CLI (CI) is not, so there the login role is checked by its privileges.
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = session_user) THEN
    SET LOCAL SESSION AUTHORIZATION authenticator;
    PERFORM pg_temp.eq('P4 the PostgREST login role alone is not the sync',
      pg_temp.err($q$SELECT public.integration_begin('webling', 'members')$q$), '42501 permission denied for function integration_begin');
  ELSE
    PERFORM pg_temp.ok('P4 the PostgREST login role alone is not the sync',
      NOT has_function_privilege('authenticator', 'public.integration_begin(text, text, jsonb)', 'EXECUTE'));
  END IF;
  SET LOCAL ROLE service_role;
  v_run := (public.integration_begin('webling', 'members', '{"dry_run": true}')->>'run')::bigint;
  PERFORM pg_temp.ok('P4 through PostgREST with the service role key: allowed', v_run IS NOT NULL);
  RESET ROLE;
  -- back to the login user (allowed for anyone)
  RESET SESSION AUTHORIZATION;
  PERFORM pg_temp.eq('P5 a second open members run of the connection is refused',
    pg_temp.err($q$SELECT public.integration_begin('webling', 'members')$q$), 'PT409 RUN_IN_PROGRESS');
  PERFORM pg_temp.ok('P5 an events run may open meanwhile',
    (public.integration_begin('webling', 'events', '{}')->>'run') IS NOT NULL);
  -- a run left open for over an hour is closed by the next begin
  UPDATE public.integration_runs SET started_at = now() - interval '61 minutes' WHERE id = v_run;
  INSERT INTO public.integration_records (run_id, external_id, data) VALUES (v_run, '1', '{"lastname": "X"}');
  PERFORM public.integration_begin('webling', 'members', '{"dry_run": true}');
  PERFORM pg_temp.eq('P6 an abandoned run is failed',
    (SELECT status || ' ' || error FROM public.integration_runs WHERE id = v_run), 'failed abandoned');
  PERFORM pg_temp.ok('P6 its staged records are deleted',
    NOT EXISTS (SELECT 1 FROM public.integration_records WHERE run_id = v_run));
END $$;
ROLLBACK TO SAVEPOINT s;

-- The status rule is internal (20261103120000): no API role calls
-- member_status_from_labels(), yet a member staff create or edit and a
-- trial registration get their status, since the triggers run as the
-- owner (the layer's writes: M)
SAVEPOINT s;
DO $$
DECLARE
  v_trainer uuid := pg_temp.sign_up('a0000000-0000-0000-0000-00000000000c', 'p-trainer2@example.com', 'trainer');
  v_id integer;
BEGIN
  PERFORM pg_temp.ok('P7 no API role may execute member_status_from_labels',
    NOT (has_function_privilege('anon', 'public.member_status_from_labels(jsonb, text)', 'EXECUTE')
      OR has_function_privilege('authenticated', 'public.member_status_from_labels(jsonb, text)', 'EXECUTE')
      OR has_function_privilege('service_role', 'public.member_status_from_labels(jsonb, text)', 'EXECUTE')));
  PERFORM pg_temp.as_sync();
  PERFORM pg_temp.eq('P7 the sync cannot call it',
    pg_temp.err($q$SELECT public.member_status_from_labels('["Aktiv"]', 'active')$q$),
    '42501 permission denied for function member_status_from_labels');
  RESET ROLE;
  PERFORM pg_temp.act_as(v_trainer);
  PERFORM pg_temp.eq('P7 nor staff',
    pg_temp.err($q$SELECT public.member_status_from_labels('["Aktiv"]', 'active')$q$),
    '42501 permission denied for function member_status_from_labels');
  INSERT INTO public.members (firstname, lastname, labels) VALUES ('Status', 'Regel', '["probetraining"]')
  RETURNING id INTO v_id;
  RESET ROLE;
  PERFORM pg_temp.eq('P7 a member staff create gets its status', pg_temp.st(v_id), 'trial');
  PERFORM pg_temp.act_as(v_trainer);
  UPDATE public.members SET labels = '["Vorstand"]' WHERE id = v_id;
  RESET ROLE;
  PERFORM pg_temp.eq('P7 a staff edit of the labels derives it again', pg_temp.st(v_id), 'active');
  PERFORM set_config('request.jwt.claims', '{"role": "anon"}', true);
  SET LOCAL ROLE anon;
  PERFORM public.register_trial('Probe', 'Statusregel', '2010-01-01', 'p7.trial@example.com');
  RESET ROLE;
  PERFORM pg_temp.eq('P7 a trial registration gets its status',
    (SELECT string_agg(membership_status, ',') FROM public.members WHERE email = 'p7.trial@example.com'), 'trial');
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- M Webling members through the layer
-----------------
SAVEPOINT s;
DO $$
DECLARE
  v_snap jsonb;
  v_xmin jsonb;
  v_status jsonb;
  v_seen timestamptz;
  r jsonb;
BEGIN
  v_snap := pg_temp.webling_snapshot();
  v_xmin := (SELECT jsonb_object_agg(id, xmin::text) FROM public.members);
  v_status := (SELECT jsonb_object_agg(id, membership_status) FROM public.members);
  v_seen := (SELECT max(last_seen_at) FROM public.member_links);

  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', v_snap, '{}', true);
  RESET ROLE;
  PERFORM pg_temp.eq('M1 dry run of today''s snapshot: ok', r->>'final', 'ok');
  PERFORM pg_temp.ok('M1 a dry run writes no member and no link',
    NOT EXISTS (SELECT 1 FROM public.members m WHERE m.xmin::text <> v_xmin->>(m.id::text))
    AND (SELECT max(last_seen_at) FROM public.member_links) IS NOT DISTINCT FROM v_seen);
  PERFORM pg_temp.eq('M1 a dry run still binds the seeded groups to the provider ids',
    (SELECT external_id FROM public.integration_member_groups WHERE connection = 'webling' AND name = 'Aktiv'),
    pg_temp.gid('Aktiv'));

  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', v_snap);
  RESET ROLE;
  PERFORM pg_temp.eq('M2 today''s snapshot through the layer: ok', r->>'final', 'ok');
  PERFORM pg_temp.eq('M2 nothing inserted, updated, gone, revived or recomputed',
    concat_ws('/', r->'result'->>'inserted', r->'result'->>'updated', r->'result'->>'gone',
              r->'result'->>'revived', r->'result'->>'former', r->'result'->>'statuses_recomputed'),
    '0/0/0/0/0/0');
  PERFORM pg_temp.eq('M2 no member row rewritten',
    (SELECT count(*)::text FROM public.members m WHERE m.xmin::text <> v_xmin->>(m.id::text)), '0');
  PERFORM pg_temp.eq('M2 no status changed',
    (SELECT count(*)::text FROM public.members m WHERE m.membership_status <> v_status->>(m.id::text)), '0');
  PERFORM pg_temp.ok('M2 every live link seen',
    NOT EXISTS (SELECT 1 FROM public.member_links WHERE connection = 'webling' AND gone_at IS NULL
                   AND last_seen_at < now()));
  PERFORM pg_temp.ok('M2 staged records deleted', NOT EXISTS (SELECT 1 FROM public.integration_records));
  PERFORM pg_temp.eq('M2 the run log',
    (SELECT concat_ws(' ', kind, trigger, runner, status, dry_run) FROM public.integration_runs
      WHERE NOT dry_run ORDER BY id DESC LIMIT 1), 'members schedule check:1 ok f');
END $$;

-- Changes: a renamed member, one gone, a new active one (approves its
-- waiting account), a new one without a status group, one back
DO $$
DECLARE
  v_snap jsonb := pg_temp.webling_snapshot();
  v_active text[] := pg_temp.linked('active', 3);
  v_waiting uuid := pg_temp.sign_up('b0000000-0000-0000-0000-000000000001', 'neu.aktiv@example.com');
  v_waiting2 uuid := pg_temp.sign_up('b0000000-0000-0000-0000-000000000002', 'neu.ohne@example.com');
  v_gone text;
  r jsonb;
BEGIN
  -- a member Webling no longer had (left), back now
  v_gone := (pg_temp.linked('passive', 1))[1];
  UPDATE public.member_links SET gone_at = now() - interval '1 day' WHERE connection = 'webling' AND external_id = v_gone;
  v_snap := pg_temp.without(v_snap, ARRAY[v_gone]);
  v_snap := pg_temp.with_record(v_snap, v_active[1], '{"firstname": "Umbenannt"}');
  v_snap := pg_temp.without(v_snap, ARRAY[v_active[2]]);
  v_snap := pg_temp.with_record(v_snap, '77001', jsonb_build_object('firstname', 'Neu', 'lastname', 'Aktiv',
              'email', 'Neu.Aktiv@example.com', 'mobile', '', 'birthday', '2001-02-03',
              'groups', jsonb_build_array(jsonb_build_object('id', pg_temp.gid('Aktiv'), 'name', 'Aktiv'))));
  v_snap := pg_temp.with_record(v_snap, '77002', jsonb_build_object('firstname', 'Neu', 'lastname', 'Ohne',
              'email', 'neu.ohne@example.com', 'groups', '[]'::jsonb));
  v_snap := pg_temp.with_record(v_snap, v_gone, (SELECT jsonb_build_object('firstname', firstname, 'lastname', lastname,
              'groups', jsonb_build_array(jsonb_build_object('id', pg_temp.gid('Aktiv'), 'name', 'Aktiv')))
              FROM public.members WHERE id = v_gone::integer));
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', v_snap);
  RESET ROLE;
  PERFORM pg_temp.eq('M3 counts', concat_ws('/', r->'result'->>'inserted', r->'result'->>'updated',
    r->'result'->>'gone', r->'result'->>'revived'), '2/1/1/1');
  PERFORM pg_temp.eq('M3 renamed', (SELECT firstname FROM public.members WHERE id = v_active[1]::integer), 'Umbenannt');
  PERFORM pg_temp.eq('M3 gone from Webling: left', pg_temp.st(v_active[2]::integer), 'left');
  PERFORM pg_temp.eq('M3 back in Webling, in Aktiv: active', pg_temp.st(v_gone::integer), 'active');
  PERFORM pg_temp.eq('M3 new member keeps the Webling id, linked, active',
    (SELECT m.membership_status || ' ' || l.connection FROM public.members m
       JOIN public.member_links l ON l.member_id = m.id AND l.gone_at IS NULL WHERE m.id = 77001), 'active webling');
  PERFORM pg_temp.eq('M3 empty mobile stored as sent', (SELECT mobile FROM public.members WHERE id = 77001), '');
  PERFORM pg_temp.eq('M3 a new active member approves its waiting account',
    (SELECT status::text FROM public.user_profiles WHERE user_id = v_waiting), 'approved');
  PERFORM pg_temp.eq('M3 a new member without status group is a non-member from the start',
    pg_temp.st(77002), 'non_member');
  PERFORM pg_temp.eq('M3 ... and its waiting account stays waiting',
    (SELECT status::text FROM public.user_profiles WHERE user_id = v_waiting2), 'pending');
END $$;
ROLLBACK TO SAVEPOINT s;

-- Guards
SAVEPOINT s;
DO $$
DECLARE
  v_snap jsonb := pg_temp.webling_snapshot();
  v_n integer := jsonb_array_length(pg_temp.webling_snapshot());
  v_ids text[];
  v_xmin jsonb := (SELECT jsonb_object_agg(id, xmin::text) FROM public.members);
  v_gone_links bigint := (SELECT count(*) FROM public.member_links WHERE gone_at IS NOT NULL);
  r jsonb;
BEGIN
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', '[]');
  RESET ROLE;
  PERFORM pg_temp.eq('M4 an empty snapshot is refused', concat_ws(' ', r->>'final', r->'guard'->>'refused'),
    'refused empty_snapshot');

  SELECT array_agg(x->>'external_id') INTO v_ids
    FROM (SELECT x FROM jsonb_array_elements(v_snap) x ORDER BY x->>'external_id' LIMIT 60) t;
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', pg_temp.without(v_snap, v_ids));
  RESET ROLE;
  PERFORM pg_temp.eq('M4 60 of 515 gone at once is refused, with the number to accept',
    concat_ws(' ', r->>'final', r->'guard'->>'refused', r->>'hint'), 'refused members_gone accept_gone=60');
  PERFORM pg_temp.ok('M4 a refused run writes nothing',
    (SELECT count(*) FROM public.member_links WHERE gone_at IS NOT NULL) = v_gone_links
    AND NOT EXISTS (SELECT 1 FROM public.members m WHERE m.xmin::text <> v_xmin->>(m.id::text)));
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": false}', pg_temp.without(v_snap, v_ids));
  RESET ROLE;
  PERFORM pg_temp.eq('M4 a partial snapshot marks nobody gone', concat_ws(' ', r->>'final', r->'result'->>'gone'), 'ok 0');
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', pg_temp.without(v_snap, v_ids), '{"accept_gone": 59}');
  RESET ROLE;
  PERFORM pg_temp.eq('M4 only the exact number is accepted', r->>'final', 'refused');
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', pg_temp.without(v_snap, v_ids), '{"accept_gone": 60}');
  RESET ROLE;
  PERFORM pg_temp.eq('M4 accepted with the exact number',
    concat_ws(' ', r->>'final', r->'result'->>'gone', r->'accepted'->>'gone'), 'ok 60 60');
END $$;
ROLLBACK TO SAVEPOINT s;

SAVEPOINT s;
DO $$
DECLARE
  v_snap jsonb := pg_temp.webling_snapshot();
  v_no_aktiv jsonb;
  v_renamed jsonb;
  v_drop integer;
  r jsonb;
BEGIN
  -- Webling answers without the Aktiv group (emptied or mapping broken)
  SELECT jsonb_agg(jsonb_set(x, '{data,groups}', (SELECT coalesce(jsonb_agg(g), '[]') FROM jsonb_array_elements(x->'data'->'groups') g
                                                    WHERE g->>'name' <> 'Aktiv')))
    INTO v_no_aktiv FROM jsonb_array_elements(v_snap) x;
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', v_no_aktiv);
  RESET ROLE;
  v_drop := (r->'guard'->'status'->>'dropping')::integer;
  PERFORM pg_temp.eq('M5 Aktiv emptied: refused as a status drop',
    concat_ws(' ', r->>'final', r->'guard'->>'refused', r->>'hint'), 'refused status_drop accept_status_drop=' || v_drop);
  PERFORM pg_temp.ok('M5 the refusal says what they would become, by status only',
    (r->'guard'->'status'->'became'->>'non_member')::integer = v_drop AND v_drop > 5);
  PERFORM pg_temp.ok('M5 nothing written', NOT EXISTS (
    SELECT 1 FROM public.members WHERE membership_status IS DISTINCT FROM public.member_status_for(id, labels))
    AND (SELECT count(*) FROM public.members WHERE membership_status = 'active') > v_drop);

  -- Webling renames Aktiv (same group id): statuses stay
  SELECT jsonb_agg(jsonb_set(x, '{data,groups}', (SELECT coalesce(jsonb_agg(CASE WHEN g->>'name' = 'Aktiv'
                      THEN jsonb_build_object('id', g->>'id', 'name', 'Aktivmitglieder') ELSE g END), '[]')
                      FROM jsonb_array_elements(x->'data'->'groups') g)))
    INTO v_renamed FROM jsonb_array_elements(v_snap) x;
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', v_snap);
  r := pg_temp.run('webling', 'members', '{"complete": true}', v_renamed);
  RESET ROLE;
  PERFORM pg_temp.eq('M6 a renamed status group keeps its status',
    concat_ws(' ', r->>'final', r->'guard'->'status'->>'dropping'), 'ok 0');
  PERFORM pg_temp.ok('M6 members carry the new name',
    EXISTS (SELECT 1 FROM public.members WHERE labels ? 'Aktivmitglieder' AND membership_status = 'active')
    AND NOT EXISTS (SELECT 1 FROM public.members m JOIN public.member_links l ON l.member_id = m.id
                     WHERE l.gone_at IS NULL AND m.labels ? 'Aktiv'));
END $$;
ROLLBACK TO SAVEPOINT s;

-- Status gains: many non-members turned active at once (mass approval)
SAVEPOINT s;
DO $$
DECLARE
  v_snap jsonb := pg_temp.webling_snapshot();
  v_ids text[] := pg_temp.linked('non_member', 40);
  v_aktiv jsonb := jsonb_build_object('id', pg_temp.gid('Aktiv'), 'name', 'Aktiv');
  v_i text;
  r jsonb;
BEGIN
  FOREACH v_i IN ARRAY v_ids LOOP
    v_snap := pg_temp.with_record(v_snap, v_i, jsonb_build_object('groups', jsonb_build_array(v_aktiv)));
  END LOOP;
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', v_snap);
  RESET ROLE;
  PERFORM pg_temp.eq('M7 40 members starting to count at once: refused',
    concat_ws(' ', r->>'final', r->'guard'->>'refused', r->>'hint'),
    'refused status_gain accept_status_gain=' || array_length(v_ids, 1));
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', v_snap,
                   jsonb_build_object('accept_status_gain', array_length(v_ids, 1)));
  RESET ROLE;
  PERFORM pg_temp.eq('M7 accepted with the exact number', r->>'final', 'ok');
  PERFORM pg_temp.eq('M7 they count now', pg_temp.st(v_ids[1]::integer), 'active');
END $$;
ROLLBACK TO SAVEPOINT s;

-- Records with problems, a value that is not valid, one record the database refuses
SAVEPOINT s;
DO $$
DECLARE
  v_snap jsonb := pg_temp.webling_snapshot();
  v_ids text[] := pg_temp.linked('active', 5);
  v_old_birthday text;
  r jsonb;
BEGIN
  SELECT birthday INTO v_old_birthday FROM public.members WHERE id = v_ids[3]::integer;
  v_snap := pg_temp.with_record(v_snap, v_ids[1], '{"lastname": ""}');
  v_snap := pg_temp.with_record(v_snap, v_ids[2], '{"problem": "fetch_failed"}');
  v_snap := pg_temp.with_record(v_snap, v_ids[3], '{"birthday": "1990-02-30", "firstname": "Neu"}');
  v_snap := pg_temp.with_record(v_snap, v_ids[4], '{"firstname": "BOOM"}');
  v_snap := v_snap || jsonb_build_array(v_snap->0);
  -- a constraint the provider's value breaks (stands in for any refusal of the database)
  ALTER TABLE public.members ADD CONSTRAINT zz_check_boom CHECK (firstname <> 'BOOM') NOT VALID;
  -- an unlinked row in the Webling range staged with a problem: seen, so not recorded as gone
  INSERT INTO public.members (id, firstname, lastname, labels) VALUES (55601, 'Alt', 'Zeile', '["Aktiv"]');
  v_snap := pg_temp.with_record(v_snap, '55601', '{"problem": "fetch_failed"}');
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', v_snap);
  RESET ROLE;
  PERFORM pg_temp.eq('M8 the run goes through with a warning', r->>'final', 'warning');
  PERFORM pg_temp.eq('M8 missing last name, fetch failed and duplicate: invalid, not gone',
    concat_ws('/', r->'result'->>'invalid', r->'result'->>'gone'), '4/0');
  PERFORM pg_temp.eq('M8 a duplicate record is seen but not written',
    (SELECT count(*)::text FROM public.integration_issues WHERE code = 'invalid_record' AND detail = 'duplicate'), '1');
  PERFORM pg_temp.eq('M8 a birthday that is no date keeps the current one, the rest is written',
    (SELECT coalesce(birthday, 'NULL') || ' ' || firstname FROM public.members WHERE id = v_ids[3]::integer),
    coalesce(v_old_birthday, 'NULL') || ' Neu');
  PERFORM pg_temp.eq('M8 ... noted as info', (SELECT severity || ' ' || detail FROM public.integration_issues
    WHERE code = 'invalid_value' AND external_id = v_ids[3]), 'info birthday');
  PERFORM pg_temp.eq('M8 one record the database refuses fails alone',
    concat_ws(' ', r->'result'->>'write_failed', (SELECT detail FROM public.integration_issues WHERE code = 'write_failed')),
    '1 23514');
  PERFORM pg_temp.ok('M8 ... its link stays live',
    EXISTS (SELECT 1 FROM public.member_links WHERE external_id = v_ids[4] AND gone_at IS NULL));
  PERFORM pg_temp.eq('M8 an unlinked Webling row staged with a problem is not recorded as gone',
    concat_ws(' ', r->'result'->>'former', pg_temp.st(55601)), '0 active');
END $$;
ROLLBACK TO SAVEPOINT s;

-- Issues: possible duplicates (never merged), dismissed, resolved; no names in the log
SAVEPOINT s;
DO $$
DECLARE
  v_admin uuid := pg_temp.sign_up('a0000000-0000-0000-0000-00000000000c', 'm-admin@example.com', 'admin');
  v_snap jsonb := pg_temp.webling_snapshot();
  v_member integer := (pg_temp.linked('active', 1))[1]::integer;
  v_issue bigint;
  r jsonb;
  v_names text;
BEGIN
  UPDATE public.members SET email = 'dup.check@example.com' WHERE id = v_member;
  v_snap := pg_temp.with_record(v_snap, v_member::text, '{"email": "dup.check@example.com"}');
  -- a trial candidate created in Alleda with the same address
  INSERT INTO public.members (firstname, lastname, labels, email) VALUES ('Probe', 'Kandidat', '["probetraining"]', ' Dup.Check@example.com');
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', v_snap);
  RESET ROLE;
  SELECT id INTO v_issue FROM public.integration_issues WHERE code = 'possible_duplicate' AND member_id = v_member;
  PERFORM pg_temp.eq('M9 a possible duplicate is reported, the run stays ok',
    concat_ws(' ', r->>'final', (SELECT severity || ' ' || detail FROM public.integration_issues WHERE id = v_issue)),
    'ok warning email');
  PERFORM pg_temp.eq('M9 never merged', (SELECT count(*)::text FROM public.members WHERE email ILIKE '%dup.check@%'), '2');
  PERFORM pg_temp.act_as(v_admin);
  PERFORM public.integration_dismiss_issue(v_issue);
  RESET ROLE;
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', v_snap);
  RESET ROLE;
  PERFORM pg_temp.ok('M9 dismissed stays dismissed while still observed',
    (SELECT dismissed_at IS NOT NULL AND resolved_at IS NULL FROM public.integration_issues WHERE id = v_issue));
  -- dismissal survives the housekeeping while observed
  UPDATE public.integration_issues SET dismissed_at = now() - interval '200 days' WHERE id = v_issue;
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', v_snap);
  RESET ROLE;
  PERFORM pg_temp.ok('M9 an old dismissal of an issue still observed is kept',
    EXISTS (SELECT 1 FROM public.integration_issues WHERE id = v_issue AND dismissed_at IS NOT NULL));
  PERFORM pg_temp.act_as(v_admin);
  PERFORM public.integration_dismiss_issue(v_issue, false);
  RESET ROLE;
  PERFORM pg_temp.ok('M9 reopened', (SELECT dismissed_at IS NULL FROM public.integration_issues WHERE id = v_issue));
  DELETE FROM public.members WHERE email = ' Dup.Check@example.com';
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', v_snap);
  RESET ROLE;
  PERFORM pg_temp.ok('M9 resolved once the duplicate is gone (merged)',
    (SELECT resolved_at IS NOT NULL FROM public.integration_issues WHERE id = v_issue));

  SELECT string_agg(concat_ws(' ', firstname, lastname, email), ' ') INTO v_names
    FROM public.members WHERE length(lastname) > 3;
  PERFORM pg_temp.ok('M10 the run log and issues hold no names or addresses', NOT EXISTS (
    SELECT 1 FROM public.members m
     WHERE length(m.lastname) > 4 AND (pg_temp.run_log() ILIKE '%' || m.lastname || '%'
        OR (m.email IS NOT NULL AND pg_temp.run_log() ILIKE '%' || m.email || '%'))));
END $$;
ROLLBACK TO SAVEPOINT s;

-- A merge (phase 1c) that keeps the app row and moves the Webling link to
-- it survives the next run: identity goes through the link, not the id
SAVEPOINT s;
DO $$
DECLARE
  -- (one without attendance history: deleting stands in for the merge, which moves it)
  v_webling integer := (SELECT min(l.member_id) FROM public.member_links l JOIN public.members m ON m.id = l.member_id
                         WHERE l.connection = 'webling' AND l.gone_at IS NULL AND m.membership_status = 'active'
                           AND NOT EXISTS (SELECT 1 FROM public.logs g WHERE g."memberId" = m.id));
  v_keep integer;
  v_snap jsonb := pg_temp.webling_snapshot();
  r jsonb;
BEGIN
  INSERT INTO public.members (firstname, lastname, labels) VALUES ('Probe', 'Kandidatin', '["probetraining"]')
  RETURNING id INTO v_keep;
  UPDATE public.member_links SET member_id = v_keep WHERE connection = 'webling' AND external_id = v_webling::text;
  DELETE FROM public.members WHERE id = v_webling;
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', v_snap);
  RESET ROLE;
  PERFORM pg_temp.eq('M11 after a merge: the kept row is updated, the dropped one not created again',
    concat_ws(' ', r->>'final', r->'result'->>'inserted', r->'result'->>'updated',
              (SELECT count(*) FROM public.members WHERE id = v_webling)::text,
              (SELECT membership_status FROM public.members WHERE id = v_keep)), 'ok 0 1 0 active');
END $$;
ROLLBACK TO SAVEPOINT s;

-- A renamed status group: members the run does not write (a problem
-- record, a partial run, a link gone) get the new label too and keep
-- their status, which is looked up by the label text
SAVEPOINT s;
DO $$
DECLARE
  v_snap jsonb := pg_temp.webling_snapshot();
  v_ids text[] := pg_temp.linked('active', 4);
  v_active bigint;
  v_renamed jsonb;
  r jsonb;
BEGIN
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', v_snap);
  RESET ROLE;
  UPDATE public.member_links SET gone_at = now() - interval '1 day'
   WHERE connection = 'webling' AND external_id = v_ids[4];
  v_snap := pg_temp.without(v_snap, ARRAY[v_ids[4]]);
  v_active := (SELECT count(*) FROM public.members WHERE membership_status = 'active');
  -- Webling renames Aktiv (same id); two of its members cannot be fetched
  SELECT jsonb_agg(jsonb_set(x, '{data,groups}', (SELECT coalesce(jsonb_agg(CASE WHEN g->>'name' = 'Aktiv'
                      THEN jsonb_build_object('id', g->>'id', 'name', 'Aktiv Judo') ELSE g END), '[]')
                      FROM jsonb_array_elements(x->'data'->'groups') g)))
    INTO v_renamed FROM jsonb_array_elements(v_snap) x;
  v_renamed := pg_temp.with_record(v_renamed, v_ids[1], '{"problem": "fetch_failed"}');
  v_renamed := pg_temp.with_record(v_renamed, v_ids[2], '{"problem": "fetch_failed"}');
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', v_renamed);
  RESET ROLE;
  PERFORM pg_temp.eq('M12 Aktiv renamed while two of its members could not be fetched: no status changes',
    concat_ws(' ', r->>'final', r->'result'->>'statuses_recomputed', r->'guard'->'status'->>'dropping',
              (SELECT count(*) FROM public.members WHERE membership_status = 'active') - v_active), 'warning 0 0 0');
  PERFORM pg_temp.eq('M12 ... the two carry the new label and stay active',
    (SELECT string_agg(membership_status || ' ' || (labels ? 'Aktiv Judo') || ' ' || (labels ? 'Aktiv'), ','
                       ORDER BY id)
       FROM public.members WHERE id IN (v_ids[1]::integer, v_ids[2]::integer)), 'active true false,active true false');
  PERFORM pg_temp.eq('M12 ... as does a member gone from Webling',
    (SELECT membership_status || ' ' || (labels ? 'Aktiv Judo') FROM public.members WHERE id = v_ids[4]::integer),
    'left true');

  -- renamed again, in a partial run with one member only
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": false}', (
         SELECT jsonb_agg(jsonb_set(x, '{data,groups}', (SELECT coalesce(jsonb_agg(CASE WHEN g->>'name' = 'Aktiv Judo'
                            THEN jsonb_build_object('id', g->>'id', 'name', 'Aktivmitglieder') ELSE g END), '[]')
                            FROM jsonb_array_elements(x->'data'->'groups') g)))
           FROM jsonb_array_elements(v_renamed) x WHERE x->>'external_id' = v_ids[3]));
  RESET ROLE;
  PERFORM pg_temp.eq('M12 a partial run renames the label of every member of the group',
    concat_ws(' ', r->>'final', (SELECT count(*) FROM public.members WHERE labels ? 'Aktiv Judo'),
              (SELECT count(*) FROM public.members WHERE membership_status = 'active') - v_active,
              pg_temp.st(v_ids[1]::integer)), 'ok 0 0 active');
END $$;
ROLLBACK TO SAVEPOINT s;

-- A member back in Webling is written before its link comes back: the
-- automatic approval only sees the labels it comes back with
SAVEPOINT s;
DO $$
DECLARE
  v_snap jsonb := pg_temp.webling_snapshot();
  v_ids text[] := pg_temp.linked('active', 2);
  v_account uuid[];
  r jsonb;
BEGIN
  UPDATE public.members SET email = 'zurueck.' || id || '@example.com'
   WHERE id IN (v_ids[1]::integer, v_ids[2]::integer);
  UPDATE public.member_links SET gone_at = now() - interval '1 day'
   WHERE connection = 'webling' AND external_id = ANY (v_ids);
  v_account := ARRAY[pg_temp.sign_up('b0000000-0000-0000-0000-000000000011', 'zurueck.' || v_ids[1] || '@example.com'),
                     pg_temp.sign_up('b0000000-0000-0000-0000-000000000012', 'zurueck.' || v_ids[2] || '@example.com')];
  PERFORM pg_temp.eq('M13 accounts of members gone from Webling (still labelled Aktiv) wait',
    (SELECT string_agg(p.status::text, ',' ORDER BY p.user_id) FROM public.user_profiles p
      WHERE p.user_id = ANY (v_account)), 'pending,pending');
  -- the first comes back as a non-member, the second as active
  v_snap := pg_temp.with_record(v_snap, v_ids[1], (SELECT jsonb_build_object('firstname', firstname, 'lastname', lastname,
              'email', email, 'groups', jsonb_build_array(jsonb_build_object('id', pg_temp.gid('Nicht-Mitglieder'),
              'name', 'Nicht-Mitglieder'))) FROM public.members WHERE id = v_ids[1]::integer));
  v_snap := pg_temp.with_record(v_snap, v_ids[2], (SELECT jsonb_build_object('firstname', firstname, 'lastname', lastname,
              'email', email, 'groups', jsonb_build_array(jsonb_build_object('id', pg_temp.gid('Aktiv'), 'name', 'Aktiv')))
              FROM public.members WHERE id = v_ids[2]::integer));
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', v_snap);
  RESET ROLE;
  PERFORM pg_temp.eq('M13 back as a non-member: its account keeps waiting',
    concat_ws(' ', r->'result'->>'revived', pg_temp.st(v_ids[1]::integer),
              (SELECT status::text FROM public.user_profiles WHERE user_id = v_account[1])), '2 non_member pending');
  PERFORM pg_temp.eq('M13 back as active: its account is approved',
    concat_ws(' ', pg_temp.st(v_ids[2]::integer),
              (SELECT status::text FROM public.user_profiles WHERE user_id = v_account[2])), 'active approved');
END $$;
ROLLBACK TO SAVEPOINT s;

-- A new member the database refuses: the issue names the record, not a
-- member with the Webling id (none was created)
SAVEPOINT s;
DO $$
DECLARE
  r jsonb;
BEGIN
  ALTER TABLE public.members ADD CONSTRAINT zz_check_boom CHECK (firstname <> 'BOOM') NOT VALID;
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', pg_temp.with_record(pg_temp.webling_snapshot(), '77003',
         '{"firstname": "BOOM", "lastname": "Neu", "groups": []}'));
  RESET ROLE;
  PERFORM pg_temp.eq('M14 a new member whose insert fails: an issue by external id, without member',
    (SELECT concat_ws(' ', r->'result'->>'write_failed', external_id, coalesce(member_id::text, '-'), detail)
       FROM public.integration_issues WHERE code = 'write_failed'), '1 77003 - 23514');
  PERFORM pg_temp.ok('M14 ... and nothing written for it',
    NOT EXISTS (SELECT 1 FROM public.members WHERE id = 77003)
    AND NOT EXISTS (SELECT 1 FROM public.member_links WHERE external_id = '77003'));
END $$;
ROLLBACK TO SAVEPOINT s;

-- A record the adapter could not fetch was not checked: its open issue
-- stays, in a partial and in a complete run
SAVEPOINT s;
DO $$
DECLARE
  v_snap jsonb := pg_temp.webling_snapshot();
  v_id text := (pg_temp.linked('active', 1))[1];
  r jsonb;
BEGIN
  ALTER TABLE public.members ADD CONSTRAINT zz_check_boom CHECK (firstname <> 'BOOM') NOT VALID;
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', pg_temp.with_record(v_snap, v_id, '{"firstname": "BOOM"}'));
  RESET ROLE;
  PERFORM pg_temp.eq('M15 a member the database refuses: write_failed open',
    (SELECT count(*)::text FROM public.integration_issues
      WHERE code = 'write_failed' AND external_id = v_id AND resolved_at IS NULL), '1');
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": false}',
         jsonb_build_array(jsonb_build_object('external_id', v_id, 'data', '{"lastname": "X", "problem": "fetch_failed"}'::jsonb)));
  r := pg_temp.run('webling', 'members', '{"complete": true}', pg_temp.with_record(v_snap, v_id, '{"problem": "fetch_failed"}'));
  RESET ROLE;
  PERFORM pg_temp.eq('M15 runs that could not fetch it leave the issue open',
    (SELECT count(*)::text FROM public.integration_issues
      WHERE code = 'write_failed' AND external_id = v_id AND resolved_at IS NULL), '1');
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": false}', pg_temp.without(v_snap,
         ARRAY(SELECT x->>'external_id' FROM jsonb_array_elements(v_snap) x WHERE x->>'external_id' <> v_id)));
  RESET ROLE;
  PERFORM pg_temp.eq('M15 a partial run that read it again resolves it',
    (SELECT count(*)::text FROM public.integration_issues
      WHERE code = 'write_failed' AND external_id = v_id AND resolved_at IS NULL), '0');
END $$;
ROLLBACK TO SAVEPOINT s;

-- A member another provider has now (a CSV import linked it after it left
-- Webling) keeps that provider's label and status when Webling renames a group
SAVEPOINT s;
INSERT INTO public.integration_connections (id, provider, display_name, runs_in, default_status, field_policy)
VALUES ('csv', 'csv', 'CSV-Import', 'app', 'non_member',
        '{"member.firstname": "owned", "member.lastname": "owned", "member.labels": "owned"}');
INSERT INTO public.integration_member_groups (connection, external_id, name, status, rank, hidden, reviewed)
VALUES ('csv', 'Aktiv', 'Aktiv', 'active', 20, true, true);
DO $$
DECLARE
  v_admin uuid := pg_temp.sign_up('a0000000-0000-0000-0000-000000000016', 'm16-admin@example.com', 'admin');
  v_snap jsonb := pg_temp.webling_snapshot();
  v_id text := (pg_temp.linked('active', 1))[1];
  v_renamed jsonb;
  r jsonb;
BEGIN
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', v_snap);
  RESET ROLE;
  UPDATE public.member_links SET gone_at = now() - interval '1 day' WHERE connection = 'webling' AND external_id = v_id;
  PERFORM pg_temp.act_as(v_admin);
  r := pg_temp.run('csv', 'members', '{"complete": false}', (
         SELECT jsonb_build_array(jsonb_build_object('external_id', 'k1', 'data', jsonb_build_object(
                  'firstname', firstname, 'lastname', lastname, 'groups', jsonb_build_array('Aktiv'), 'link_to', id)))
           FROM public.members WHERE id = v_id::integer));
  RESET ROLE;
  PERFORM pg_temp.eq('M16 a member gone from Webling, linked by a CSV import: active through the CSV',
    concat_ws(' ', r->>'final', pg_temp.st(v_id::integer), (SELECT labels::text FROM public.members WHERE id = v_id::integer)),
    'ok active ["Aktiv"]');
  SELECT jsonb_agg(jsonb_set(x, '{data,groups}', (SELECT coalesce(jsonb_agg(CASE WHEN g->>'name' = 'Aktiv'
                      THEN jsonb_build_object('id', g->>'id', 'name', 'Aktiv Judo') ELSE g END), '[]')
                      FROM jsonb_array_elements(x->'data'->'groups') g)))
    INTO v_renamed FROM jsonb_array_elements(pg_temp.without(v_snap, ARRAY[v_id])) x;
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', v_renamed);
  RESET ROLE;
  PERFORM pg_temp.eq('M16 ... keeps its CSV label and status when Webling renames Aktiv',
    concat_ws(' ', r->>'final', pg_temp.st(v_id::integer), (SELECT labels::text FROM public.members WHERE id = v_id::integer)),
    'ok active ["Aktiv"]');
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- C A CSV connection, run by an admin in the app
-----------------
SAVEPOINT s;
INSERT INTO public.integration_connections (id, provider, display_name, runs_in, on_possible_duplicate,
                                            default_status, field_policy)
VALUES ('csv', 'csv', 'CSV-Import', 'app', 'skip', 'non_member',
        '{"member.firstname": "owned", "member.lastname": "owned", "member.email": "fill", "member.labels": "owned"}');
INSERT INTO public.integration_member_groups (connection, external_id, name, status, rank, hidden, reviewed)
VALUES ('csv', 'Mitglied', 'Mitglied', 'active', 20, true, true);
DO $$
DECLARE
  v_admin uuid := pg_temp.sign_up('a0000000-0000-0000-0000-00000000000d', 'c-admin@example.com', 'admin');
  v_admin2 uuid := pg_temp.sign_up('a0000000-0000-0000-0000-00000000000e', 'c-admin2@example.com', 'admin');
  v_trainer uuid := pg_temp.sign_up('a0000000-0000-0000-0000-00000000000f', 'c-trainer@example.com', 'trainer');
  v_waiting uuid := pg_temp.sign_up('b0000000-0000-0000-0000-000000000003', 'csv.ohne@example.com');
  v_app integer;
  v_webling integer := (pg_temp.linked('active', 1))[1]::integer;
  v_run bigint;
  r jsonb;
BEGIN
  INSERT INTO public.members (firstname, lastname, birthday, email, labels)
  VALUES ('Anna', 'Muster', '2010-05-06', NULL, '["new"]') RETURNING id INTO v_app;
  PERFORM pg_temp.act_as(v_admin);
  r := pg_temp.run('csv', 'members', '{"complete": false}', jsonb_build_array(
    jsonb_build_object('external_id', 'r1', 'data', jsonb_build_object('firstname', 'Ben', 'lastname', 'Neu',
                       'groups', jsonb_build_array('Mitglied'))),
    jsonb_build_object('external_id', 'r2', 'data', jsonb_build_object('firstname', 'Csv', 'lastname', 'Ohne',
                       'email', 'csv.ohne@example.com', 'groups', '[]'::jsonb)),
    jsonb_build_object('external_id', 'r3', 'data', jsonb_build_object('firstname', 'anna', 'lastname', 'Muster',
                       'birthday', '2010-05-06', 'groups', jsonb_build_array('Mitglied')))));
  RESET ROLE;
  PERFORM pg_temp.eq('C1 an admin runs an app connection: two new, one held back',
    concat_ws(' ', r->>'final', r->'result'->>'inserted', r->'result'->>'held'), 'warning 2 1');
  PERFORM pg_temp.ok('C1 new members get app ids',
    (SELECT min(member_id) FROM public.member_links WHERE connection = 'csv') > 10000000);
  PERFORM pg_temp.eq('C1 status from the CSV catalog',
    (SELECT string_agg(m.membership_status, ',' ORDER BY l.external_id) FROM public.member_links l
       JOIN public.members m ON m.id = l.member_id WHERE l.connection = 'csv'), 'active,non_member');
  PERFORM pg_temp.eq('C1 a new member never counts as created in Alleda: its account waits',
    (SELECT status::text FROM public.user_profiles WHERE user_id = v_waiting), 'pending');
  PERFORM pg_temp.eq('C1 the held record names the member it resembles',
    (SELECT concat_ws(' ', external_id, other_member_id = v_app, detail) FROM public.integration_issues
      WHERE connection = 'csv' AND code = 'possible_duplicate'), 'r3 t name_birthday');

  -- a later partial import did not check r3: it is still held back
  PERFORM pg_temp.act_as(v_admin);
  r := pg_temp.run('csv', 'members', '{"complete": false}', jsonb_build_array(
    jsonb_build_object('external_id', 'r9', 'data', jsonb_build_object('firstname', 'Nur', 'lastname', 'Neun',
                       'groups', '[]'::jsonb))));
  RESET ROLE;
  PERFORM pg_temp.eq('C5 a partial import without the held record leaves its issue open',
    concat_ws(' ', r->>'final', r->'result'->>'inserted',
              (SELECT resolved_at IS NULL FROM public.integration_issues
                WHERE connection = 'csv' AND code = 'possible_duplicate' AND external_id = 'r3')), 'ok 1 t');

  -- the admin links the held record to the member in a second import
  PERFORM pg_temp.act_as(v_admin);
  r := pg_temp.run('csv', 'members', '{"complete": false}', jsonb_build_array(
    jsonb_build_object('external_id', 'r3', 'data', jsonb_build_object('firstname', 'Anna', 'lastname', 'Muster',
                       'groups', jsonb_build_array('Mitglied'), 'link_to', v_app)),
    jsonb_build_object('external_id', 'r4', 'data', jsonb_build_object('firstname', 'X', 'lastname', 'Y',
                       'link_to', v_webling))));
  RESET ROLE;
  PERFORM pg_temp.eq('C2 link_to adopts the app member',
    (SELECT l.external_id || ' ' || m.membership_status FROM public.member_links l JOIN public.members m ON m.id = l.member_id
      WHERE l.member_id = v_app), 'r3 active');
  PERFORM pg_temp.eq('C2 link_to a member of another provider is a conflict',
    (SELECT detail FROM public.integration_issues WHERE connection = 'csv' AND code = 'id_conflict' AND external_id = 'r4'),
    'link_to');
  PERFORM pg_temp.ok('C2 the held record''s issue is resolved by the link',
    (SELECT resolved_at IS NOT NULL
       FROM public.integration_issues WHERE connection = 'csv' AND code = 'possible_duplicate' AND external_id = 'r3'));

  -- the CSV owns names, e-mail and labels, not the birthday
  PERFORM pg_temp.act_as(v_trainer);
  PERFORM pg_temp.eq('C3 staff cannot change a field the CSV owns',
    pg_temp.err(format('UPDATE public.members SET firstname = %L WHERE id = %s', 'Zora', v_app)),
    'P0001 MANAGED_BY_PROVIDER');
  PERFORM pg_temp.ok('C3 ... the message names the provider',
    pg_temp.msg(format('UPDATE public.members SET email = %L WHERE id = %s', 'z@example.com', v_app)) LIKE '%(CSV-Import)');
  UPDATE public.members SET birthday = '2010-05-07' WHERE id = v_app;
  RESET ROLE;
  PERFORM pg_temp.eq('C3 a field the CSV does not own stays editable',
    (SELECT birthday FROM public.members WHERE id = v_app), '2010-05-07');

  -- another admin cannot continue a run the first one started
  PERFORM pg_temp.act_as(v_admin);
  v_run := (public.integration_begin('csv', 'members', '{}')->>'run')::bigint;
  RESET ROLE;
  PERFORM pg_temp.act_as(v_admin2);
  PERFORM pg_temp.eq('C4 an admin cannot apply another admin''s run',
    pg_temp.err(format('SELECT public.integration_apply(%s)', v_run)), '42501 NOT_ALLOWED');
  RESET ROLE;
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- G Admins change the mapping under the same guards
-----------------
SAVEPOINT s;
DO $$
DECLARE
  v_admin uuid := pg_temp.sign_up('a0000000-0000-0000-0000-000000000010', 'g-admin@example.com', 'admin');
  v_snap jsonb := pg_temp.webling_snapshot();
  v_ids text[] := pg_temp.linked('non_member', 3);
  v_jugend jsonb := jsonb_build_object('id', pg_temp.gid('Aktiv Jugend'), 'name', 'Aktiv Jugend');
  v_i text;
  v_group bigint;
  v_aktiv bigint;
  v_active integer := (SELECT count(*) FROM public.members WHERE membership_status = 'active');
  r jsonb;
BEGIN
  -- Webling gets a new group 'Aktiv Jugend' for three members
  FOREACH v_i IN ARRAY v_ids LOOP
    v_snap := pg_temp.with_record(v_snap, v_i, jsonb_build_object('groups', jsonb_build_array(v_jugend)));
  END LOOP;
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', v_snap);
  RESET ROLE;
  SELECT id INTO v_group FROM public.integration_member_groups WHERE name = 'Aktiv Jugend';
  PERFORM pg_temp.ok('G1 a new group is registered, not reviewed, without status',
    (SELECT NOT reviewed AND status IS NULL FROM public.integration_member_groups WHERE id = v_group));
  PERFORM pg_temp.act_as(v_admin);
  r := public.integration_set_mapping('webling', jsonb_build_object('groups', jsonb_build_array(
         jsonb_build_object('id', v_group, 'status', 'active', 'rank', 20))), '{"dry_run": true}');
  RESET ROLE;
  PERFORM pg_temp.eq('G1 dry run: three would count, nothing changed',
    concat_ws(' ', r->>'status', r->>'statuses_changed', r->'guard'->>'gaining', pg_temp.st(v_ids[1]::integer)),
    'dry_run 3 3 non_member');
  PERFORM pg_temp.act_as(v_admin);
  r := public.integration_set_mapping('webling', jsonb_build_object('groups', jsonb_build_array(
         jsonb_build_object('id', v_group, 'status', 'active', 'rank', 20))));
  RESET ROLE;
  PERFORM pg_temp.eq('G1 applied at once', concat_ws(' ', r->>'status', pg_temp.st(v_ids[1]::integer)), 'ok active');
  PERFORM pg_temp.eq('G1 logged as a config run',
    (SELECT kind || ' ' || trigger || ' ' || status FROM public.integration_runs ORDER BY id DESC LIMIT 1), 'config app ok');

  -- Aktiv mapped away: refused, then accepted with the exact number
  SELECT id INTO v_aktiv FROM public.integration_member_groups WHERE connection = 'webling' AND name = 'Aktiv';
  PERFORM pg_temp.act_as(v_admin);
  r := public.integration_set_mapping('webling', jsonb_build_object('groups', jsonb_build_array(
         jsonb_build_object('id', v_aktiv, 'status', NULL))));
  RESET ROLE;
  PERFORM pg_temp.eq('G2 a mapping that drops many members is refused',
    concat_ws(' ', r->>'status', r->>'hint'), 'refused accept_status_drop=' || (r->'guard'->>'dropping'));
  PERFORM pg_temp.ok('G2 ... and changes nothing',
    (SELECT status FROM public.integration_member_groups WHERE id = v_aktiv) = 'active'
    AND (SELECT count(*) FROM public.members WHERE membership_status = 'active') = v_active + 3);
  PERFORM pg_temp.act_as(v_admin);
  PERFORM pg_temp.eq('G3 an invalid mapping is rejected',
    pg_temp.err(format($q$SELECT public.integration_set_mapping('webling', '{"groups": [{"id": %s, "status": "vip"}]}')$q$, v_aktiv)),
    '22023 INVALID_MAPPING');
  PERFORM pg_temp.eq('G3 identity and guard limits are not part of the mapping',
    pg_temp.err($q$SELECT public.integration_set_mapping('webling', '{"guard": {"gone_min": 1000}}')$q$),
    '22023 INVALID_MAPPING');
  RESET ROLE;
END $$;
ROLLBACK TO SAVEPOINT s;

-- A group called like a status group (a new one, or one renamed to it)
-- never hands out that status: its label gets the provider's id
SAVEPOINT s;
DO $$
DECLARE
  v_snap jsonb := pg_temp.webling_snapshot();
  v_ids text[] := pg_temp.linked('non_member', 2);
  v_nm jsonb := jsonb_build_object('id', pg_temp.gid('Nicht-Mitglieder'), 'name', 'Nicht-Mitglieder');
  r jsonb;
BEGIN
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', v_snap);
  RESET ROLE;
  -- an archive subgroup Webling also calls Passiv; Vorstand seen (and bound) for the first time
  v_snap := pg_temp.with_record(v_snap, v_ids[1], jsonb_build_object('groups', jsonb_build_array(
              v_nm, jsonb_build_object('id', 'gARCHIV2019PASSIV', 'name', 'Passiv'))));
  v_snap := pg_temp.with_record(v_snap, v_ids[2], jsonb_build_object('groups', jsonb_build_array(
              v_nm, jsonb_build_object('id', pg_temp.gid('Vorstand'), 'name', 'Vorstand'))));
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', v_snap);
  RESET ROLE;
  PERFORM pg_temp.eq('G4 a new group called Passiv gets its id in the label, no status',
    (SELECT concat_ws(' ', label, coalesce(status, '-'), reviewed) FROM public.integration_member_groups
      WHERE external_id = 'gARCHIV2019PASSIV'), 'Passiv (gARCHIV2019PASSIV) - f');
  PERFORM pg_temp.eq('G4 ... its member stays a non-member',
    concat_ws(' ', r->>'final', pg_temp.st(v_ids[1]::integer),
              (SELECT labels ? 'Passiv (gARCHIV2019PASSIV)' FROM public.members WHERE id = v_ids[1]::integer)),
    'ok non_member t');

  -- Webling renames Vorstand (same id) to Aktiv
  v_snap := pg_temp.with_record(v_snap, v_ids[2], jsonb_build_object('groups', jsonb_build_array(
              v_nm, jsonb_build_object('id', pg_temp.gid('Vorstand'), 'name', 'Aktiv'))));
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', v_snap);
  RESET ROLE;
  PERFORM pg_temp.eq('G4 a group renamed to a status group''s name keeps its own status (none)',
    concat_ws(' ', r->>'final', pg_temp.st(v_ids[2]::integer),
              (SELECT label FROM public.integration_member_groups WHERE external_id = pg_temp.gid('Vorstand')),
              (SELECT labels ? ('Aktiv (' || pg_temp.gid('Vorstand') || ')') FROM public.members
                WHERE id = v_ids[2]::integer)),
    'ok non_member Aktiv (' || pg_temp.gid('Vorstand') || ') t');
  PERFORM pg_temp.ok('G4 every group of a connection writes its own label',
    NOT EXISTS (SELECT 1 FROM public.integration_member_groups
                 GROUP BY connection, coalesce(label, name) HAVING count(*) > 1));
END $$;
ROLLBACK TO SAVEPOINT s;

-- Two groups called Passiv on first sight (an archive folder): the seeded
-- row binds to the lowest id, the other copies its mapping until an admin
-- reviews it, so the first run changes nobody's status (the old rule went
-- by the title)
SAVEPOINT s;
DO $$
DECLARE
  v_ids text[] := pg_temp.linked('passive', 1);
  v_status jsonb := (SELECT jsonb_object_agg(id, membership_status) FROM public.members);
  v_keys text[] := ARRAY(SELECT k FROM unnest(ARRAY[pg_temp.gid('Passiv'), 'gARCHIV2019PASSIV']) k ORDER BY k);
  r jsonb;
BEGIN
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', pg_temp.with_record(pg_temp.webling_snapshot(), v_ids[1],
         jsonb_build_object('groups', jsonb_build_array(jsonb_build_object('id', 'gARCHIV2019PASSIV', 'name', 'Passiv')))));
  RESET ROLE;
  PERFORM pg_temp.eq('G4 two groups called Passiv on first sight: the run goes through, no status changes',
    concat_ws(' ', r->>'final', r->'guard'->'status'->>'dropping', r->'guard'->'status'->>'gaining',
              (SELECT count(*) FROM public.members m WHERE m.membership_status IS DISTINCT FROM v_status->>(m.id::text)),
              pg_temp.st(v_ids[1]::integer)), 'ok 0 0 0 passive');
  PERFORM pg_temp.eq('G4 ... the seeded row binds to the lowest id',
    (SELECT string_agg(concat_ws(' ', external_id, coalesce(label, '-'), status, reviewed), ',')
       FROM public.integration_member_groups
      WHERE connection = 'webling' AND name = 'Passiv' AND label IS NULL), v_keys[1] || ' - passive t');
  PERFORM pg_temp.eq('G4 ... the other copies its mapping, with its id in the label, to be reviewed',
    (SELECT concat_ws(' ', label, status, rank, hidden, coalesce(role, '-'), reviewed) FROM public.integration_member_groups
      WHERE connection = 'webling' AND external_id = v_keys[2]), 'Passiv (' || v_keys[2] || ') passive 30 t - f');
END $$;
ROLLBACK TO SAVEPOINT s;

-- The same with Webling's numeric ids: the lowest is the smaller number
SAVEPOINT s;
DO $$
DECLARE
  v_ids text[] := pg_temp.linked('passive', 1);
  v_snap jsonb;
  r jsonb;
BEGIN
  -- Passiv is group 512 in Webling, its archive folder 1078
  SELECT jsonb_agg(jsonb_set(x, '{data,groups}', (SELECT coalesce(jsonb_agg(CASE WHEN g->>'name' = 'Passiv'
                      THEN jsonb_build_object('id', '512', 'name', 'Passiv') ELSE g END), '[]')
                      FROM jsonb_array_elements(x->'data'->'groups') g)))
    INTO v_snap FROM jsonb_array_elements(pg_temp.webling_snapshot()) x;
  v_snap := pg_temp.with_record(v_snap, v_ids[1], jsonb_build_object('groups', jsonb_build_array(
              jsonb_build_object('id', '1078', 'name', 'Passiv'))));
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": true}', v_snap);
  RESET ROLE;
  PERFORM pg_temp.eq('G4 numeric ids: the seeded row binds to 512, not 1078',
    concat_ws(' ', r->>'final',
              (SELECT string_agg(external_id || '=' || coalesce(label, name) || '/' || reviewed, ',' ORDER BY id)
                 FROM public.integration_member_groups WHERE connection = 'webling' AND name = 'Passiv')),
    'ok 512=Passiv/true,1078=Passiv (1078)/false');
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- V Events, registrations, holidays
-----------------
SAVEPOINT s;
DO $$
DECLARE
  v_trainer uuid := pg_temp.sign_up('a0000000-0000-0000-0000-000000000011', 'v-trainer@example.com', 'trainer');
  v_xmin jsonb;
  v_app_member integer;
  r jsonb;
BEGIN
  PERFORM pg_temp.fx_setup();
  -- Everything but the description, which held the portal link (now the
  -- link's url: cleared on adoption since phase 4)
  v_xmin := (SELECT jsonb_object_agg(id, md5(row(title, date, date_to, all_day, "timeFrom", "timeTo", location,
                                                 section, "maxParticipants", "registrationDeadline")::text))
               FROM public.events WHERE id > 61000);
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope(), pg_temp.ev_snapshot());
  RESET ROLE;
  PERFORM pg_temp.eq('V1 first run on the legacy events: all adopted, none changed',
    concat_ws('/', r->>'final', r->'result'->>'adopted', r->'result'->>'updated', r->'result'->>'inserted',
              r->'result'->>'gone'), 'ok/40/0/0/0');
  PERFORM pg_temp.eq('V1 no event changed but the portal link leaving the description',
    (SELECT count(*)::text FROM public.events e WHERE e.id > 61000
        AND (e.description IS NOT NULL
             OR md5(row(title, date, date_to, all_day, "timeFrom", "timeTo", location, section, "maxParticipants",
                        "registrationDeadline")::text) <> v_xmin->>(e.id::text))), '0');
  PERFORM pg_temp.eq('V1 the legacy registrations become Webling''s, none added or removed',
    concat_ws('/', r->'result'->>'registrations_adopted', r->'result'->>'registrations_added',
              r->'result'->>'registrations_removed'), '6/0/0');
  PERFORM pg_temp.ok('V1 links carry calendar and portal link',
    (SELECT count(*) FROM public.event_links l JOIN public.integration_calendars ic ON ic.id = l.calendar_id
      WHERE l.url LIKE 'https://club.webling.ch/%') = 40);
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope(), pg_temp.ev_snapshot());
  RESET ROLE;
  PERFORM pg_temp.eq('V2 the same snapshot again: unchanged', concat_ws('/', r->>'final', r->'result'->>'unchanged'), 'ok/40');

  -- Staff: provider fields read-only, the rest editable, no delete
  PERFORM pg_temp.act_as(v_trainer);
  PERFORM pg_temp.eq('V3 staff cannot change a Webling event''s title',
    pg_temp.err($q$UPDATE public.events SET title = 'X' WHERE id = 61001$q$), 'P0001 MANAGED_BY_PROVIDER');
  PERFORM pg_temp.eq('V3 nor delete it',
    pg_temp.err($q$DELETE FROM public.events WHERE id = 61001$q$), 'P0001 MANAGED_BY_PROVIDER');
  UPDATE public.events SET "registrationDeadline" = '2099-01-01' WHERE id = 61001;
  PERFORM pg_temp.eq('V3 nor mark a registration as the provider''s',
    pg_temp.err($q$UPDATE public.event_participants SET source_connection = NULL WHERE "eventId" = 61001$q$),
    'P0001 MANAGED_BY_PROVIDER');
  RESET ROLE;
  PERFORM pg_temp.eq('V3 the registration deadline stays the app''s',
    (SELECT "registrationDeadline" FROM public.events WHERE id = 61001), '2099-01-01');

  -- Registrations: one confirmation withdrawn, one attended row, one app row, an unknown participant
  SELECT member_id INTO v_app_member FROM public.member_links WHERE connection = 'webling' AND gone_at IS NULL
   ORDER BY member_id OFFSET 5 LIMIT 1;
  INSERT INTO public.event_participants ("eventId", "memberId", "attendanceStatus") VALUES (61001, v_app_member, 'registered');
  INSERT INTO public.event_logs ("eventId", "memberId", "attendedAt")
  SELECT 61002, member_id, now() FROM public.member_links WHERE external_id = (SELECT min(external_id) FROM fx_part WHERE event_id = 61002);
  DELETE FROM fx_part WHERE event_id IN (61001, 61002) AND external_id = (SELECT min(external_id) FROM fx_part);
  INSERT INTO fx_part VALUES (61001, '9999999');
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope(), pg_temp.ev_snapshot());
  RESET ROLE;
  PERFORM pg_temp.eq('V4 a withdrawn confirmation removes the provider''s row only, attended rows stay',
    concat_ws('/', r->'result'->>'registrations_removed',
              (SELECT count(*) FROM public.event_participants WHERE "eventId" = 61001)::text,
              (SELECT count(*) FROM public.event_participants WHERE "eventId" = 61002)::text), '1/3/3');
  PERFORM pg_temp.eq('V4 an unknown participant is reported',
    (SELECT severity FROM public.integration_issues WHERE code = 'unknown_participant' AND external_id = '9999999'), 'warning');

  -- Gone: an unused future event is deleted; one with attendance is kept and the app's again
  DELETE FROM fx_events WHERE id IN (61003, 61002);
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope(), pg_temp.ev_snapshot());
  RESET ROLE;
  PERFORM pg_temp.eq('V5 gone: one deleted, one kept', concat_ws('/', r->>'final', r->'result'->>'gone',
    r->'result'->>'deleted', r->'result'->>'kept'), 'ok/2/1/1');
  PERFORM pg_temp.ok('V5 the kept one is editable again and reported',
    EXISTS (SELECT 1 FROM public.events WHERE id = 61002)
    AND NOT EXISTS (SELECT 1 FROM public.events WHERE id = 61003)
    AND EXISTS (SELECT 1 FROM public.integration_issues WHERE code = 'event_gone_kept' AND event_id = 61002));
  PERFORM pg_temp.act_as(v_trainer);
  UPDATE public.events SET title = 'Jetzt unser' WHERE id = 61002;
  RESET ROLE;

  -- A calendar answered empty: refused; a run that read only c1 leaves c2 alone
  DELETE FROM fx_events WHERE cal = 'c2';
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope(), pg_temp.ev_snapshot());
  RESET ROLE;
  PERFORM pg_temp.eq('V6 a calendar answered empty is refused',
    concat_ws(' ', r->>'final', r->'guard'->>'refused', r->>'hint'), 'refused events_gone accept_events_gone=10');
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope('{c1}'), pg_temp.ev_snapshot());
  RESET ROLE;
  PERFORM pg_temp.eq('V6 only the calendars read completely can lose events', concat_ws('/', r->>'final', r->'result'->>'gone'), 'ok/0');

  -- An unset date (Webling's epoch, sent as no_date) is info, the run stays ok
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope('{c1}'), pg_temp.ev_snapshot() || jsonb_build_array(
         jsonb_build_object('external_id', '61999', 'data', jsonb_build_object(
           'calendar', jsonb_build_object('id', 'c1', 'name', 'Judo Agenda'), 'title', 'Serie', 'problem', 'no_date'))));
  RESET ROLE;
  PERFORM pg_temp.eq('V7 an event without date: ok, info issue',
    concat_ws(' ', r->>'final', (SELECT severity || ' ' || detail FROM public.integration_issues WHERE external_id = '61999')),
    'ok info no_date');

  -- A partial run checks only the records it staged
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', '{"complete": false}', (SELECT jsonb_agg(x)
         FROM jsonb_array_elements(pg_temp.ev_snapshot()) x WHERE x->>'external_id' = '61001'));
  RESET ROLE;
  PERFORM pg_temp.eq('V7 a partial run without the event leaves its issue open',
    (SELECT (resolved_at IS NULL)::text FROM public.integration_issues WHERE external_id = '61999'), 'true');
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', '{"complete": false}', jsonb_build_array(
         jsonb_build_object('external_id', '61999', 'data', jsonb_build_object(
           'calendar', jsonb_build_object('id', 'c1', 'name', 'Judo Agenda'), 'title', 'Serie',
           'starts_on', pg_temp.fx_date(5)))));
  RESET ROLE;
  PERFORM pg_temp.eq('V7 a partial run with the event, dated now, resolves it',
    concat_ws(' ', r->'result'->>'inserted',
              (SELECT (resolved_at IS NOT NULL)::text FROM public.integration_issues WHERE external_id = '61999')),
    '1 true');
END $$;
ROLLBACK TO SAVEPOINT s;

-- Provenance follows the notes, as before the layer: a merge that keeps
-- the Webling registration with the app's notes, and staff changing the
-- notes, make the registration the app's; the layer removes only its own
SAVEPOINT s;
DO $$
DECLARE
  v_admin uuid := pg_temp.sign_up('a0000000-0000-0000-0000-000000000014', 'v-admin@example.com', 'admin');
  v_trainer uuid := pg_temp.sign_up('a0000000-0000-0000-0000-000000000015', 'v-trainer2@example.com', 'trainer');
  v_ext text[];
  v_m integer[];
  v_dup integer;
  r jsonb;
BEGIN
  PERFORM pg_temp.fx_setup();
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope(), pg_temp.ev_snapshot());
  RESET ROLE;
  -- the three Webling members registered for 61001 and 61002
  SELECT array_agg(p.external_id ORDER BY p.external_id), array_agg(l.member_id ORDER BY p.external_id)
    INTO v_ext, v_m
    FROM fx_part p JOIN public.member_links l ON l.connection = 'webling' AND l.external_id = p.external_id
   WHERE p.event_id = 61002;
  -- the first one's duplicate from the app, registered for 61002 in the app, merged into it
  INSERT INTO public.members (firstname, lastname, labels) VALUES ('Doppel', 'Gaenger', '[]') RETURNING id INTO v_dup;
  INSERT INTO public.event_participants ("eventId", "memberId", "attendanceStatus", notes)
  VALUES (61002, v_dup, 'registered', 'im App angemeldet');
  PERFORM pg_temp.act_as(v_admin);
  PERFORM public.merge_members(v_m[1], v_dup);
  RESET ROLE;
  PERFORM pg_temp.eq('V10 a merge keeps the Webling registration with the app''s notes: the app''s now',
    (SELECT concat_ws(' ', notes, coalesce(source_connection, 'app')) FROM public.event_participants
      WHERE "eventId" = 61002 AND "memberId" = v_m[1]), 'im App angemeldet app');
  PERFORM pg_temp.act_as(v_trainer);
  UPDATE public.event_participants SET notes = 'zahlt bar' WHERE "eventId" = 61002 AND "memberId" = v_m[2];
  UPDATE public.event_participants SET notes = notes || ' (bezahlt)' WHERE "eventId" = 61001 AND "memberId" = v_m[3];
  PERFORM pg_temp.eq('V10 staff still cannot make a registration the provider''s',
    pg_temp.err(format($q$UPDATE public.event_participants SET source_connection = 'webling',
                            notes = 'Imported from Webling' WHERE "eventId" = 61002 AND "memberId" = %s$q$, v_m[1])),
    'P0001 MANAGED_BY_PROVIDER');
  RESET ROLE;
  PERFORM pg_temp.eq('V10 notes changed in the app: the app''s; a remark after the provider''s note: still Webling''s',
    (SELECT string_agg(coalesce(source_connection, 'app'), ',' ORDER BY "eventId" DESC) FROM public.event_participants
      WHERE ("eventId" = 61002 AND "memberId" = v_m[2]) OR ("eventId" = 61001 AND "memberId" = v_m[3])), 'app,webling');

  -- Webling withdraws all three from 61002 and the third from 61001
  DELETE FROM fx_part WHERE event_id = 61002 OR (event_id = 61001 AND external_id = v_ext[3]);
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope(), pg_temp.ev_snapshot());
  RESET ROLE;
  PERFORM pg_temp.eq('V10 the next run removes only the provider''s rows, the app''s stay',
    concat_ws(' ', r->'result'->>'registrations_removed',
              (SELECT string_agg("memberId"::text, ',' ORDER BY "memberId") FROM public.event_participants
                WHERE "eventId" = 61002),
              (SELECT count(*) FROM public.event_participants WHERE "eventId" = 61001 AND "memberId" = v_m[3])),
    concat_ws(' ', 2, (SELECT string_agg(x::text, ',' ORDER BY x) FROM unnest(v_m[1:2]) x), 0));
END $$;
ROLLBACK TO SAVEPOINT s;

-- A new event the database refuses: the issue names the record, not an
-- event with the Webling id (none was created)
SAVEPOINT s;
DO $$
DECLARE
  r jsonb;
BEGIN
  ALTER TABLE public.events ADD CONSTRAINT zz_check_boom CHECK (title <> 'BOOM') NOT VALID;
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', '{"complete": false}', jsonb_build_array(
         jsonb_build_object('external_id', '61998', 'data', jsonb_build_object(
           'calendar', jsonb_build_object('id', 'c1', 'name', 'Judo Agenda'), 'title', 'BOOM',
           'starts_on', pg_temp.fx_date(7)))));
  RESET ROLE;
  PERFORM pg_temp.eq('V11 a new event whose insert fails: an issue by external id, without event',
    (SELECT concat_ws(' ', r->>'final', r->'result'->>'write_failed', external_id, coalesce(event_id::text, '-'), detail)
       FROM public.integration_issues WHERE code = 'write_failed'), 'warning 1 61998 - 23514');
  PERFORM pg_temp.ok('V11 ... and nothing written for it',
    NOT EXISTS (SELECT 1 FROM public.events WHERE id = 61998)
    AND NOT EXISTS (SELECT 1 FROM public.event_links WHERE external_id = '61998'));
END $$;
ROLLBACK TO SAVEPOINT s;

-- A complete run checks only the records of the calendars it read; a
-- record that could not be fetched was not checked either
SAVEPOINT s;
DO $$
DECLARE
  r jsonb;
BEGIN
  PERFORM pg_temp.fx_setup();
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope(), pg_temp.ev_snapshot());
  RESET ROLE;
  -- the database refuses the new title of 61035 (calendar c2)
  ALTER TABLE public.events ADD CONSTRAINT zz_check_boom CHECK (title <> 'BOOM') NOT VALID;
  UPDATE fx_events SET title = 'BOOM' WHERE id = 61035;
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope(), pg_temp.ev_snapshot());
  RESET ROLE;
  PERFORM pg_temp.eq('V12 a Webling event the database refuses: write_failed open',
    (SELECT concat_ws(' ', event_id, resolved_at IS NULL) FROM public.integration_issues
      WHERE code = 'write_failed' AND external_id = '61035'), '61035 t');
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', '{"complete": false}', jsonb_build_array(jsonb_build_object(
         'external_id', '61035', 'data', jsonb_build_object('calendar', jsonb_build_object('id', 'c2', 'name', 'Aikido Agenda'),
         'title', 'Kurs 35', 'problem', 'fetch_failed'))));
  RESET ROLE;
  PERFORM pg_temp.eq('V12 a partial run that could not fetch it leaves it open',
    (SELECT (resolved_at IS NULL)::text FROM public.integration_issues
      WHERE code = 'write_failed' AND external_id = '61035'), 'true');
  -- (each step after a run that observes it again)
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope(), pg_temp.ev_snapshot());
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope('{c1}'), (SELECT jsonb_agg(x)
         FROM jsonb_array_elements(pg_temp.ev_snapshot()) x WHERE x->'data'->'calendar'->>'id' = 'c1'));
  RESET ROLE;
  PERFORM pg_temp.eq('V12 a complete run that read only c1 leaves the c2 issue open',
    concat_ws(' ', r->>'final', (SELECT resolved_at IS NULL FROM public.integration_issues
                                  WHERE code = 'write_failed' AND external_id = '61035')), 'ok t');
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope(), pg_temp.ev_snapshot());
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope('{c2}'), (SELECT jsonb_agg(CASE WHEN x->>'external_id' = '61035'
         THEN jsonb_set(x, '{data,problem}', '"fetch_failed"') ELSE x END)
         FROM jsonb_array_elements(pg_temp.ev_snapshot()) x WHERE x->'data'->'calendar'->>'id' = 'c2'));
  RESET ROLE;
  PERFORM pg_temp.eq('V12 a complete run of c2 that could not fetch it leaves it open',
    (SELECT (resolved_at IS NULL)::text FROM public.integration_issues
      WHERE code = 'write_failed' AND external_id = '61035'), 'true');
  UPDATE fx_events SET title = 'Kurs 35' WHERE id = 61035;
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope('{c2}'), (SELECT jsonb_agg(x)
         FROM jsonb_array_elements(pg_temp.ev_snapshot()) x WHERE x->'data'->'calendar'->>'id' = 'c2'));
  RESET ROLE;
  PERFORM pg_temp.eq('V12 a run that read c2 with the record fixed resolves it',
    concat_ws(' ', r->>'final', (SELECT resolved_at IS NOT NULL FROM public.integration_issues
                                  WHERE code = 'write_failed' AND external_id = '61035')), 'ok t');
END $$;
ROLLBACK TO SAVEPOINT s;

-- A holiday is no event: its issues name the record, never an event id
SAVEPOINT s;
DO $$
DECLARE
  v_cal jsonb := jsonb_build_object('id', 'c9', 'name', 'Ferien und Feiertage');
  v_recs jsonb;
  r jsonb;
BEGIN
  UPDATE public.integration_calendars SET target = 'break' WHERE connection = 'webling' AND name = 'Ferien und Feiertage';
  v_recs := jsonb_build_array(
    jsonb_build_object('external_id', '71001', 'data', jsonb_build_object('calendar', v_cal,
      'title', 'Herbstferien', 'starts_on', pg_temp.fx_date(10), 'ends_on', pg_temp.fx_date(23))),
    jsonb_build_object('external_id', '71002', 'data', jsonb_build_object('calendar', v_cal,
      'title', 'Feiertag', 'starts_on', pg_temp.fx_date(30))));
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope('{c9}'), v_recs);
  RESET ROLE;
  ALTER TABLE public.training_plan_breaks ADD CONSTRAINT zz_check_boom CHECK (title <> 'BOOM') NOT VALID;
  v_recs := pg_temp.with_record(pg_temp.with_record(v_recs, '71001', '{"time_from": "99:99"}'),
                                '71002', '{"title": "BOOM"}');
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope('{c9}'), v_recs);
  RESET ROLE;
  PERFORM pg_temp.eq('V13 issues of holidays (invalid value, refused write) carry no event id',
    concat_ws(' ', r->'result'->>'breaks_inserted', r->'result'->>'write_failed',
              (SELECT string_agg(code || ' ' || external_id || ' ' || coalesce(event_id::text, '-'), ',' ORDER BY code)
                 FROM public.integration_issues WHERE kind = 'events' AND external_id IN ('71001', '71002'))),
    '0 1 invalid_value 71001 -,write_failed 71002 -');
END $$;
ROLLBACK TO SAVEPOINT s;

-- A calendar the provider no longer has (deleted, or no access) does not
-- keep the other calendars' issues open: each issue knows its record's
-- calendar, and only that calendar's issues wait until it is read again
SAVEPOINT s;
DO $$
DECLARE
  v_c3 jsonb := jsonb_build_object('id', 'c3', 'name', 'Saisonkurse');
  r jsonb;
BEGIN
  PERFORM pg_temp.fx_setup();
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope('{c1,c2,c3}'), (
         SELECT jsonb_agg(CASE WHEN x->>'external_id' = '61005'
                               THEN jsonb_set(x, '{data,time_from}', '"99:99"') ELSE x END)
           FROM jsonb_array_elements(pg_temp.ev_snapshot()) x) || jsonb_build_array(
         jsonb_build_object('external_id', '61997', 'data', jsonb_build_object(
           'calendar', jsonb_build_object('id', 'c1', 'name', 'Judo Agenda'), 'title', 'Serie', 'problem', 'no_date')),
         jsonb_build_object('external_id', '63001', 'data', jsonb_build_object(
           'calendar', v_c3, 'title', 'Saison', 'problem', 'no_date'))));
  RESET ROLE;
  PERFORM pg_temp.eq('V14 issues of c1 (no date, an invalid value) and c3 (no date), each with its calendar',
    (SELECT string_agg(i.code || ' ' || i.external_id || ' ' || coalesce(to_jsonb(i)->>'calendar', '-'), ','
                       ORDER BY i.external_id)
       FROM public.integration_issues i WHERE i.kind = 'events' AND i.resolved_at IS NULL),
    'invalid_value 61005 c1,invalid_event 61997 c1,invalid_event 63001 c3');
  -- c3 is gone from Webling, and so are 61997 and 61005 (deleted with it: future, unused)
  DELETE FROM fx_events WHERE id = 61005;
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope('{c1,c2}'), pg_temp.ev_snapshot());
  RESET ROLE;
  PERFORM pg_temp.eq('V14 a complete run over c1 and c2 resolves c1''s issues, c3''s stays open',
    concat_ws(' ', r->>'final', r->'result'->>'deleted',
              (SELECT string_agg(external_id || '=' || (resolved_at IS NULL), ',' ORDER BY external_id)
                 FROM public.integration_issues WHERE kind = 'events')),
    'ok 1 61005=false,61997=false,63001=true');
END $$;
ROLLBACK TO SAVEPOINT s;

-- An adapter that sends every calendar the provider has (provider_calendars,
-- capabilities 3): a calendar missing from that list counts as read, with
-- no records. Its events go under the same guard, its issues resolve, the
-- catalog marks it until the provider lists it again.
SAVEPOINT s;
DO $$
DECLARE
  v_c3 jsonb := jsonb_build_object('id', 'c3', 'name', 'Saisonkurse');
  v_c1_only jsonb;
  v_run bigint;
  r jsonb;
BEGIN
  PERFORM pg_temp.fx_setup();
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope('{c1,c2,c3}') || '{"provider_calendars": ["c1", "c2", "c3"]}',
         pg_temp.ev_snapshot() || jsonb_build_array(jsonb_build_object('external_id', '63001', 'data',
           jsonb_build_object('calendar', v_c3, 'title', 'Saison', 'problem', 'no_date'))));
  PERFORM pg_temp.eq('V15 capabilities version 3',
    public.integration_begin('webling', 'members', '{"scope": {"complete": false}}')->'capabilities'->>'version', '3');
  RESET ROLE;
  UPDATE public.integration_runs SET status = 'failed', finished_at = now() WHERE status = 'running';
  PERFORM pg_temp.eq('V15 all three calendars listed: nothing gone, c3 new to review',
    concat_ws(' ', r->>'final', r->'result'->>'adopted',
              (SELECT count(*) FROM public.integration_calendars WHERE gone_at IS NOT NULL),
              (SELECT scope ? 'calendars_gone' FROM public.integration_runs WHERE kind = 'events'
                ORDER BY id DESC LIMIT 1),
              (SELECT x->'to_review'->>'calendars' FROM jsonb_array_elements(public.integration_status()) x
                WHERE x->>'id' = 'webling')),
    'ok 40 0 t 1');

  -- c2 (ten events, three of them over) and c3 deleted in Webling
  v_c1_only := (SELECT jsonb_agg(x) FROM jsonb_array_elements(pg_temp.ev_snapshot()) x
                 WHERE x->'data'->'calendar'->>'id' = 'c1');
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope('{c1}') || '{"provider_calendars": ["c1"]}', v_c1_only);
  RESET ROLE;
  PERFORM pg_temp.eq('V15 a deleted calendar''s events count for the events gone guard',
    concat_ws(' ', r->>'final', r->'guard'->>'refused', r->>'hint'), 'refused events_gone accept_events_gone=10');
  PERFORM pg_temp.eq('V15 the refused run marked both calendars gone and resolved nothing yet',
    concat_ws(' ', (SELECT scope->>'calendars' || ' ' || (scope->>'calendars_gone')
                      FROM public.integration_runs WHERE kind = 'events' ORDER BY id DESC LIMIT 1),
              (SELECT string_agg(external_id, ',' ORDER BY external_id) FROM public.integration_calendars
                WHERE gone_at IS NOT NULL),
              (SELECT (resolved_at IS NULL)::text FROM public.integration_issues WHERE external_id = '63001')),
    '["c1", "c2", "c3"] ["c2", "c3"] c2,c3 true');
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope('{c1}') || '{"provider_calendars": ["c1"]}', v_c1_only,
                   '{"accept_events_gone": 10}');
  RESET ROLE;
  PERFORM pg_temp.eq('V15 accepted: c2''s future events deleted, the ones over kept, c3''s issue resolved',
    concat_ws(' ', r->>'final', r->'result'->>'gone', r->'result'->>'deleted', r->'result'->>'kept',
              r->'result'->>'unchanged',
              (SELECT count(*) FROM public.events WHERE id BETWEEN 61031 AND 61040),
              (SELECT (resolved_at IS NOT NULL)::text FROM public.integration_issues WHERE external_id = '63001')),
    'ok 10 7 3 30 3 true');
  PERFORM pg_temp.eq('V15 a gone calendar is nothing left to review',
    (SELECT x->'to_review'->>'calendars' FROM jsonb_array_elements(public.integration_status()) x
      WHERE x->>'id' = 'webling'), '0');

  -- Listed again (restored, or access given back): no longer gone
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope('{c1}') || '{"provider_calendars": ["c1", "c2"]}', v_c1_only);
  RESET ROLE;
  PERFORM pg_temp.eq('V15 c2 listed again is no longer gone, c3 still is',
    concat_ws(' ', r->>'final', (SELECT string_agg(external_id, ',' ORDER BY external_id)
                                   FROM public.integration_calendars WHERE gone_at IS NOT NULL)),
    'ok c3');

  -- An adapter without the list (capabilities 2) changes nothing of it
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope('{c1}'), v_c1_only);
  RESET ROLE;
  PERFORM pg_temp.eq('V15 a run without provider_calendars settles only what it read',
    concat_ws(' ', r->>'final', (SELECT scope ? 'calendars_gone' FROM public.integration_runs
                                  WHERE kind = 'events' ORDER BY id DESC LIMIT 1),
              (SELECT string_agg(external_id, ',' ORDER BY external_id)
                 FROM public.integration_calendars WHERE gone_at IS NOT NULL)),
    'ok f c3');

  -- The list: an array of ids, never empty, holding the calendars read;
  -- only a complete scope settles from it
  PERFORM pg_temp.as_sync();
  PERFORM pg_temp.eq('V15 provider_calendars must be an array',
    pg_temp.err($q$SELECT public.integration_begin('webling', 'events',
      '{"scope": {"complete": true, "calendars": ["c1"], "provider_calendars": "c1"}}')$q$), '22023 invalid scope');
  PERFORM pg_temp.eq('V15 provider_calendars must not be empty',
    pg_temp.err($q$SELECT public.integration_begin('webling', 'events',
      '{"scope": {"complete": true, "calendars": [], "provider_calendars": []}}')$q$), '22023 invalid scope');
  PERFORM pg_temp.eq('V15 provider_calendars holds ids',
    pg_temp.err($q$SELECT public.integration_begin('webling', 'events',
      '{"scope": {"complete": true, "calendars": ["c1"], "provider_calendars": ["c1", "Judo Agenda"]}}')$q$),
    '22023 invalid scope');
  PERFORM pg_temp.eq('V15 a calendar read must be among them',
    pg_temp.err($q$SELECT public.integration_begin('webling', 'events',
      '{"scope": {"complete": true, "calendars": ["c1", "c2"], "provider_calendars": ["c1"]}}')$q$),
    '22023 invalid scope');
  v_run := (public.integration_begin('webling', 'events',
              '{"scope": {"complete": false, "provider_calendars": ["c1"]}}')->>'run')::bigint;
  RESET ROLE;
  PERFORM pg_temp.eq('V15 a partial scope settles nothing from the list',
    concat_ws(' ', (SELECT scope::text FROM public.integration_runs WHERE id = v_run),
              (SELECT string_agg(external_id, ',' ORDER BY external_id)
                 FROM public.integration_calendars WHERE gone_at IS NOT NULL)),
    '{"from": "' || to_char(date_trunc('year', (now() AT TIME ZONE 'Europe/Zurich')::date), 'YYYY-MM-DD')
      || '", "complete": false, "calendars": []} c3');
END $$;
ROLLBACK TO SAVEPOINT s;

-- An unknown participant of an event that is over: the event is staged
-- without its list, which is no longer read, and the issue resolves; a
-- future event whose list could not be read keeps it
SAVEPOINT s;
DO $$
DECLARE
  r jsonb;
BEGIN
  PERFORM pg_temp.fx_setup();
  INSERT INTO fx_part VALUES (61001, '9999999');
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope(), pg_temp.ev_snapshot());
  RESET ROLE;
  PERFORM pg_temp.eq('V15 an unknown participant of 61001 is reported',
    (SELECT (resolved_at IS NULL)::text FROM public.integration_issues
      WHERE code = 'unknown_participant' AND external_id = '9999999'), 'true');
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope(), (SELECT jsonb_agg(CASE WHEN x->>'external_id' = '61001'
         THEN x #- '{data,participants}' ELSE x END) FROM jsonb_array_elements(pg_temp.ev_snapshot()) x));
  RESET ROLE;
  PERFORM pg_temp.eq('V15 the list of the future event could not be read: still open',
    (SELECT (resolved_at IS NULL)::text FROM public.integration_issues
      WHERE code = 'unknown_participant' AND external_id = '9999999'), 'true');
  -- 61001 is over (moved to yesterday): staged without its list
  UPDATE fx_events SET day = -1 WHERE id = 61001;
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope(), pg_temp.ev_snapshot());
  RESET ROLE;
  PERFORM pg_temp.eq('V15 once the event is over, the issue resolves',
    concat_ws(' ', r->>'final', (SELECT (resolved_at IS NOT NULL)::text FROM public.integration_issues
                                  WHERE code = 'unknown_participant' AND external_id = '9999999')), 'ok true');
END $$;
ROLLBACK TO SAVEPOINT s;

-- An open issue follows its record into another calendar: an event moved
-- to c3, staged without its list, is not checked by a run that read only
-- c1 and c2
SAVEPOINT s;
DO $$
DECLARE
  v_moved jsonb;
  r jsonb;
BEGIN
  PERFORM pg_temp.fx_setup();
  INSERT INTO fx_part VALUES (61001, '9999999');
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope('{c1,c2,c3}'), pg_temp.ev_snapshot());
  RESET ROLE;
  SELECT jsonb_agg(CASE WHEN x->>'external_id' = '61001'
                        THEN jsonb_set(x #- '{data,participants}', '{data,calendar}',
                                       '{"id": "c3", "name": "Saisonkurse"}') ELSE x END)
    INTO v_moved FROM jsonb_array_elements(pg_temp.ev_snapshot()) x;
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope('{c1,c2,c3}'), v_moved);
  RESET ROLE;
  PERFORM pg_temp.eq('V16 61001 moved to c3 without its list: the open issue moves along',
    (SELECT concat_ws(' ', resolved_at IS NULL, to_jsonb(i)->>'calendar') FROM public.integration_issues i
      WHERE code = 'unknown_participant' AND external_id = '9999999'), 't c3');
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope('{c1,c2}'), pg_temp.without(v_moved, ARRAY['61001']));
  RESET ROLE;
  PERFORM pg_temp.eq('V16 ... and a complete run over c1 and c2 leaves it open',
    concat_ws(' ', r->>'final', (SELECT (resolved_at IS NULL)::text FROM public.integration_issues
                                  WHERE code = 'unknown_participant' AND external_id = '9999999')), 'ok true');
END $$;
ROLLBACK TO SAVEPOINT s;

-- Holidays: a calendar mapped to breaks
SAVEPOINT s;
DO $$
DECLARE
  v_admin uuid := pg_temp.sign_up('a0000000-0000-0000-0000-000000000012', 'h-admin@example.com', 'admin');
  v_tk uuid := pg_temp.sign_up('a0000000-0000-0000-0000-000000000013', 'h-tk@example.com', 'trainer');
  v_recs jsonb;
  v_cal bigint;
  v_break bigint;
  r jsonb;
BEGIN
  UPDATE public.user_profiles SET exam_role = 'manager' WHERE user_id = v_tk;
  INSERT INTO public.training_plan_breaks (title, date_from, date_to, cancels_training)
  VALUES ('Herbstferien', pg_temp.fx_date(10), pg_temp.fx_date(23), false);
  v_recs := jsonb_build_array(
    jsonb_build_object('external_id', '71001', 'data', jsonb_build_object('calendar', jsonb_build_object('id', 'c9', 'name', 'Schulferien'),
      'title', 'Herbstferien', 'starts_on', pg_temp.fx_date(10), 'ends_on', pg_temp.fx_date(23))),
    jsonb_build_object('external_id', '71002', 'data', jsonb_build_object('calendar', jsonb_build_object('id', 'c9', 'name', 'Schulferien'),
      'title', 'Feiertag', 'starts_on', pg_temp.fx_date(30))),
    jsonb_build_object('external_id', '71003', 'data', jsonb_build_object('calendar', jsonb_build_object('id', 'c9', 'name', 'Schulferien'),
      'title', 'Weihnachtsferien', 'starts_on', pg_temp.fx_date(50), 'ends_on', pg_temp.fx_date(64))));
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope('{c9}'), v_recs);
  RESET ROLE;
  PERFORM pg_temp.eq('V8 while the calendar holds events, holidays are events',
    concat_ws('/', r->'result'->>'inserted', (SELECT section FROM public.events WHERE id = 71002)), '3/General');
  SELECT id INTO v_cal FROM public.integration_calendars WHERE external_id = 'c9';
  PERFORM pg_temp.act_as(v_admin);
  r := public.integration_set_mapping('webling', jsonb_build_object('calendars', jsonb_build_array(
         jsonb_build_object('id', v_cal, 'target', 'break', 'closed_max_days', 3))));
  RESET ROLE;
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope('{c9}'), v_recs);
  RESET ROLE;
  PERFORM pg_temp.eq('V8 mapped to holidays: the unused events go, holidays come (one taken over from the TK)',
    concat_ws('/', r->>'final', r->'result'->>'deleted', r->'result'->>'breaks_inserted', r->'result'->>'breaks_adopted'),
    'ok/3/2/1');
  PERFORM pg_temp.eq('V8 short holidays close the dojo, long ones do not; the TK''s choice is kept',
    (SELECT string_agg(title || '=' || cancels_training, ',' ORDER BY date_from) FROM public.training_plan_breaks
      WHERE connection = 'webling'), 'Herbstferien=false,Feiertag=true,Weihnachtsferien=false');
  SELECT id INTO v_break FROM public.training_plan_breaks WHERE title = 'Weihnachtsferien';
  PERFORM pg_temp.act_as(v_tk);
  UPDATE public.training_plan_breaks SET cancels_training = true WHERE id = v_break;
  PERFORM pg_temp.eq('V9 the TK cannot change a provider holiday''s dates',
    pg_temp.err(format('UPDATE public.training_plan_breaks SET date_to = date_from WHERE id = %s', v_break)),
    'P0001 MANAGED_BY_PROVIDER');
  PERFORM pg_temp.eq('V9 nor fake provenance',
    pg_temp.err($q$INSERT INTO public.training_plan_breaks (title, date_from, date_to, connection, external_id)
                  VALUES ('x', '2099-01-01', '2099-01-01', 'webling', '1')$q$), 'P0001 MANAGED_BY_PROVIDER');
  RESET ROLE;
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope('{c9}'), v_recs);
  RESET ROLE;
  PERFORM pg_temp.eq('V9 the next run keeps "Dojo zu"', (SELECT cancels_training::text FROM public.training_plan_breaks
    WHERE id = v_break), 'true');
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'events', pg_temp.ev_scope('{c9}'), v_recs - 1);
  RESET ROLE;
  PERFORM pg_temp.eq('V9 a holiday gone from the provider is deleted', r->'result'->>'breaks_deleted', '1');
END $$;
ROLLBACK TO SAVEPOINT s;

-- The adapter's report: numbers under short keys, a code, nothing else
SAVEPOINT s;
DO $$
DECLARE
  r jsonb;
BEGIN
  PERFORM pg_temp.as_sync();
  r := pg_temp.run('webling', 'members', '{"complete": false}', pg_temp.webling_snapshot(), '{}', false,
                   '{"errors": 2, "counters": {"fetched": 228, "Hans Muster": 1, "skipped": "x"}, "error": "Name: Hans"}');
  RESET ROLE;
  PERFORM pg_temp.eq('F1 adapter errors make a warning', r->>'final', 'warning');
  PERFORM pg_temp.eq('F1 only numeric counters under short keys are kept',
    (SELECT adapter->>'counters' FROM public.integration_runs ORDER BY id DESC LIMIT 1), '{"fetched": 228}');
  PERFORM pg_temp.eq('F1 free text instead of an error code is replaced',
    (SELECT error FROM public.integration_runs ORDER BY id DESC LIMIT 1), 'adapter_error');
  PERFORM pg_temp.as_sync();
  PERFORM pg_temp.eq('F2 an external id that is not an id is refused',
    pg_temp.err($q$SELECT pg_temp.run('webling', 'members', '{}', '[{"external_id": "Hans Muster", "data": {"lastname": "M"}}]')$q$),
    '22023 records');
  RESET ROLE;
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- R Links to the provider's records (settings.record_urls, 20261103120000)
-----------------
SAVEPOINT s;
DO $$
DECLARE
  v_settings jsonb := (SELECT settings FROM public.integration_connections WHERE id = 'webling');
BEGIN
  PERFORM pg_temp.eq('R1 without event links the migration set no template',
    (SELECT count(*)::text FROM public.integration_connections WHERE settings ? 'record_urls'), '0');
  PERFORM pg_temp.eq('R1 nor does a later fill', public.integration_fill_record_urls()::text, '0');
  PERFORM pg_temp.ok('R1 the fill is no API function',
    NOT (has_function_privilege('anon', 'public.integration_fill_record_urls()', 'EXECUTE')
      OR has_function_privilege('authenticated', 'public.integration_fill_record_urls()', 'EXECUTE')
      OR has_function_privilege('service_role', 'public.integration_fill_record_urls()', 'EXECUTE')));

  -- Webling's events linked by the layer (portal links as urls); a gone
  -- link elsewhere and a live one without url do not count
  PERFORM pg_temp.fx_setup();
  PERFORM pg_temp.as_sync();
  PERFORM pg_temp.run('webling', 'events', pg_temp.ev_scope(), pg_temp.ev_snapshot());
  RESET ROLE;
  UPDATE public.event_links SET gone_at = now(), url = 'https://old.example.org/event/' || external_id
   WHERE connection = 'webling' AND external_id = '61001';
  UPDATE public.event_links SET url = NULL WHERE connection = 'webling' AND external_id = '61002';
  PERFORM pg_temp.eq('R2 filled from the live links', public.integration_fill_record_urls()::text, '1');
  PERFORM pg_temp.eq('R2 Webling''s portal link with {id}',
    (SELECT settings->>'record_urls' FROM public.integration_connections WHERE id = 'webling'),
    '{"event": "https://club.webling.ch/portal#/calendar/event/{id}"}');
  PERFORM pg_temp.ok('R2 the other settings stay',
    (SELECT settings - 'record_urls' FROM public.integration_connections WHERE id = 'webling') = v_settings);
  PERFORM pg_temp.eq('R2 a second fill changes nothing', public.integration_fill_record_urls()::text, '0');

  -- A template already set is kept, other keys of record_urls too
  UPDATE public.integration_connections
     SET settings = v_settings || '{"record_urls": {"event": "https://example.org/e/{id}"}}' WHERE id = 'webling';
  PERFORM pg_temp.eq('R3 a template already set is kept', public.integration_fill_record_urls()::text, '0');
  PERFORM pg_temp.eq('R3 unchanged',
    (SELECT settings->'record_urls'->>'event' FROM public.integration_connections WHERE id = 'webling'),
    'https://example.org/e/{id}');
  UPDATE public.integration_connections
     SET settings = v_settings || '{"record_urls": {"member": "https://example.org/m/{id}"}}' WHERE id = 'webling';
  PERFORM pg_temp.eq('R3 another record kind keeps its template', public.integration_fill_record_urls()::text, '1');
  PERFORM pg_temp.eq('R3 both templates',
    (SELECT settings->>'record_urls' FROM public.integration_connections WHERE id = 'webling'),
    '{"event": "https://club.webling.ch/portal#/calendar/event/{id}", "member": "https://example.org/m/{id}"}');
END $$;
ROLLBACK TO SAVEPOINT s;

-- Links that do not share one template leave the connection without one
SAVEPOINT s;
DO $$
BEGIN
  PERFORM pg_temp.fx_setup();
  PERFORM pg_temp.as_sync();
  PERFORM pg_temp.run('webling', 'events', pg_temp.ev_scope(), pg_temp.ev_snapshot());
  RESET ROLE;

  UPDATE public.event_links SET url = 'https://other.webling.ch/portal#/calendar/event/' || external_id
   WHERE connection = 'webling' AND external_id = '61003';
  PERFORM pg_temp.eq('R4 not when the part before the id differs', public.integration_fill_record_urls()::text, '0');

  UPDATE public.event_links SET url = 'https://club.webling.ch/portal#/calendar/event/61004'
   WHERE connection = 'webling' AND external_id = '61003';
  PERFORM pg_temp.eq('R5 not when a url does not end with its id', public.integration_fill_record_urls()::text, '0');

  UPDATE public.event_links SET url = 'https://' || external_id WHERE connection = 'webling';
  PERFORM pg_temp.eq('R6 not when the id would be the host', public.integration_fill_record_urls()::text, '0');
  UPDATE public.event_links SET url = 'https://example.org/{id}/' || external_id WHERE connection = 'webling';
  PERFORM pg_temp.eq('R6 nor when the part before it holds {id}', public.integration_fill_record_urls()::text, '0');
  PERFORM pg_temp.ok('R4-R6 no template set',
    NOT EXISTS (SELECT 1 FROM public.integration_connections WHERE settings ? 'record_urls'));
END $$;
ROLLBACK TO SAVEPOINT s;

-- The licence number: Webling owns it like the name; connections on and off
SAVEPOINT s;
DO $$
DECLARE
  v_admin uuid := pg_temp.sign_up('00000000-0000-0000-0000-0000000000c1', 'lic-admin@example.com', 'admin');
  v_trainer uuid := pg_temp.sign_up('00000000-0000-0000-0000-0000000000c2', 'lic-trainer@example.com', 'trainer');
  v_viewer uuid := pg_temp.sign_up('00000000-0000-0000-0000-0000000000c3', 'lic-viewer@example.com', 'viewer');
  v_snap jsonb;
  v_id text;
  v_app integer;
  r jsonb;
BEGIN
  PERFORM pg_temp.eq('L1 Webling owns the licence number',
    (SELECT field_policy->>'member.license_number' FROM public.integration_connections WHERE id = 'webling'), 'owned');
  PERFORM pg_temp.ok('L1 the policy check knows member.license_number',
    public.integration_field_policy_ok('{"member.license_number": "fill"}'));
  -- (off after the migration; the seed switches it on)
  PERFORM pg_temp.eq('L1 the J+S module is a connection without a sync run from the app',
    (SELECT concat_ws('/', provider, runs_in) FROM public.integration_connections WHERE id = 'js'),
    'js/sync');

  v_snap := pg_temp.webling_snapshot();
  v_id := v_snap->0->>'external_id';
  PERFORM pg_temp.as_sync();
  r := public.integration_begin('webling', 'members', '{"scope": {"complete": true}, "dry_run": true}');
  PERFORM pg_temp.ok('L2 capabilities list license_number',
    r->'capabilities'->'member_keys' ? 'license_number');
  PERFORM public.integration_finish((r->>'run')::bigint, '{}');

  r := pg_temp.run('webling', 'members', '{"complete": true}',
                   pg_temp.with_record(v_snap, v_id, '{"license_number": " 266750 "}'));
  PERFORM pg_temp.eq('L2 a run writes the number, trimmed', r->>'final', 'ok');
  PERFORM pg_temp.eq('L2 stored', (SELECT license_number FROM public.members WHERE id = v_id::integer), '266750');

  r := pg_temp.run('webling', 'members', '{"complete": true}', v_snap);
  PERFORM pg_temp.eq('L3 a record without the key leaves it',
    (SELECT license_number FROM public.members WHERE id = v_id::integer), '266750');
  r := pg_temp.run('webling', 'members', '{"complete": true}',
                   pg_temp.with_record(v_snap, v_id, '{"license_number": ""}'));
  PERFORM pg_temp.eq('L3 blank clears it (owned)',
    (SELECT coalesce(license_number, 'none') FROM public.members WHERE id = v_id::integer), 'none');
  RESET ROLE;

  -- Staff: read-only on a Webling member, editable on an app member
  v_app := (SELECT m.id FROM public.members m
             WHERE NOT EXISTS (SELECT 1 FROM public.member_links l WHERE l.member_id = m.id) LIMIT 1);
  PERFORM pg_temp.act_as(v_trainer);
  PERFORM pg_temp.eq('L4 a trainer cannot change the number of a Webling member',
    pg_temp.err(format('UPDATE public.members SET license_number = %L WHERE id = %s', '1', v_id)),
    'P0001 MANAGED_BY_PROVIDER');
  PERFORM pg_temp.eq('L4 a trainer enters it for a member from the app',
    pg_temp.err(format('UPDATE public.members SET license_number = %L WHERE id = %s', '123456', v_app)), '');
  PERFORM pg_temp.ok('L7 a trainer reads the J+S courses',
    (SELECT count(*) FROM public.js_courses) > 0);
  PERFORM pg_temp.eq('L5 a trainer cannot switch a connection',
    pg_temp.err($q$SELECT public.integration_set_enabled('js', true)$q$), '42501 NOT_ALLOWED');
  RESET ROLE;

  PERFORM pg_temp.act_as(v_viewer);
  PERFORM pg_temp.eq('L7 a viewer reads no J+S course and no course training',
    (SELECT count(*) FROM public.js_courses)::text || '/' || (SELECT count(*) FROM public.js_course_trainings)::text,
    '0/0');
  PERFORM pg_temp.eq('L7 a viewer still reads the licence number',
    (SELECT license_number FROM public.members WHERE id = v_app), '123456');
  RESET ROLE;

  PERFORM pg_temp.act_as(v_admin);
  PERFORM pg_temp.eq('L5 an admin switches the J+S module on',
    public.integration_set_enabled('js', true)::text, 'true');
  PERFORM pg_temp.eq('L5 and Webling off', public.integration_set_enabled('webling', false)::text, 'false');
  PERFORM pg_temp.eq('L5 an unknown connection',
    pg_temp.err($q$SELECT public.integration_set_enabled('nope', true)$q$), 'P0001 UNKNOWN_CONNECTION');
  RESET ROLE;
  PERFORM pg_temp.as_sync();
  PERFORM pg_temp.eq('L6 the sync is told that Webling is off',
    pg_temp.err($q$SELECT public.integration_begin('webling', 'members', '{"scope": {"complete": true}}')$q$),
    'PT423 CONNECTION_DISABLED');
  RESET ROLE;
END $$;
ROLLBACK TO SAVEPOINT s;

ROLLBACK;

\o
\echo 'integration_layer: all checks passed'
