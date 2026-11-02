-- Checks for substitutes and swaps in the training plan
-- (20261111120000_training_plan_requests.sql, docs/TRAINING_PLAN.md).
--
-- Runs like member_access.sql: on a database with every migration and the
-- seed, as postgres, inside one transaction that is rolled back; each
-- scenario sits in a savepoint. A failed check raises and stops:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/checks/training_plan_requests.sql
--
--   S  schema and privileges: row level security, privileges, the policy,
--      the functions
--   R  reading: staff read the requests, a member account and anon nothing
--   C  asking: only the trainer of a held, planned date from today on asks
--      one other member; one open request per date
--   A  answering: only the person asked; a substitute takes the date, topic
--      and note stay; declining changes nothing; a request whose date
--      changed meanwhile expires instead
--   W  swapping: both dates in one step, the topics trade places, the notes
--      as the request says
--   X  withdrawing: the asker, the TK, the main trainer; not the person asked
--   E  the mail data: for the two people and the TK only
--   M  merge: the two references are in the reviewed list, a request
--      between the merged members is withdrawn
--   D  deleting a member or a training removes its requests

\set ON_ERROR_STOP 1
\o /dev/null
SET client_min_messages = notice;

BEGIN;

-----------------
-- Helpers (as in training_plan_mail.sql)
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

CREATE FUNCTION pg_temp.sign_up(p_id uuid, p_email text, p_status text, p_role text,
                                p_exam_role text DEFAULT NULL, p_member integer DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  VALUES ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
          now(), '{}', '{}', now(), now());
  UPDATE public.user_profiles
     SET status = p_status::public.user_status, role = p_role::public.user_role,
         exam_role = p_exam_role, member_id = p_member
   WHERE user_id = p_id;
  RETURN p_id;
END $$;

-- As this account: the SQLSTATE a statement raises, else its first value
-- as text ('' for no value); the role is reset either way
CREATE FUNCTION pg_temp.as_user(p_id uuid, p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE p_sql INTO v;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RETURN SQLSTATE || ' ' || SQLERRM;
  END;
  RESET ROLE;
  RETURN coalesce(v, '');
END $$;

-- A session as postgres reads it: 'trainer|topic|notes', '-' for null
CREATE FUNCTION pg_temp.session(p_training integer, p_date text) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce((SELECT concat_ws('|', coalesce(trainer_id::text, '-'), coalesce(topic, '-'), coalesce(notes, '-'))
                   FROM public.training_plan_sessions WHERE training_id = p_training AND date = p_date), 'none');
$$;

-- Functions, not subqueries: a subquery would read the snapshot from before
-- the answer in the same expression
CREATE FUNCTION pg_temp.status(p_id bigint) RETURNS text
LANGUAGE sql AS $$ SELECT status FROM public.training_plan_requests WHERE id = p_id $$;

CREATE FUNCTION pg_temp.answered_by(p_id bigint) RETURNS text
LANGUAGE sql AS $$ SELECT answered_by::text FROM public.training_plan_requests WHERE id = p_id $$;

-----------------
-- Test data (ids below 1'000 the seed does not use)
-----------------

-- Anna is main trainer of Monday, Max leads a Wednesday, Vera is a viewer,
-- Lea has no account, Mia has a member account
INSERT INTO public.members (id, firstname, lastname, labels, email) VALUES
  (962, 'Anna', 'Anfrage', '[]', 'anna@test.ch'),
  (963, 'Max', 'Muster', '[]', 'max.member@test.ch'),
  (964, 'Vera', 'Vertretung', '[]', 'vera@test.invalid'),
  (965, 'Lea', 'Ohnekonto', '[]', NULL),
  (966, 'Mia', 'Mitglied', '[]', 'mia@test.ch');
INSERT INTO public.trainings (id, title, weekday, "dateFrom", "dateTo", section, "mainTrainerId") VALUES
  (961, 'Tausch Montag', 'Monday', '19:00', '20:30', 'Judo', 962),
  (962, 'Tausch Mittwoch', 'Wednesday', '19:00', '20:30', 'Judo', NULL),
  (963, 'Nicht im Plan', 'Monday', '18:00', '19:00', 'Judo', 962);
INSERT INTO public.training_plan_trainings (training_id) VALUES (961), (962);
INSERT INTO public.training_plan_sessions (training_id, date, trainer_id, topic, notes) VALUES
  (961, '2031-01-06', NULL, 'Uchi-mata', 'Annas Notiz'),
  (962, '2031-01-08', 963, 'Kansetsu', 'Max Notiz');
INSERT INTO public.training_plan_breaks (title, date_from, date_to, cancels_training) VALUES
  ('Tausch zu', '2031-01-20', '2031-01-20', true);

SELECT pg_temp.sign_up('41000000-0000-4000-8000-000000000001', 'anna.konto@test.ch', 'approved', 'trainer', NULL, 962);
SELECT pg_temp.sign_up('41000000-0000-4000-8000-000000000002', 'max.konto@test.ch', 'approved', 'trainer', NULL, 963);
SELECT pg_temp.sign_up('41000000-0000-4000-8000-000000000003', 'vera.konto@test.ch', 'approved', 'viewer', NULL, 964);
SELECT pg_temp.sign_up('41000000-0000-4000-8000-000000000004', 'mia@test.ch', 'approved', 'member');
SELECT pg_temp.sign_up('41000000-0000-4000-8000-000000000005', 'tk.konto@test.ch', 'approved', 'viewer', 'manager');
SELECT pg_temp.sign_up('41000000-0000-4000-8000-000000000006', 'admin.konto@test.ch', 'approved', 'admin');

\set anna '''41000000-0000-4000-8000-000000000001'''
\set max '''41000000-0000-4000-8000-000000000002'''
\set vera '''41000000-0000-4000-8000-000000000003'''
\set mia '''41000000-0000-4000-8000-000000000004'''
\set tk '''41000000-0000-4000-8000-000000000005'''

-----------------
-- S Schema and privileges
-----------------

SELECT pg_temp.ok('S1 row level security on',
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.training_plan_requests'::regclass));
SELECT pg_temp.eq('S2 authenticated only selects, anon and PUBLIC nothing',
  (SELECT string_agg(a.privilege_type, ',' ORDER BY a.privilege_type)
     FROM aclexplode((SELECT relacl FROM pg_class WHERE oid = 'public.training_plan_requests'::regclass)) a
    WHERE a.grantee = 'authenticated'::regrole)
  || ' ' || NOT EXISTS (SELECT 1 FROM aclexplode((SELECT relacl FROM pg_class
                                                  WHERE oid = 'public.training_plan_requests'::regclass)) a
                         WHERE a.grantee IN (0, 'anon'::regrole)),
  'SELECT true');
SELECT pg_temp.eq('S3 the policy: staff read',
  (SELECT string_agg(cmd || ' ' || qual, ', ') FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'training_plan_requests'),
  'SELECT ( SELECT is_staff() AS is_staff)');
SELECT pg_temp.eq('S4 the API functions: SECURITY DEFINER, fixed search_path, authenticated only',
  (SELECT string_agg(p.proname || ' ' || concat_ws(' ', p.prosecdef, array_to_string(p.proconfig, ','),
                       has_function_privilege('authenticated', p.oid, 'EXECUTE'),
                       has_function_privilege('anon', p.oid, 'EXECUTE')), ', ' ORDER BY p.proname)
     FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'training_plan_request%'),
  'training_plan_request_answer t search_path=public t f, '
  || 'training_plan_request_create t search_path=public t f, '
  || 'training_plan_request_mail t search_path=public t f, '
  || 'training_plan_request_valid f search_path=public f f, '
  || 'training_plan_request_withdraw t search_path=public t f, '
  || 'training_plan_requests_expire f search_path=public f f');
SELECT pg_temp.ok('S5 the slot helper is internal',
  NOT has_function_privilege('authenticated', 'public.training_plan_slot(integer, text)'::regprocedure, 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.training_plan_slot(integer, text)'::regprocedure, 'EXECUTE'));

-----------------
-- C Asking
-----------------

SELECT pg_temp.eq('C1 a member account cannot ask',
  pg_temp.as_user(:mia, $$SELECT public.training_plan_request_create('substitute', 961, '2031-01-06', 964)$$),
  '42501 NOT_ALLOWED');
SELECT pg_temp.eq('C2 only who leads the date asks (Max does not lead Monday)',
  pg_temp.as_user(:max, $$SELECT public.training_plan_request_create('substitute', 961, '2031-01-06', 964)$$),
  '42501 NOT_YOUR_DATE');
SELECT pg_temp.eq('C3 a past date',
  pg_temp.as_user(:anna, $$SELECT public.training_plan_request_create('substitute', 961, '2020-01-06', 964)$$),
  'P0001 PAST');
SELECT pg_temp.eq('C4 a training outside the plan, and a date it does not fall on',
  pg_temp.as_user(:anna, $$SELECT public.training_plan_request_create('substitute', 963, '2031-01-06', 964)$$)
  || ' / ' || pg_temp.as_user(:anna, $$SELECT public.training_plan_request_create('substitute', 961, '2031-01-07', 964)$$),
  'P0001 NOT_PLANNED / P0001 NOT_PLANNED');
SELECT pg_temp.eq('C5 a date the dojo is closed',
  pg_temp.as_user(:anna, $$SELECT public.training_plan_request_create('substitute', 961, '2031-01-20', 964)$$),
  'P0001 CANCELLED');
SELECT pg_temp.eq('C6 asking oneself, or an unknown member',
  pg_temp.as_user(:anna, $$SELECT public.training_plan_request_create('substitute', 961, '2031-01-06', 962)$$)
  || ' / ' || pg_temp.as_user(:anna, $$SELECT public.training_plan_request_create('substitute', 961, '2031-01-06', 1999999)$$),
  'P0001 BAD_MEMBER / P0001 BAD_MEMBER');
SELECT pg_temp.eq('C7 a swap needs a date the person asked leads',
  pg_temp.as_user(:anna, $$SELECT public.training_plan_request_create('swap', 961, '2031-01-06', 963, 962, '2031-01-15')$$)
  || ' / ' || pg_temp.as_user(:anna, $$SELECT public.training_plan_request_create('swap', 961, '2031-01-06', 963)$$)
  || ' / ' || pg_temp.as_user(:anna, $$SELECT public.training_plan_request_create('substitute', 961, '2031-01-06', 963, 962, '2031-01-08')$$),
  'P0001 NOT_THEIR_DATE / 22023 BAD_REQUEST / 22023 BAD_REQUEST');
SELECT pg_temp.eq('C8 nobody writes the table directly',
  pg_temp.as_user(:anna, $$INSERT INTO public.training_plan_requests (kind, training_id, date, from_member_id, to_member_id)
                           VALUES ('substitute', 961, '2031-01-06', 962, 964) RETURNING id$$),
  '42501 permission denied for table training_plan_requests');

-----------------
-- R, A Reading and answering a substitute
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_id bigint;
BEGIN
  v_id := pg_temp.as_user('41000000-0000-4000-8000-000000000001',
            $q$SELECT public.training_plan_request_create('substitute', 961, '2031-01-06', 964, NULL, NULL, '  Matten liegen bereit ')$q$)::bigint;
  PERFORM pg_temp.eq('C9 the request: open, from the leader (the main trainer), message trimmed',
    (SELECT concat_ws('|', kind, from_member_id, to_member_id, status, message, created_by)
       FROM public.training_plan_requests WHERE id = v_id),
    'substitute|962|964|open|Matten liegen bereit|41000000-0000-4000-8000-000000000001');
  PERFORM pg_temp.eq('C10 one open request per date',
    pg_temp.as_user('41000000-0000-4000-8000-000000000001',
      $q$SELECT public.training_plan_request_create('substitute', 961, '2031-01-06', 963)$q$),
    'P0001 BUSY');

  PERFORM pg_temp.eq('R1 staff read it, a member account does not',
    pg_temp.as_user('41000000-0000-4000-8000-000000000002', 'SELECT count(*)::text FROM public.training_plan_requests')
    || ' ' || pg_temp.as_user('41000000-0000-4000-8000-000000000004', 'SELECT count(*)::text FROM public.training_plan_requests'),
    '1 0');

  PERFORM pg_temp.eq('A1 only the person asked answers',
    pg_temp.as_user('41000000-0000-4000-8000-000000000002', format('SELECT public.training_plan_request_answer(%s, true)', v_id))
    || ' / ' || pg_temp.as_user('41000000-0000-4000-8000-000000000001', format('SELECT public.training_plan_request_answer(%s, true)', v_id)),
    '42501 NOT_ALLOWED / 42501 NOT_ALLOWED');
  PERFORM pg_temp.eq('A2 Vera takes over: the trainer changes, topic and note stay',
    pg_temp.as_user('41000000-0000-4000-8000-000000000003', format('SELECT public.training_plan_request_answer(%s, true)', v_id))
    || ' ' || pg_temp.session(961, '2031-01-06') || ' ' || pg_temp.status(v_id)
    || ' ' || pg_temp.answered_by(v_id),
    'accepted 964|Uchi-mata|Annas Notiz accepted 41000000-0000-4000-8000-000000000003');
  PERFORM pg_temp.eq('A3 answering again changes nothing',
    pg_temp.as_user('41000000-0000-4000-8000-000000000003', format('SELECT public.training_plan_request_answer(%s, false)', v_id))
    || ' ' || pg_temp.status(v_id),
    'accepted accepted');
  PERFORM pg_temp.eq('A4 Anna no longer leads the date, so she cannot ask again',
    pg_temp.as_user('41000000-0000-4000-8000-000000000001',
      $q$SELECT public.training_plan_request_create('substitute', 961, '2031-01-06', 963)$q$),
    '42501 NOT_YOUR_DATE');
END $$;
ROLLBACK TO SAVEPOINT s;

SAVEPOINT s;
DO $$
DECLARE
  v_id bigint;
BEGIN
  v_id := pg_temp.as_user('41000000-0000-4000-8000-000000000001',
            $q$SELECT public.training_plan_request_create('substitute', 961, '2031-01-13', 963)$q$)::bigint;
  PERFORM pg_temp.eq('A5 declining changes nothing in the plan',
    pg_temp.as_user('41000000-0000-4000-8000-000000000002', format('SELECT public.training_plan_request_answer(%s, false)', v_id))
    || ' ' || pg_temp.session(961, '2031-01-13'),
    'declined none');
  PERFORM pg_temp.ok('A6 after a decline the date can be asked again',
    pg_temp.as_user('41000000-0000-4000-8000-000000000001',
      $q$SELECT public.training_plan_request_create('substitute', 961, '2031-01-13', 964)$q$) ~ '^\d+$');
END $$;
ROLLBACK TO SAVEPOINT s;

SAVEPOINT s;
DO $$
DECLARE
  v_id bigint;
BEGIN
  v_id := pg_temp.as_user('41000000-0000-4000-8000-000000000001',
            $q$SELECT public.training_plan_request_create('substitute', 961, '2031-01-06', 964)$q$)::bigint;
  -- The TK plans Max for the date meanwhile
  UPDATE public.training_plan_sessions SET trainer_id = 963 WHERE training_id = 961 AND date = '2031-01-06';
  PERFORM pg_temp.eq('A7 the date changed meanwhile: the request expires, the plan stays',
    pg_temp.as_user('41000000-0000-4000-8000-000000000003', format('SELECT public.training_plan_request_answer(%s, true)', v_id))
    || ' ' || pg_temp.session(961, '2031-01-06') || ' ' || pg_temp.status(v_id),
    'expired 963|Uchi-mata|Annas Notiz expired');
END $$;
ROLLBACK TO SAVEPOINT s;

SAVEPOINT s;
DO $$
DECLARE
  v_id bigint;
BEGIN
  v_id := pg_temp.as_user('41000000-0000-4000-8000-000000000001',
            $q$SELECT public.training_plan_request_create('substitute', 961, '2031-01-06', 964)$q$)::bigint;
  UPDATE public.training_plan_sessions SET cancelled = true WHERE training_id = 961 AND date = '2031-01-06';
  PERFORM pg_temp.ok('A8 a stale open request does not block a new one, it expires',
    pg_temp.as_user('41000000-0000-4000-8000-000000000001',
      $q$SELECT public.training_plan_request_create('substitute', 961, '2031-01-13', 964)$q$) ~ '^\d+$'
    AND pg_temp.status(v_id) = 'expired');
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- W Swapping
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_id bigint;
BEGIN
  -- Anna's note goes along with her, Max's stays with his date
  v_id := pg_temp.as_user('41000000-0000-4000-8000-000000000001',
            $q$SELECT public.training_plan_request_create('swap', 961, '2031-01-06', 963, 962, '2031-01-08',
                                                          NULL, true, false)$q$)::bigint;
  PERFORM pg_temp.eq('W1 the other date is taken too',
    pg_temp.as_user('41000000-0000-4000-8000-000000000002',
      $q$SELECT public.training_plan_request_create('substitute', 962, '2031-01-08', 964)$q$),
    'P0001 BUSY');
  PERFORM pg_temp.eq('W2 Max confirms: trainers swap, each takes the topic along, notes as asked',
    pg_temp.as_user('41000000-0000-4000-8000-000000000002', format('SELECT public.training_plan_request_answer(%s, true)', v_id))
    || ' ' || pg_temp.session(961, '2031-01-06') || ' ' || pg_temp.session(962, '2031-01-08'),
    'accepted 963|Kansetsu|- 962|Uchi-mata|Max Notiz · Annas Notiz');
END $$;
ROLLBACK TO SAVEPOINT s;

SAVEPOINT s;
DO $$
DECLARE
  v_id bigint;
BEGIN
  -- Monday 13 has no session (Anna leads as main trainer), Max's note goes along
  v_id := pg_temp.as_user('41000000-0000-4000-8000-000000000001',
            $q$SELECT public.training_plan_request_create('swap', 961, '2031-01-13', 963, 962, '2031-01-08',
                                                          NULL, true, true)$q$)::bigint;
  PERFORM pg_temp.eq('W3 a date without a session: written for both',
    pg_temp.as_user('41000000-0000-4000-8000-000000000002', format('SELECT public.training_plan_request_answer(%s, true)', v_id))
    || ' ' || pg_temp.session(961, '2031-01-13') || ' ' || pg_temp.session(962, '2031-01-08'),
    'accepted 963|Kansetsu|Max Notiz 962|-|-');
END $$;
ROLLBACK TO SAVEPOINT s;

SAVEPOINT s;
DO $$
DECLARE
  v_id bigint;
BEGIN
  v_id := pg_temp.as_user('41000000-0000-4000-8000-000000000001',
            $q$SELECT public.training_plan_request_create('swap', 961, '2031-01-06', 963, 962, '2031-01-08')$q$)::bigint;
  -- Max's date is cancelled meanwhile
  UPDATE public.training_plan_sessions SET cancelled = true WHERE training_id = 962 AND date = '2031-01-08';
  PERFORM pg_temp.eq('W4 the other date changed: the swap expires, nothing moves',
    pg_temp.as_user('41000000-0000-4000-8000-000000000002', format('SELECT public.training_plan_request_answer(%s, true)', v_id))
    || ' ' || pg_temp.session(961, '2031-01-06') || ' ' || pg_temp.session(962, '2031-01-08'),
    'expired -|Uchi-mata|Annas Notiz 963|Kansetsu|Max Notiz');
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- X Withdrawing, E the mail data
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_id bigint;
  v_mail jsonb;
BEGIN
  v_id := pg_temp.as_user('41000000-0000-4000-8000-000000000001',
            $q$SELECT public.training_plan_request_create('swap', 961, '2031-01-06', 963, 962, '2031-01-08', 'Passt dir das?')$q$)::bigint;

  v_mail := pg_temp.as_user('41000000-0000-4000-8000-000000000001', format('SELECT public.training_plan_request_mail(%s)', v_id))::jsonb;
  PERFORM pg_temp.eq('E1 the mail data: both people with their address, both dates',
    concat_ws(' | ', v_mail->>'kind', v_mail->>'message',
              v_mail->'from'->>'name', v_mail->'from'->>'email', v_mail->'from'->>'optout',
              v_mail->'to'->>'name', v_mail->'to'->>'email',
              v_mail->'date'->>'title', v_mail->'date'->>'date', v_mail->'date'->>'topic',
              v_mail->'other_date'->>'title', v_mail->'other_date'->>'date', v_mail->'other_date'->>'topic'),
    'swap | Passt dir das? | Anna Anfrage | anna.konto@test.ch | false | Max Muster | max.konto@test.ch'
    || ' | Tausch Montag | 2031-01-06 | Uchi-mata | Tausch Mittwoch | 2031-01-08 | Kansetsu');
  PERFORM pg_temp.eq('E2 for the person asked and the TK too, nobody else',
    (pg_temp.as_user('41000000-0000-4000-8000-000000000002', format('SELECT public.training_plan_request_mail(%s)->>''id''', v_id)) = v_id::text)
    || ' ' || (pg_temp.as_user('41000000-0000-4000-8000-000000000005', format('SELECT public.training_plan_request_mail(%s)->>''id''', v_id)) = v_id::text)
    || ' ' || pg_temp.as_user('41000000-0000-4000-8000-000000000003', format('SELECT public.training_plan_request_mail(%s)', v_id))
    || '/' || pg_temp.as_user('41000000-0000-4000-8000-000000000004', format('SELECT public.training_plan_request_mail(%s)', v_id)),
    'true true /');

  PERFORM pg_temp.eq('X1 the person asked cannot withdraw',
    pg_temp.as_user('41000000-0000-4000-8000-000000000002', format('SELECT public.training_plan_request_withdraw(%s)', v_id)),
    '42501 NOT_ALLOWED');
  PERFORM pg_temp.eq('X2 the asker withdraws, then it cannot be accepted',
    pg_temp.as_user('41000000-0000-4000-8000-000000000001', format('SELECT public.training_plan_request_withdraw(%s)', v_id))
    || ' ' || pg_temp.as_user('41000000-0000-4000-8000-000000000002', format('SELECT public.training_plan_request_answer(%s, true)', v_id))
    || ' ' || pg_temp.session(961, '2031-01-06'),
    'withdrawn withdrawn -|Uchi-mata|Annas Notiz');

  v_id := pg_temp.as_user('41000000-0000-4000-8000-000000000001',
            $q$SELECT public.training_plan_request_create('substitute', 961, '2031-01-06', 964)$q$)::bigint;
  PERFORM pg_temp.eq('X3 the TK withdraws too',
    pg_temp.as_user('41000000-0000-4000-8000-000000000005', format('SELECT public.training_plan_request_withdraw(%s)', v_id)),
    'withdrawn');
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- M Merge, D Deleting
-----------------

SELECT pg_temp.eq('M1 the two references are in the merge''s reviewed list',
  (SELECT string_agg(ref || ' ' || kind, ', ' ORDER BY ref) FROM public.merge_member_references()
    WHERE ref LIKE 'training_plan_requests.%'),
  'training_plan_requests.from_member_id fk, training_plan_requests.to_member_id fk');

SAVEPOINT s;
DO $$
DECLARE
  v_id bigint;
BEGIN
  v_id := pg_temp.as_user('41000000-0000-4000-8000-000000000001',
            $q$SELECT public.training_plan_request_create('substitute', 961, '2031-01-06', 965)$q$)::bigint;
  PERFORM pg_temp.ok('M2 an admin merges Lea into Anna',
    pg_temp.as_user('41000000-0000-4000-8000-000000000006', 'SELECT public.merge_members(962, 965)::text') LIKE '{%');
  PERFORM pg_temp.eq('M3 a request between the merged members is withdrawn',
    (SELECT concat_ws('|', from_member_id, to_member_id, status) FROM public.training_plan_requests WHERE id = v_id),
    '962|962|withdrawn');
END $$;
ROLLBACK TO SAVEPOINT s;

SAVEPOINT s;
DO $$
BEGIN
  PERFORM pg_temp.as_user('41000000-0000-4000-8000-000000000001',
    $q$SELECT public.training_plan_request_create('substitute', 961, '2031-01-06', 965)$q$);
  PERFORM pg_temp.as_user('41000000-0000-4000-8000-000000000002',
    $q$SELECT public.training_plan_request_create('substitute', 962, '2031-01-08', 964)$q$);
  DELETE FROM public.members WHERE id = 965;
  DELETE FROM public.trainings WHERE id = 962;
  PERFORM pg_temp.eq('D1 deleting a member or a training removes its requests',
    (SELECT count(*)::text FROM public.training_plan_requests), '0');
END $$;
ROLLBACK TO SAVEPOINT s;

ROLLBACK;

\o
\echo 'training_plan_requests: all checks passed'
