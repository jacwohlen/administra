-- Checks for the training plan's calendar feeds
-- (20261106120000_calendar_feeds.sql, docs/TRAINING_PLAN.md).
--
-- Runs like member_access.sql: on a database with every migration and the
-- seed, as postgres, inside one transaction that is rolled back; each
-- scenario sits in a savepoint. A failed check raises and stops:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/checks/calendar_feeds.sql
--
--   T  tokens: staff get one (the same again, a new one on renewal), other
--      accounts are refused
--   P  privileges: nobody reads the tokens through the API; the feed is
--      for anon (calendar apps) and signed-in browsers
--   F  the feed: the account's members, only the plan's trainings, the
--      sessions and breaks of the window, the trainers' names
--   N  no feed: unknown or missing token, an account no longer staff
--   E  an empty plan gives empty arrays, never null

\set ON_ERROR_STOP 1
\o /dev/null
SET client_min_messages = notice;

BEGIN;

-----------------
-- Helpers (as in member_access.sql)
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

-- The SQLSTATE a statement raises, '' when it does not
CREATE FUNCTION pg_temp.state(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN '';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END $$;

-- Sign up through Supabase Auth (fires handle_auth_user_change), then set
-- the profile as an admin would
CREATE FUNCTION pg_temp.sign_up(p_id uuid, p_email text, p_status text, p_role text) RETURNS uuid
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  VALUES ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
          now(), '{}', '{}', now(), now());
  UPDATE public.user_profiles
     SET status = p_status::public.user_status, role = p_role::public.user_role
   WHERE user_id = p_id;
  RETURN p_id;
END $$;

-- Act as this account until RESET ROLE (or the savepoint is rolled back)
CREATE FUNCTION pg_temp.act_as(p_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
END $$;

-- Act as a calendar app: the anon key, no session
CREATE FUNCTION pg_temp.as_anon() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role": "anon"}', true);
  SET LOCAL ROLE anon;
END $$;

-- The account's token, created as that account
CREATE FUNCTION pg_temp.token_of(p_id uuid, p_renew boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_token text;
BEGIN
  PERFORM pg_temp.act_as(p_id);
  v_token := public.calendar_feed_token(p_renew);
  RESET ROLE;
  RETURN v_token;
END $$;

-- The feed as a calendar app fetches it
CREATE FUNCTION pg_temp.feed(p_token text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_feed jsonb;
BEGIN
  PERFORM pg_temp.as_anon();
  v_feed := public.calendar_feed(p_token);
  RESET ROLE;
  RETURN v_feed;
END $$;

-- A day relative to today, as the plan stores it
CREATE FUNCTION pg_temp.d(p_day integer) RETURNS text
LANGUAGE sql AS $$ SELECT to_char(current_date + p_day, 'YYYY-MM-DD') $$;

-- One field of every element of a feed array, sorted as text: '951,952'
CREATE FUNCTION pg_temp.list(p_feed jsonb, p_key text, p_field text) RETURNS text
LANGUAGE sql AS $$
  SELECT string_agg(e->>p_field, ',' ORDER BY e->>p_field) FROM jsonb_array_elements(p_feed->p_key) e;
$$;

-- The keys of an object, sorted: the JSON shape the app reads
CREATE FUNCTION pg_temp.keys(p_obj jsonb) RETURNS text
LANGUAGE sql AS $$
  SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(p_obj) k;
$$;

-----------------
-- Test data
-----------------

-- Accounts: staff of every role, a member account, one waiting with a
-- staff role, one disabled
SELECT pg_temp.sign_up('20000000-0000-4000-8000-000000000001', 'kalender.trainer@test.ch', 'approved', 'trainer');
SELECT pg_temp.sign_up('20000000-0000-4000-8000-000000000002', 'kalender.viewer@test.ch', 'approved', 'viewer');
SELECT pg_temp.sign_up('20000000-0000-4000-8000-000000000003', 'kalender.admin@test.ch', 'approved', 'admin');
SELECT pg_temp.sign_up('20000000-0000-4000-8000-000000000004', 'kalender.member@test.ch', 'approved', 'member');
SELECT pg_temp.sign_up('20000000-0000-4000-8000-000000000005', 'kalender.pending@test.ch', 'pending', 'trainer');
SELECT pg_temp.sign_up('20000000-0000-4000-8000-000000000006', 'kalender.disabled@test.ch', 'disabled', 'trainer');

-- Members: the trainer account's own (by address, plus a linked one), its
-- trial record with the same address, the main trainer, a trainer only
-- outside the window, one only on a training outside the plan
INSERT INTO public.members (id, firstname, lastname, labels, email) VALUES
  (951, 'Lea', 'Leitung', '[]', ' Kalender.Trainer@Test.CH '),
  (952, 'Linus', 'Verknuepft', '[]', NULL),
  (953, 'Tara', 'Probe', '["probetraining"]', 'kalender.trainer@test.ch'),
  (954, 'Hans', 'Haupt', '[]', NULL),
  (955, 'Otto', 'Ausserhalb', '[]', NULL),
  (956, 'Fritz', 'Fremd', '[]', NULL);
UPDATE public.user_profiles SET member_id = 952 WHERE user_id = '20000000-0000-4000-8000-000000000001';

-- A planned training and one outside the plan
INSERT INTO public.trainings (id, title, weekday, "dateFrom", "dateTo", section, "mainTrainerId") VALUES
  (951, 'Kalender Check', 'Tuesday', '18.00', '19.30', 'Judo', 954),
  (952, 'Nicht im Plan', 'Thursday', '18:00', '19:30', 'Judo', 956);
INSERT INTO public.training_plan_trainings (training_id) VALUES (951);

-- Sessions on both edges of the window (70 days back, 400 ahead)
INSERT INTO public.training_plan_sessions (training_id, date, trainer_id, topic, notes, cancelled) VALUES
  (951, pg_temp.d(-71), 955, 'Zu alt', NULL, NULL),
  (951, pg_temp.d(-70), 951, 'Erster Tag', NULL, NULL),
  (951, pg_temp.d(7), 951, NULL, 'Halle besetzt', true),
  (951, pg_temp.d(400), 951, 'Letzter Tag', NULL, false),
  (951, pg_temp.d(401), 955, 'Zu weit', NULL, NULL),
  (952, pg_temp.d(7), 956, 'Nicht im Plan', NULL, NULL);

-- Breaks on both edges of the window
INSERT INTO public.training_plan_breaks (title, date_from, date_to, cancels_training) VALUES
  ('zz vorbei', pg_temp.d(-90), pg_temp.d(-71), true),
  ('zz endet am Rand', pg_temp.d(-90), pg_temp.d(-70), true),
  ('zz Ferien', pg_temp.d(20), pg_temp.d(30), false),
  ('zz beginnt am Rand', pg_temp.d(400), pg_temp.d(410), true),
  ('zz zu weit', pg_temp.d(401), pg_temp.d(410), true);

-----------------
-- T Tokens
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_trainer uuid := '20000000-0000-4000-8000-000000000001';
  t1 text;
  t2 text;
  t3 text;
BEGIN
  t1 := pg_temp.token_of(v_trainer);
  PERFORM pg_temp.ok('T1 staff get a token of 64 hex characters', t1 ~ '^[0-9a-f]{64}$');
  PERFORM pg_temp.eq('T1 stored once for the account',
    (SELECT count(*)::text FROM public.calendar_feeds WHERE user_id = v_trainer AND token = t1), '1');
  PERFORM pg_temp.eq('T2 the same token on the next call', pg_temp.token_of(v_trainer), t1);
  PERFORM pg_temp.eq('T2 the same token without renewal (false, null)',
    pg_temp.token_of(v_trainer, false) || pg_temp.token_of(v_trainer, NULL), t1 || t1);

  UPDATE public.calendar_feeds SET created_at = now() - interval '1 year' WHERE user_id = v_trainer;
  t2 := pg_temp.token_of(v_trainer, true);
  PERFORM pg_temp.ok('T3 renewal gives a new token', t2 ~ '^[0-9a-f]{64}$' AND t2 <> t1);
  PERFORM pg_temp.eq('T3 it replaces the old one, created now',
    (SELECT string_agg(token || ' ' || (created_at = now())::text, ',') FROM public.calendar_feeds
      WHERE user_id = v_trainer), t2 || ' true');
  PERFORM pg_temp.eq('T3 the next call keeps the new one', pg_temp.token_of(v_trainer), t2);

  t3 := pg_temp.token_of('20000000-0000-4000-8000-000000000002');
  PERFORM pg_temp.ok('T4 viewers and admins get their own',
    t3 <> t2 AND pg_temp.token_of('20000000-0000-4000-8000-000000000003') NOT IN (t2, t3));

  PERFORM pg_temp.act_as('20000000-0000-4000-8000-000000000004');
  PERFORM pg_temp.eq('T5 a member account is refused',
    pg_temp.state('SELECT public.calendar_feed_token()'), '42501');
  RESET ROLE;
  PERFORM pg_temp.act_as('20000000-0000-4000-8000-000000000005');
  PERFORM pg_temp.eq('T5 a waiting account with a staff role is refused',
    pg_temp.state('SELECT public.calendar_feed_token()'), '42501');
  RESET ROLE;
  PERFORM pg_temp.act_as('20000000-0000-4000-8000-000000000006');
  PERFORM pg_temp.eq('T5 a disabled trainer is refused',
    pg_temp.state('SELECT public.calendar_feed_token(true)'), '42501');
  RESET ROLE;
  PERFORM pg_temp.act_as('10000000-0000-4000-8000-0000000000ff');
  PERFORM pg_temp.eq('T5 an account without profile is refused',
    pg_temp.state('SELECT public.calendar_feed_token()'), '42501');
  RESET ROLE;
  PERFORM pg_temp.as_anon();
  PERFORM pg_temp.eq('T5 anon cannot call it',
    pg_temp.state('SELECT public.calendar_feed_token()'), '42501');
  RESET ROLE;
  PERFORM pg_temp.eq('T5 no token for the refused accounts',
    (SELECT count(*)::text FROM public.calendar_feeds WHERE user_id IN (
       '20000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000005',
       '20000000-0000-4000-8000-000000000006')), '0');

  DELETE FROM auth.users WHERE id = v_trainer;
  PERFORM pg_temp.eq('T6 a deleted account takes its token along',
    (SELECT count(*)::text FROM public.calendar_feeds WHERE token = t2), '0');
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- P Privileges
-----------------

SELECT pg_temp.ok('P1 the API roles have no privilege on calendar_feeds', NOT (
     has_table_privilege('anon', 'public.calendar_feeds',
                         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  OR has_table_privilege('authenticated', 'public.calendar_feeds',
                         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')));
SELECT pg_temp.ok('P1 RLS on, no policies',
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.calendar_feeds'::regclass)
  AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'calendar_feeds'));
SELECT pg_temp.ok('P2 the token only for signed-in accounts',
  has_function_privilege('authenticated', 'public.calendar_feed_token(boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.calendar_feed_token(boolean)', 'EXECUTE'));
SELECT pg_temp.ok('P2 the feed for calendar apps (anon) and browsers (authenticated)',
  has_function_privilege('anon', 'public.calendar_feed(text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.calendar_feed(text)', 'EXECUTE'));

SAVEPOINT s;
DO $$
DECLARE
  v_admin uuid := '20000000-0000-4000-8000-000000000003';
BEGIN
  PERFORM pg_temp.token_of(v_admin);
  PERFORM pg_temp.act_as(v_admin);
  PERFORM pg_temp.eq('P3 not even an admin reads the tokens',
    pg_temp.state('SELECT count(*) FROM public.calendar_feeds'), '42501');
  PERFORM pg_temp.eq('P3 nor plants one',
    pg_temp.state($q$UPDATE public.calendar_feeds SET token = repeat('a', 64)$q$), '42501');
  RESET ROLE;
  PERFORM pg_temp.as_anon();
  PERFORM pg_temp.eq('P3 anon reads no token',
    pg_temp.state('SELECT count(*) FROM public.calendar_feeds'), '42501');
  RESET ROLE;
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- F The feed
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_trainer uuid := '20000000-0000-4000-8000-000000000001';
  v_token text := pg_temp.token_of(v_trainer);
  f jsonb := pg_temp.feed(v_token);
  v_mine text;
BEGIN
  PERFORM pg_temp.eq('F1 a calendar app gets the feed by the token',
    pg_temp.keys(f), 'breaks,member_ids,sessions,trainers,trainings');

  -- member_ids: my_member_ids() of the account, which the feed mirrors
  PERFORM pg_temp.act_as(v_trainer);
  v_mine := (SELECT string_agg(x::text, ',' ORDER BY x::text) FROM public.my_member_ids() x);
  RESET ROLE;
  PERFORM pg_temp.eq('F2 member_ids: the linked member and the one with the address, no trial record',
    (SELECT string_agg(x, ',' ORDER BY x) FROM jsonb_array_elements_text(f->'member_ids') x), '951,952');
  PERFORM pg_temp.eq('F2 member_ids are my_member_ids()',
    (SELECT string_agg(x, ',' ORDER BY x) FROM jsonb_array_elements_text(f->'member_ids') x), v_mine);
  PERFORM pg_temp.eq('F2 an admin without a member: none',
    (pg_temp.feed(pg_temp.token_of('20000000-0000-4000-8000-000000000003'))->'member_ids')::text, '[]');

  PERFORM pg_temp.eq('F3 trainings: those of the plan',
    pg_temp.list(f, 'trainings', 'id'),
    (SELECT string_agg(training_id::text, ',' ORDER BY training_id::text) FROM public.training_plan_trainings));
  PERFORM pg_temp.eq('F3 a training as the app reads it',
    (SELECT e::text FROM jsonb_array_elements(f->'trainings') e WHERE e->>'id' = '951'),
    '{"id": 951, "title": "Kalender Check", "dateTo": "19.30", "section": "Judo", "weekday": "Tuesday", "dateFrom": "18.00", "mainTrainerId": 954}');

  PERFORM pg_temp.eq('F4 sessions: the window''s, edges included',
    (SELECT string_agg(e->>'date', ',' ORDER BY e->>'date') FROM jsonb_array_elements(f->'sessions') e
      WHERE e->>'training_id' = '951'),
    concat_ws(',', pg_temp.d(-70), pg_temp.d(7), pg_temp.d(400)));
  PERFORM pg_temp.eq('F4 sessions: only of the plan''s trainings, only in the window',
    (SELECT count(*)::text FROM jsonb_array_elements(f->'sessions') e
      WHERE (e->>'training_id')::smallint NOT IN (SELECT training_id FROM public.training_plan_trainings)
         OR e->>'date' NOT BETWEEN pg_temp.d(-70) AND pg_temp.d(400)), '0');
  PERFORM pg_temp.eq('F4 sessions: every one of the plan''s in the window',
    jsonb_array_length(f->'sessions')::text,
    (SELECT count(*)::text FROM public.training_plan_sessions s
      JOIN public.training_plan_trainings pt ON pt.training_id = s.training_id
      WHERE s.date BETWEEN pg_temp.d(-70) AND pg_temp.d(400)));
  PERFORM pg_temp.eq('F4 a session as the app reads it',
    (SELECT pg_temp.keys(e) || ' ' || concat_ws('|', e->>'trainer_id', coalesce(e->>'topic', '-'),
                                                 e->>'notes', e->>'cancelled',
                                                 ((e->>'updated_at')::timestamptz = now())::text)
       FROM jsonb_array_elements(f->'sessions') e
      WHERE e->>'training_id' = '951' AND e->>'date' = pg_temp.d(7)),
    'cancelled,date,id,notes,topic,trainer_id,training_id,updated_at 951|-|Halle besetzt|true|true');

  PERFORM pg_temp.eq('F5 breaks: those overlapping the window',
    (SELECT string_agg(e->>'title', ',' ORDER BY e->>'date_from', e->>'title') FROM jsonb_array_elements(f->'breaks') e
      WHERE e->>'title' LIKE 'zz %'),
    'zz endet am Rand,zz Ferien,zz beginnt am Rand');
  PERFORM pg_temp.eq('F5 a break as the app reads it',
    (SELECT pg_temp.keys(e) || ' ' || (e->>'cancels_training')
       FROM jsonb_array_elements(f->'breaks') e WHERE e->>'title' = 'zz Ferien'),
    'cancels_training,date_from,date_to,id,title false');

  PERFORM pg_temp.eq('F6 trainers: session trainers of the window and main trainers, by name',
    (SELECT string_agg(concat_ws(' ', e->>'id', e->>'firstname', e->>'lastname'), ',' ORDER BY e->>'id')
       FROM jsonb_array_elements(f->'trainers') e WHERE (e->>'id')::integer BETWEEN 951 AND 956),
    '951 Lea Leitung,954 Hans Haupt');
  PERFORM pg_temp.eq('F6 trainers: nobody else, only their names',
    pg_temp.list(f, 'trainers', 'id') || ' ' || pg_temp.keys(f->'trainers'->0),
    (SELECT string_agg(x::text, ',' ORDER BY x::text) FROM (
       SELECT (e->>'trainer_id')::integer FROM jsonb_array_elements(f->'sessions') e
        WHERE e->>'trainer_id' IS NOT NULL
       UNION
       SELECT (e->>'mainTrainerId')::integer FROM jsonb_array_elements(f->'trainings') e
        WHERE e->>'mainTrainerId' IS NOT NULL) t(x)) || ' firstname,id,lastname');

  PERFORM pg_temp.act_as('20000000-0000-4000-8000-000000000004');
  PERFORM pg_temp.eq('F7 a signed-in browser gets the same feed', public.calendar_feed(v_token)::text, f::text);
  RESET ROLE;
  PERFORM pg_temp.eq('F7 viewers and admins get the whole plan too',
    (pg_temp.feed(pg_temp.token_of('20000000-0000-4000-8000-000000000002')) - 'member_ids')::text,
    (f - 'member_ids')::text);
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- N No feed
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_trainer uuid := '20000000-0000-4000-8000-000000000001';
  v_viewer uuid := '20000000-0000-4000-8000-000000000002';
  v_old text := pg_temp.token_of(v_trainer);
  v_new text := pg_temp.token_of(v_trainer, true);
  v_viewer_token text := pg_temp.token_of(v_viewer);
BEGIN
  PERFORM pg_temp.ok('N1 an unknown token: null', pg_temp.feed(repeat('0', 64)) IS NULL);
  PERFORM pg_temp.ok('N1 a missing token: null', pg_temp.feed(NULL) IS NULL);
  PERFORM pg_temp.ok('N1 no other spelling of the token: null',
    pg_temp.feed(upper(v_new)) IS NULL AND pg_temp.feed(' ' || v_new) IS NULL);
  PERFORM pg_temp.ok('N2 renewed: the old link stops, the new one works',
    pg_temp.feed(v_old) IS NULL AND pg_temp.feed(v_new) IS NOT NULL);

  UPDATE public.user_profiles SET status = 'disabled' WHERE user_id = v_trainer;
  PERFORM pg_temp.ok('N3 a disabled account: null', pg_temp.feed(v_new) IS NULL);
  UPDATE public.user_profiles SET status = 'pending' WHERE user_id = v_trainer;
  PERFORM pg_temp.ok('N3 an account waiting again: null', pg_temp.feed(v_new) IS NULL);
  UPDATE public.user_profiles SET status = 'approved' WHERE user_id = v_trainer;
  PERFORM pg_temp.ok('N3 approved again: the same link works', pg_temp.feed(v_new) IS NOT NULL);

  PERFORM pg_temp.ok('N4 the viewer''s link works', pg_temp.feed(v_viewer_token) IS NOT NULL);
  UPDATE public.user_profiles SET role = 'member' WHERE user_id = v_viewer;
  PERFORM pg_temp.ok('N4 turned into a member account: null', pg_temp.feed(v_viewer_token) IS NULL);
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- E An empty plan
-----------------

SAVEPOINT s;
DO $$
DECLARE
  f jsonb;
BEGIN
  DELETE FROM public.training_plan_trainings;
  DELETE FROM public.training_plan_breaks;
  f := pg_temp.feed(pg_temp.token_of('20000000-0000-4000-8000-000000000003'));
  PERFORM pg_temp.eq('E1 nothing planned: empty arrays',
    f::text, '{"breaks": [], "sessions": [], "trainers": [], "trainings": [], "member_ids": []}');
END $$;
ROLLBACK TO SAVEPOINT s;

ROLLBACK;

\o
\echo 'calendar_feeds: all checks passed'
