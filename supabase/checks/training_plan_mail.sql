-- Checks for the trainer mails about the training plan
-- (20261109120000_training_plan_mails.sql, docs/TRAINING_PLAN.md).
--
-- Runs like member_access.sql: on a database with every migration and the
-- seed, as postgres, inside one transaction that is rolled back; each
-- scenario sits in a savepoint. A failed check raises and stops:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/checks/training_plan_mail.sql
--
--   S  schema and privileges: row level security, table and column
--      privileges, the policies, the functions, the foreign keys
--   R  reading: staff read what was told and the opt-outs; the mail log only
--      the TK and whoever wrote the row
--   W  what was told, written directly: the TK for every training, a main
--      trainer for their own planned trainings, nobody else
--   O  opt-outs: only the TK
--   L  the mail log: planners insert their own pending or marked rows and
--      only finish their own pending ones; nobody deletes
--   A  training_plan_mail_addresses(): the linked approved account's
--      address, else the member's (a *.invalid one on the member wins),
--      for planners and involved members only
--   T  training_plan_set_told(): replaces the told state per member and
--      training in one transaction, under row level security
--   M  merge: the three references are in the reviewed list (the merge
--      itself: merge_members.sql)
--   D  deleting a member removes its rows; deleting a training keeps them

\set ON_ERROR_STOP 1
\o /dev/null
SET client_min_messages = notice;

BEGIN;

-----------------
-- Helpers (as in training_plan.sql)
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

-- How many rows a statement wrote, as text (RLS hides the rows it may not
-- touch, so a refused UPDATE or DELETE writes 0)
CREATE FUNCTION pg_temp.n(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_n bigint;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n::text;
END $$;

-- Sign up through Supabase Auth (fires handle_auth_user_change), then set
-- the profile as an admin would
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

-- Act as this account until RESET ROLE (or the savepoint is rolled back)
CREATE FUNCTION pg_temp.act_as(p_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
END $$;

-- Act as the anon key without a session
CREATE FUNCTION pg_temp.as_anon() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role": "anon"}', true);
  SET LOCAL ROLE anon;
END $$;

-- Everything that was told, as postgres reads it, to prove a refused write
-- changed nothing
CREATE FUNCTION pg_temp.told() RETURNS text
LANGUAGE sql AS $$
  SELECT md5(coalesce((SELECT string_agg(concat_ws('|', member_id, training_id, is_main, title, weekday,
                                                   time_from, time_to, told_at, told_by),
                                         ',' ORDER BY member_id, training_id)
                       FROM public.training_plan_told_trainings), '')
             || coalesce((SELECT string_agg(concat_ws('|', member_id, training_id, date, state),
                                            ',' ORDER BY member_id, training_id, date)
                          FROM public.training_plan_told), ''));
$$;

-- Today in Zurich, as the functions compare dates
CREATE FUNCTION pg_temp.today() RETURNS text
LANGUAGE sql AS $$
  SELECT to_char((now() AT TIME ZONE 'Europe/Zurich')::date, 'YYYY-MM-DD');
$$;

-- What this account reads: a query returning one text value
CREATE FUNCTION pg_temp.read_as(p_id uuid, p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  PERFORM pg_temp.act_as(p_id);
  EXECUTE p_sql INTO v;
  RESET ROLE;
  RETURN v;
END $$;

-- training_plan_mail_addresses() as this account: 'id|email|source, ...',
-- '-' for null, '' for no rows
CREATE FUNCTION pg_temp.addresses(p_id uuid,
                                  p_ids integer[] DEFAULT ARRAY[972, 973, 974, 975, 976, 977, 978, 979, 1])
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  PERFORM pg_temp.act_as(p_id);
  v := coalesce((SELECT string_agg(a.member_id || '|' || coalesce(a.email, '-') || '|' || coalesce(a.source, '-'),
                                   ', ' ORDER BY a.member_id)
                 FROM public.training_plan_mail_addresses(p_ids) a), '');
  RESET ROLE;
  RETURN v;
END $$;

-- The told state of one member as postgres reads it:
-- 'training:is_main:date state,date state ...' per training, '-' without dates
CREATE FUNCTION pg_temp.told_of(p_member integer) RETURNS text
LANGUAGE sql AS $$
  SELECT coalesce(string_agg(tt.training_id || ':' || tt.is_main || ':'
                             || coalesce((SELECT string_agg(t.date || ' ' || t.state, ',' ORDER BY t.date)
                                            FROM public.training_plan_told t
                                           WHERE t.member_id = tt.member_id AND t.training_id = tt.training_id), '-'),
                             ' ' ORDER BY tt.training_id), '')
  FROM public.training_plan_told_trainings tt WHERE tt.member_id = p_member;
$$;

-- Policy expressions as pg_policies shows them, without the blank Postgres
-- puts after an opening bracket, on one line
CREATE FUNCTION pg_temp.expr(p_expr text) RETURNS text
LANGUAGE sql AS $$ SELECT regexp_replace(regexp_replace(p_expr, '\(\s+', '(', 'g'), '\s+', ' ', 'g') $$;

-----------------
-- Test data (ids below 1'000 the seed does not use)
-----------------

-- Members: the main trainer of Monday, a substitute (address with blanks
-- and capitals), one without address told earlier, one whose account
-- waits, the main trainer of Wednesday, the viewer's, the member account's,
-- one told about a training no longer planned
INSERT INTO public.members (id, firstname, lastname, labels, email) VALUES
  (972, 'Hanna', 'Haupt', '[]', 'familie.haupt@test.ch'),
  (973, 'Sami', 'Sub', '[]', ' Sami.Sub@Test.CH '),
  (974, 'Nora', 'Nomail', '[]', NULL),
  (975, 'Pia', 'Pending', '[]', 'pia@test.ch'),
  (976, 'Otto', 'Other', '[]', 'otto@test.ch'),
  (977, 'Vera', 'Viewer', '[]', NULL),
  (978, 'Mia', 'Mitglied', '[]', 'mail.mitglied@test.ch'),
  (979, 'Gina', 'Gone', '[]', NULL);

-- Trainings: two planned ones, one without main trainer outside the plan
INSERT INTO public.trainings (id, title, weekday, "dateFrom", "dateTo", section, "mainTrainerId") VALUES
  (971, 'Mail Montag', 'Monday', '19:00', '20:30', 'Judo', 972),
  (972, 'Mail Mittwoch', 'Wednesday', '19:00', '20:30', 'Judo', 976),
  (973, 'Mail Weg', 'Thursday', '18:00', '19:00', 'Judo', NULL);
INSERT INTO public.training_plan_trainings (training_id) VALUES (971), (972);

-- Sessions: a substitute, an open date, a past one, the waiting account's
-- member as substitute
INSERT INTO public.training_plan_sessions (training_id, date, trainer_id) VALUES
  (971, '2031-01-06', 973),
  (971, '2031-01-13', NULL),
  (971, '2020-01-06', 977),
  (972, '2031-01-08', 975);

-- What was told before: Nora about Monday (a date now and a past one),
-- Gina as main trainer of the training no longer planned
INSERT INTO public.training_plan_told_trainings (member_id, training_id, is_main, title, weekday, time_from, time_to) VALUES
  (974, 971, false, 'Mail Montag', 'Monday', '19:00', '20:30'),
  (979, 973, true, 'Mail Weg', 'Thursday', '18:00', '19:00');
INSERT INTO public.training_plan_told (member_id, training_id, date, state) VALUES
  (974, 971, '2031-01-13', 'lead'),
  (974, 971, '2020-02-03', 'lead'),
  (979, 973, '2031-01-09', 'cancelled');

-- Accounts: the TK (a viewer with the TK role), the main trainer of Monday
-- (sign-in address other than the member's), a viewer, a member account,
-- a trainer without a training of their own, a waiting trainer, an admin
SELECT pg_temp.sign_up('40000000-0000-4000-8000-000000000001', 'mail.tk@test.ch', 'approved', 'viewer', 'manager');
SELECT pg_temp.sign_up('40000000-0000-4000-8000-000000000002', 'mail.haupt@test.ch', 'approved', 'trainer', NULL, 972);
SELECT pg_temp.sign_up('40000000-0000-4000-8000-000000000003', 'mail.viewer@test.ch', 'approved', 'viewer', NULL, 977);
SELECT pg_temp.sign_up('40000000-0000-4000-8000-000000000004', 'mail.mitglied@test.ch', 'approved', 'member');
SELECT pg_temp.sign_up('40000000-0000-4000-8000-000000000005', 'mail.trainer@test.ch', 'approved', 'trainer');
SELECT pg_temp.sign_up('40000000-0000-4000-8000-000000000006', 'pia.konto@test.ch', 'pending', 'trainer', NULL, 975);
SELECT pg_temp.sign_up('40000000-0000-4000-8000-000000000007', 'mail.admin@test.ch', 'approved', 'admin');

SELECT pg_temp.ok('fixtures: the TK plans, the main trainer plans Monday, nobody else plans',
  pg_temp.read_as('40000000-0000-4000-8000-000000000001', 'SELECT public.is_exam_manager()::text') = 'true'
  AND pg_temp.read_as('40000000-0000-4000-8000-000000000002',
        'SELECT string_agg(x::text, '','') FROM public.my_main_training_ids() x') = '971'
  AND pg_temp.read_as('40000000-0000-4000-8000-000000000005',
        'SELECT count(*)::text FROM public.my_main_training_ids()') = '0'
  AND pg_temp.read_as('40000000-0000-4000-8000-000000000004',
        'SELECT (978 IN (SELECT public.my_member_ids()))::text') = 'true');

-----------------
-- S Schema and privileges
-----------------

SELECT pg_temp.ok('S1 row level security on all four tables',
  (SELECT bool_and(c.relrowsecurity) AND count(*) = 4 FROM pg_class c
    WHERE c.oid IN ('public.training_plan_told_trainings'::regclass, 'public.training_plan_told'::regclass,
                    'public.training_plan_mail_optouts'::regclass, 'public.training_plan_mails'::regclass)));
SELECT pg_temp.ok('S2 anon and PUBLIC: no privilege on the tables or their columns',
  NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a
              WHERE c.oid IN ('public.training_plan_told_trainings'::regclass, 'public.training_plan_told'::regclass,
                              'public.training_plan_mail_optouts'::regclass, 'public.training_plan_mails'::regclass)
                AND a.grantee IN (0, 'anon'::regrole))
  AND NOT EXISTS (SELECT 1 FROM pg_attribute t, aclexplode(t.attacl) a
                  WHERE t.attrelid IN ('public.training_plan_told_trainings'::regclass, 'public.training_plan_told'::regclass,
                                       'public.training_plan_mail_optouts'::regclass, 'public.training_plan_mails'::regclass)
                    AND a.grantee IN (0, 'anon'::regrole)));
SELECT pg_temp.eq('S3 authenticated: select, insert and delete on what was told and the opt-outs, nothing else',
  (SELECT string_agg(c.relname || ' ' || (SELECT string_agg(a.privilege_type, ',' ORDER BY a.privilege_type)
                                            FROM aclexplode(c.relacl) a WHERE a.grantee = 'authenticated'::regrole),
                     ' / ' ORDER BY c.relname)
     FROM pg_class c
    WHERE c.oid IN ('public.training_plan_told_trainings'::regclass, 'public.training_plan_told'::regclass,
                    'public.training_plan_mail_optouts'::regclass))
  || ' / columns: ' || coalesce((SELECT string_agg(t.attname, ',') FROM pg_attribute t, aclexplode(t.attacl) a
                                  WHERE t.attrelid IN ('public.training_plan_told_trainings'::regclass,
                                                       'public.training_plan_told'::regclass,
                                                       'public.training_plan_mail_optouts'::regclass)
                                    AND a.grantee = 'authenticated'::regrole), '-'),
  'training_plan_mail_optouts DELETE,INSERT,SELECT / training_plan_told DELETE,INSERT,SELECT'
  || ' / training_plan_told_trainings DELETE,INSERT,SELECT / columns: -');
SELECT pg_temp.eq('S4 authenticated on the mail log: select and insert, update only status, error and sent_at, no delete',
  (SELECT string_agg(a.privilege_type, ',' ORDER BY a.privilege_type)
     FROM aclexplode((SELECT relacl FROM pg_class WHERE oid = 'public.training_plan_mails'::regclass)) a
    WHERE a.grantee = 'authenticated'::regrole)
  || ' / ' || (SELECT string_agg(t.attname || ' ' || a.privilege_type, ',' ORDER BY t.attname)
                 FROM pg_attribute t, aclexplode(t.attacl) a
                WHERE t.attrelid = 'public.training_plan_mails'::regclass AND a.grantee = 'authenticated'::regrole),
  'INSERT,SELECT / error UPDATE,sent_at UPDATE,status UPDATE');
SELECT pg_temp.ok('S4 the service role reads and writes all four',
  (SELECT bool_and(has_table_privilege('service_role', t, p))
     FROM unnest(ARRAY['public.training_plan_told_trainings', 'public.training_plan_told',
                       'public.training_plan_mail_optouts', 'public.training_plan_mails']) t,
          unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p));
SELECT pg_temp.eq('S5 the policies',
  (SELECT string_agg(tablename || ' ' || cmd || ' ' || coalesce(pg_temp.expr(qual), '-') || ' '
                     || coalesce(pg_temp.expr(with_check), '-'), E'\n' ORDER BY tablename, cmd)
     FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('training_plan_told_trainings', 'training_plan_told',
                        'training_plan_mail_optouts', 'training_plan_mails')),
  'training_plan_mail_optouts DELETE (SELECT is_exam_manager() AS is_exam_manager) -'
  || E'\ntraining_plan_mail_optouts INSERT - (SELECT is_exam_manager() AS is_exam_manager)'
  || E'\ntraining_plan_mail_optouts SELECT (SELECT is_staff() AS is_staff) -'
  || E'\ntraining_plan_mails INSERT - ((created_by = (SELECT auth.uid() AS uid)) AND (status = ANY (ARRAY[''pending''::text, ''marked''::text])) AND ((SELECT is_exam_manager() AS is_exam_manager) OR (EXISTS (SELECT 1 FROM my_main_training_ids() my_main_training_ids(my_main_training_ids)))))'
  || E'\ntraining_plan_mails SELECT ((SELECT is_staff() AS is_staff) AND ((SELECT is_exam_manager() AS is_exam_manager) OR (created_by = (SELECT auth.uid() AS uid)))) -'
  || E'\ntraining_plan_mails UPDATE ((created_by = (SELECT auth.uid() AS uid)) AND (status = ''pending''::text)) ((created_by = (SELECT auth.uid() AS uid)) AND (status = ANY (ARRAY[''sent''::text, ''failed''::text, ''skipped''::text])))'
  || E'\ntraining_plan_told DELETE ((SELECT is_exam_manager() AS is_exam_manager) OR (training_id IN (SELECT my_main_training_ids() AS my_main_training_ids))) -'
  || E'\ntraining_plan_told INSERT - ((SELECT is_exam_manager() AS is_exam_manager) OR (training_id IN (SELECT my_main_training_ids() AS my_main_training_ids)))'
  || E'\ntraining_plan_told SELECT (SELECT is_staff() AS is_staff) -'
  || E'\ntraining_plan_told_trainings DELETE ((SELECT is_exam_manager() AS is_exam_manager) OR (training_id IN (SELECT my_main_training_ids() AS my_main_training_ids))) -'
  || E'\ntraining_plan_told_trainings INSERT - ((SELECT is_exam_manager() AS is_exam_manager) OR (training_id IN (SELECT my_main_training_ids() AS my_main_training_ids)))'
  || E'\ntraining_plan_told_trainings SELECT (SELECT is_staff() AS is_staff) -');
SELECT pg_temp.eq('S6 the address lookup: a stable SECURITY DEFINER function with a fixed search_path',
  (SELECT concat_ws(' ', p.prosecdef, p.provolatile, array_to_string(p.proconfig, ','),
                    has_function_privilege('authenticated', p.oid, 'EXECUTE'),
                    has_function_privilege('service_role', p.oid, 'EXECUTE'),
                    has_function_privilege('anon', p.oid, 'EXECUTE'),
                    EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
     FROM pg_proc p WHERE p.oid = 'public.training_plan_mail_addresses(integer[])'::regprocedure),
  't s search_path=public t t f f');
SELECT pg_temp.eq('S6 the told-state write: a volatile SECURITY INVOKER function with a fixed search_path',
  (SELECT concat_ws(' ', p.prosecdef, p.provolatile, array_to_string(p.proconfig, ','),
                    has_function_privilege('authenticated', p.oid, 'EXECUTE'),
                    has_function_privilege('service_role', p.oid, 'EXECUTE'),
                    has_function_privilege('anon', p.oid, 'EXECUTE'),
                    EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
     FROM pg_proc p WHERE p.oid = 'public.training_plan_set_told(jsonb)'::regprocedure),
  'f v search_path=public t t f f');
-- confdeltype / confupdtype: c cascade, n set null, a no action
SELECT pg_temp.eq('S7 the foreign keys: to members with cascade, the dates to their training row, none to trainings',
  (SELECT string_agg(concat_ws(' ', c.conrelid::regclass::text,
                               (SELECT string_agg(a.attname, ',' ORDER BY array_position(c.conkey, a.attnum))
                                  FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)),
                               c.confrelid::regclass::text, c.confdeltype::text || c.confupdtype::text),
                     ' / ' ORDER BY c.conrelid::regclass::text, c.conname)
     FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.conrelid IN ('public.training_plan_told_trainings'::regclass, 'public.training_plan_told'::regclass,
                         'public.training_plan_mail_optouts'::regclass, 'public.training_plan_mails'::regclass)),
  'training_plan_mail_optouts created_by auth.users na'
  || ' / training_plan_mail_optouts member_id members ca'
  || ' / training_plan_mails created_by auth.users na'
  || ' / training_plan_mails member_id members ca'
  || ' / training_plan_told member_id,training_id training_plan_told_trainings cc'
  || ' / training_plan_told_trainings member_id members ca'
  || ' / training_plan_told_trainings told_by auth.users na');

-----------------
-- R Reading
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_tk uuid := '40000000-0000-4000-8000-000000000001';
  v_main uuid := '40000000-0000-4000-8000-000000000002';
  v_viewer uuid := '40000000-0000-4000-8000-000000000003';
  v_member uuid := '40000000-0000-4000-8000-000000000004';
  v_trainer uuid := '40000000-0000-4000-8000-000000000005';
  v_pending uuid := '40000000-0000-4000-8000-000000000006';
  v_admin uuid := '40000000-0000-4000-8000-000000000007';
  v_staff uuid[] := ARRAY[v_tk, v_main, v_viewer, v_trainer, v_admin];
  v_staff_names text[] := ARRAY['TK (viewer)', 'main trainer', 'viewer', 'trainer without a training', 'admin'];
  v_told text := $q$SELECT (SELECT string_agg(member_id || ':' || training_id, ',' ORDER BY member_id, training_id)
                              FROM public.training_plan_told_trainings)
                           || ' ' || (SELECT string_agg(member_id || ':' || training_id || ':' || date, ',' ORDER BY member_id, training_id, date)
                                        FROM public.training_plan_told)$q$;
  v_counts text := $q$SELECT (SELECT count(*) FROM public.training_plan_told_trainings)
                             || ' ' || (SELECT count(*) FROM public.training_plan_told)
                             || ' ' || (SELECT count(*) FROM public.training_plan_mail_optouts)
                             || ' ' || (SELECT count(*) FROM public.training_plan_mails)$q$;
  v_logs text := $q$SELECT coalesce(string_agg(member_id || ' ' || status, ',' ORDER BY member_id), '')
                     FROM public.training_plan_mails$q$;
  i integer;
BEGIN
  INSERT INTO public.training_plan_mail_optouts (member_id) VALUES (976);
  INSERT INTO public.training_plan_mails (member_id, to_email, status, created_by) VALUES
    (973, 'Sami.Sub@Test.CH', 'sent', v_main),
    (976, 'otto@test.ch', 'failed', v_admin);

  FOR i IN 1 .. array_length(v_staff, 1) LOOP
    PERFORM pg_temp.eq('R1 ' || v_staff_names[i] || ' reads what was told',
      pg_temp.read_as(v_staff[i], v_told), '974:971,979:973 974:971:2020-02-03,974:971:2031-01-13,979:973:2031-01-09');
    PERFORM pg_temp.eq('R3 ' || v_staff_names[i] || ' reads the opt-outs',
      pg_temp.read_as(v_staff[i], 'SELECT string_agg(member_id::text, '','') FROM public.training_plan_mail_optouts'), '976');
  END LOOP;
  PERFORM pg_temp.eq('R2 R3 a member account reads nothing',
    pg_temp.read_as(v_member, v_counts), '0 0 0 0');
  PERFORM pg_temp.eq('R2 R3 a waiting account reads nothing',
    pg_temp.read_as(v_pending, v_counts), '0 0 0 0');
  PERFORM pg_temp.as_anon();
  PERFORM pg_temp.eq('R2 R3 anon has no privilege',
    pg_temp.state('SELECT 1 FROM public.training_plan_told_trainings')
    || ' ' || pg_temp.state('SELECT 1 FROM public.training_plan_told')
    || ' ' || pg_temp.state('SELECT 1 FROM public.training_plan_mail_optouts')
    || ' ' || pg_temp.state('SELECT 1 FROM public.training_plan_mails'), '42501 42501 42501 42501');
  RESET ROLE;

  PERFORM pg_temp.eq('R4 the TK reads the whole log', pg_temp.read_as(v_tk, v_logs), '973 sent,976 failed');
  PERFORM pg_temp.eq('R4 the admin reads the whole log', pg_temp.read_as(v_admin, v_logs), '973 sent,976 failed');
  PERFORM pg_temp.eq('R4 the main trainer reads only their own rows', pg_temp.read_as(v_main, v_logs), '973 sent');
  PERFORM pg_temp.eq('R4 a viewer (staff) reads none', pg_temp.read_as(v_viewer, v_logs), '');
  PERFORM pg_temp.eq('R4 a trainer without a training reads none', pg_temp.read_as(v_trainer, v_logs), '');
  PERFORM pg_temp.eq('R4 a member account reads none', pg_temp.read_as(v_member, v_logs), '');
  -- A row someone wrote stays theirs, but only while they are staff
  UPDATE public.user_profiles SET role = 'member' WHERE user_id = v_main;
  PERFORM pg_temp.eq('R4 no longer staff: not even their own rows', pg_temp.read_as(v_main, v_logs), '');
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- W What was told, written directly
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_tk uuid := '40000000-0000-4000-8000-000000000001';
  v_main uuid := '40000000-0000-4000-8000-000000000002';
  v_viewer uuid := '40000000-0000-4000-8000-000000000003';
  v_member uuid := '40000000-0000-4000-8000-000000000004';
  v_trainer uuid := '40000000-0000-4000-8000-000000000005';
  v_pending uuid := '40000000-0000-4000-8000-000000000006';
  v_others uuid[] := ARRAY[v_viewer, v_trainer, v_member, v_pending];
  v_other_names text[] := ARRAY['viewer', 'trainer without a training', 'member account', 'waiting account'];
  v_before text;
  i integer;
BEGIN
  PERFORM pg_temp.act_as(v_tk);
  PERFORM pg_temp.eq('W1 the TK writes what was told for every training (planned or not)',
    pg_temp.n($q$INSERT INTO public.training_plan_told_trainings (member_id, training_id, is_main, title, weekday, time_from, time_to)
                VALUES (976, 971, false, 'Mail Montag', 'Monday', '19:00', '20:30'),
                       (976, 972, true, 'Mail Mittwoch', 'Wednesday', '19:00', '20:30'),
                       (976, 973, false, 'Mail Weg', 'Thursday', '18:00', '19:00')$q$)
    || pg_temp.n($q$INSERT INTO public.training_plan_told (member_id, training_id, date, state)
                   VALUES (976, 971, '2031-01-20', 'lead'), (976, 972, '2031-01-22', 'not_lead'),
                          (976, 973, '2031-01-23', 'lead')$q$), '33');
  RESET ROLE;
  PERFORM pg_temp.eq('W1 told_by is the TK',
    (SELECT string_agg(DISTINCT told_by::text, ',') FROM public.training_plan_told_trainings WHERE member_id = 976),
    v_tk::text);
  PERFORM pg_temp.act_as(v_tk);
  PERFORM pg_temp.eq('W1 and deletes it again',
    pg_temp.n('DELETE FROM public.training_plan_told WHERE member_id = 976')
    || pg_temp.n('DELETE FROM public.training_plan_told_trainings WHERE member_id = 976'), '33');
  RESET ROLE;

  -- Something told about Wednesday, which the main trainer of Monday does
  -- not plan
  INSERT INTO public.training_plan_told_trainings (member_id, training_id, is_main, title, weekday, time_from, time_to)
  VALUES (975, 972, false, 'Mail Mittwoch', 'Wednesday', '19:00', '20:30');
  INSERT INTO public.training_plan_told (member_id, training_id, date, state) VALUES (975, 972, '2031-01-08', 'lead');

  PERFORM pg_temp.act_as(v_main);
  PERFORM pg_temp.eq('W2 the main trainer writes what was told for their training',
    pg_temp.n($q$INSERT INTO public.training_plan_told_trainings (member_id, training_id, is_main, title, weekday, time_from, time_to)
                VALUES (973, 971, false, 'Mail Montag', 'Monday', '19:00', '20:30')$q$)
    || pg_temp.n($q$INSERT INTO public.training_plan_told (member_id, training_id, date, state)
                   VALUES (973, 971, '2031-01-06', 'lead')$q$), '11');
  RESET ROLE;
  PERFORM pg_temp.eq('W2 told_by is the main trainer',
    (SELECT told_by::text FROM public.training_plan_told_trainings WHERE member_id = 973), v_main::text);
  PERFORM pg_temp.act_as(v_main);
  PERFORM pg_temp.eq('W2 and deletes it again',
    pg_temp.n('DELETE FROM public.training_plan_told WHERE member_id = 973')
    || pg_temp.n('DELETE FROM public.training_plan_told_trainings WHERE member_id = 973'), '11');
  RESET ROLE;

  v_before := pg_temp.told();
  PERFORM pg_temp.act_as(v_main);
  PERFORM pg_temp.eq('W2 but not for another training: insert refused, delete writes nothing',
    pg_temp.state($q$INSERT INTO public.training_plan_told_trainings (member_id, training_id, is_main, title)
                    VALUES (973, 972, false, 'Mail Mittwoch')$q$)
    || ' ' || pg_temp.state($q$INSERT INTO public.training_plan_told (member_id, training_id, date, state)
                              VALUES (975, 972, '2031-01-15', 'lead')$q$)
    || ' ' || pg_temp.n('DELETE FROM public.training_plan_told WHERE training_id = 972')
    || ' ' || pg_temp.n('DELETE FROM public.training_plan_told_trainings WHERE training_id IN (972, 973)'),
    '42501 42501 0 0');
  RESET ROLE;
  PERFORM pg_temp.eq('W2 nothing changed', pg_temp.told(), v_before);

  FOR i IN 1 .. array_length(v_others, 1) LOOP
    PERFORM pg_temp.act_as(v_others[i]);
    PERFORM pg_temp.eq('W3 ' || v_other_names[i] || ': insert refused, delete writes nothing',
      pg_temp.state($q$INSERT INTO public.training_plan_told_trainings (member_id, training_id, is_main, title)
                      VALUES (973, 971, false, 'Mail Montag')$q$)
      || ' ' || pg_temp.state($q$INSERT INTO public.training_plan_told (member_id, training_id, date, state)
                                VALUES (974, 971, '2031-01-20', 'lead')$q$)
      || ' ' || pg_temp.n('DELETE FROM public.training_plan_told')
      || ' ' || pg_temp.n('DELETE FROM public.training_plan_told_trainings'),
      '42501 42501 0 0');
    RESET ROLE;
  END LOOP;
  PERFORM pg_temp.as_anon();
  PERFORM pg_temp.eq('W3 anon: no privilege',
    pg_temp.state($q$INSERT INTO public.training_plan_told_trainings (member_id, training_id, is_main, title)
                    VALUES (973, 971, false, 'Mail Montag')$q$)
    || ' ' || pg_temp.state('DELETE FROM public.training_plan_told')
    || ' ' || pg_temp.state('DELETE FROM public.training_plan_told_trainings'),
    '42501 42501 42501');
  RESET ROLE;
  PERFORM pg_temp.eq('W3 nothing changed', pg_temp.told(), v_before);

  PERFORM pg_temp.act_as(v_tk);
  PERFORM pg_temp.eq('W5 a date needs its training row; the state and the date format are checked',
    pg_temp.state($q$INSERT INTO public.training_plan_told (member_id, training_id, date, state)
                    VALUES (976, 971, '2031-01-20', 'lead')$q$)
    || ' ' || pg_temp.state($q$INSERT INTO public.training_plan_told (member_id, training_id, date, state)
                              VALUES (974, 971, '2031-01-20', 'maybe')$q$)
    || ' ' || pg_temp.state($q$INSERT INTO public.training_plan_told (member_id, training_id, date, state)
                              VALUES (974, 971, '2031-1-6', 'lead')$q$),
    '23503 23514 23514');
  PERFORM pg_temp.eq('W5 the TK cannot update (no privilege)',
    pg_temp.state($q$UPDATE public.training_plan_told SET state = 'cancelled' WHERE member_id = 974$q$)
    || ' ' || pg_temp.state($q$UPDATE public.training_plan_told_trainings SET is_main = true WHERE member_id = 974$q$),
    '42501 42501');
  RESET ROLE;

  UPDATE public.training_plan_told_trainings SET member_id = 976 WHERE member_id = 979;
  PERFORM pg_temp.eq('W6 a training row moved to another member takes its dates',
    (SELECT string_agg(member_id || ':' || training_id || ':' || date, ',' ORDER BY date)
       FROM public.training_plan_told WHERE member_id IN (976, 979)), '976:973:2031-01-09');
  DELETE FROM public.training_plan_told_trainings WHERE member_id = 974;
  PERFORM pg_temp.eq('W6 a deleted training row takes its dates',
    (SELECT count(*)::text FROM public.training_plan_told WHERE member_id = 974), '0');
END $$;
ROLLBACK TO SAVEPOINT s;

SAVEPOINT s;
DO $$
DECLARE
  v_main uuid := '40000000-0000-4000-8000-000000000002';
BEGIN
  DELETE FROM public.training_plan_trainings WHERE training_id = 971;
  PERFORM pg_temp.act_as(v_main);
  PERFORM pg_temp.eq('W4 the training out of the plan: its main trainer writes nothing more',
    pg_temp.state($q$INSERT INTO public.training_plan_told_trainings (member_id, training_id, is_main, title)
                    VALUES (973, 971, false, 'Mail Montag')$q$)
    || ' ' || pg_temp.n('DELETE FROM public.training_plan_told_trainings WHERE training_id = 971'),
    '42501 0');
  RESET ROLE;
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- O Opt-outs
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_tk uuid := '40000000-0000-4000-8000-000000000001';
  v_main uuid := '40000000-0000-4000-8000-000000000002';
  v_viewer uuid := '40000000-0000-4000-8000-000000000003';
  v_member uuid := '40000000-0000-4000-8000-000000000004';
  v_trainer uuid := '40000000-0000-4000-8000-000000000005';
  v_pending uuid := '40000000-0000-4000-8000-000000000006';
  v_others uuid[] := ARRAY[v_main, v_viewer, v_trainer, v_member, v_pending];
  v_other_names text[] := ARRAY['main trainer', 'viewer', 'trainer without a training', 'member account', 'waiting account'];
  i integer;
BEGIN
  INSERT INTO public.training_plan_mail_optouts (member_id) VALUES (976);
  PERFORM pg_temp.act_as(v_tk);
  PERFORM pg_temp.eq('O1 the TK sets and removes opt-outs',
    pg_temp.n('INSERT INTO public.training_plan_mail_optouts (member_id) VALUES (974)')
    || pg_temp.n('DELETE FROM public.training_plan_mail_optouts WHERE member_id = 976'), '11');
  RESET ROLE;
  PERFORM pg_temp.eq('O1 created_by is the TK',
    (SELECT created_by::text FROM public.training_plan_mail_optouts WHERE member_id = 974), v_tk::text);

  FOR i IN 1 .. array_length(v_others, 1) LOOP
    PERFORM pg_temp.act_as(v_others[i]);
    PERFORM pg_temp.eq('O2 ' || v_other_names[i] || ': insert refused, delete writes nothing',
      pg_temp.state('INSERT INTO public.training_plan_mail_optouts (member_id) VALUES (973)')
      || ' ' || pg_temp.n('DELETE FROM public.training_plan_mail_optouts'), '42501 0');
    RESET ROLE;
  END LOOP;
  PERFORM pg_temp.as_anon();
  PERFORM pg_temp.eq('O2 anon: no privilege',
    pg_temp.state('INSERT INTO public.training_plan_mail_optouts (member_id) VALUES (973)')
    || ' ' || pg_temp.state('DELETE FROM public.training_plan_mail_optouts'), '42501 42501');
  RESET ROLE;
  PERFORM pg_temp.eq('O2 nothing changed',
    (SELECT string_agg(member_id::text, ',') FROM public.training_plan_mail_optouts), '974');
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- L The mail log
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_tk uuid := '40000000-0000-4000-8000-000000000001';
  v_main uuid := '40000000-0000-4000-8000-000000000002';
  v_viewer uuid := '40000000-0000-4000-8000-000000000003';
  v_member uuid := '40000000-0000-4000-8000-000000000004';
  v_trainer uuid := '40000000-0000-4000-8000-000000000005';
  v_pending uuid := '40000000-0000-4000-8000-000000000006';
  v_admin uuid := '40000000-0000-4000-8000-000000000007';
  v_others uuid[] := ARRAY[v_viewer, v_trainer, v_member, v_pending];
  v_other_names text[] := ARRAY['viewer', 'trainer without a training', 'member account', 'waiting account'];
  v_own bigint;
  v_own2 bigint;
  v_marked bigint;
  v_admins bigint;
  i integer;
BEGIN
  PERFORM pg_temp.act_as(v_main);
  PERFORM pg_temp.eq('L1 the main trainer logs a pending mail and a marking',
    pg_temp.n($q$INSERT INTO public.training_plan_mails (member_id, to_email, subject, body, status)
                VALUES (973, 'Sami.Sub@Test.CH', 'Trainingsplan', 'Neu: du leitest', 'pending'),
                       (973, 'Sami.Sub@Test.CH', 'Trainingsplan', 'Zweite', 'pending')$q$)
    || pg_temp.n($q$INSERT INTO public.training_plan_mails (member_id, status) VALUES (974, 'marked')$q$), '21');
  PERFORM pg_temp.eq('L2 not in someone else''s name, not already sent',
    pg_temp.state(format($q$INSERT INTO public.training_plan_mails (member_id, status, created_by)
                            VALUES (973, 'pending', %L)$q$, v_admin))
    || ' ' || pg_temp.state($q$INSERT INTO public.training_plan_mails (member_id, status) VALUES (973, 'sent')$q$)
    || ' ' || pg_temp.state($q$INSERT INTO public.training_plan_mails (member_id, status) VALUES (973, 'skipped')$q$),
    '42501 42501 42501');
  RESET ROLE;
  PERFORM pg_temp.eq('L1 created_by is the main trainer',
    (SELECT string_agg(DISTINCT created_by::text, ',') FROM public.training_plan_mails), v_main::text);

  PERFORM pg_temp.act_as(v_tk);
  PERFORM pg_temp.eq('L1 the TK logs too',
    pg_temp.n($q$INSERT INTO public.training_plan_mails (member_id, status) VALUES (976, 'marked')$q$), '1');
  RESET ROLE;

  FOR i IN 1 .. array_length(v_others, 1) LOOP
    PERFORM pg_temp.act_as(v_others[i]);
    PERFORM pg_temp.eq('L3 ' || v_other_names[i] || ': insert refused',
      pg_temp.state($q$INSERT INTO public.training_plan_mails (member_id, status) VALUES (973, 'pending')$q$), '42501');
    RESET ROLE;
  END LOOP;
  PERFORM pg_temp.as_anon();
  PERFORM pg_temp.eq('L3 anon: no privilege',
    pg_temp.state($q$INSERT INTO public.training_plan_mails (member_id, status) VALUES (973, 'pending')$q$), '42501');
  RESET ROLE;

  SELECT min(id), max(id) INTO v_own, v_own2 FROM public.training_plan_mails
   WHERE created_by = v_main AND status = 'pending';
  SELECT id INTO v_marked FROM public.training_plan_mails WHERE created_by = v_main AND status = 'marked';
  INSERT INTO public.training_plan_mails (member_id, status, created_by) VALUES (976, 'pending', v_admin)
  RETURNING id INTO v_admins;

  PERFORM pg_temp.act_as(v_main);
  PERFORM pg_temp.eq('L4 the main trainer finishes their own pending row',
    pg_temp.n(format($q$UPDATE public.training_plan_mails SET status = 'sent', sent_at = now() WHERE id = %s$q$, v_own))
    || pg_temp.n(format($q$UPDATE public.training_plan_mails SET status = 'failed', error = 'SMTP 550' WHERE id = %s$q$, v_own2)),
    '11');
  PERFORM pg_temp.eq('L4 but not another account''s row, not a finished or marked one',
    pg_temp.n(format($q$UPDATE public.training_plan_mails SET status = 'sent' WHERE id = %s$q$, v_admins))
    || pg_temp.n(format($q$UPDATE public.training_plan_mails SET status = 'skipped' WHERE id = %s$q$, v_own))
    || pg_temp.n(format($q$UPDATE public.training_plan_mails SET status = 'sent' WHERE id = %s$q$, v_marked)),
    '000');
  PERFORM pg_temp.eq('L4 only status, error and sent_at',
    pg_temp.state(format($q$UPDATE public.training_plan_mails SET body = 'anders' WHERE id = %s$q$, v_own))
    || ' ' || pg_temp.state(format($q$UPDATE public.training_plan_mails SET member_id = 976 WHERE id = %s$q$, v_own)),
    '42501 42501');
  RESET ROLE;
  PERFORM pg_temp.eq('L4 what they wrote is there',
    (SELECT string_agg(status || ' ' || (sent_at IS NOT NULL) || ' ' || coalesce(error, '-'), ',' ORDER BY id)
       FROM public.training_plan_mails WHERE id IN (v_own, v_own2, v_marked, v_admins)),
    'sent true -,failed false SMTP 550,marked false -,pending false -');

  -- A pending row can only become sent, failed or skipped
  UPDATE public.training_plan_mails SET status = 'pending' WHERE id = v_own;
  PERFORM pg_temp.act_as(v_main);
  PERFORM pg_temp.eq('L4 a pending row does not become marked or pending again',
    pg_temp.state(format($q$UPDATE public.training_plan_mails SET status = 'marked' WHERE id = %s$q$, v_own))
    || ' ' || pg_temp.state(format($q$UPDATE public.training_plan_mails SET status = 'pending' WHERE id = %s$q$, v_own)),
    '42501 42501');
  PERFORM pg_temp.eq('L5 nobody deletes the log',
    pg_temp.state('DELETE FROM public.training_plan_mails'), '42501');
  RESET ROLE;
  PERFORM pg_temp.act_as(v_tk);
  PERFORM pg_temp.eq('L5 not even the TK',
    pg_temp.state('DELETE FROM public.training_plan_mails'), '42501');
  RESET ROLE;
  PERFORM pg_temp.act_as(v_admin);
  PERFORM pg_temp.eq('L5 not even an admin',
    pg_temp.state('DELETE FROM public.training_plan_mails'), '42501');
  RESET ROLE;
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- A training_plan_mail_addresses()
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_tk uuid := '40000000-0000-4000-8000-000000000001';
  v_main uuid := '40000000-0000-4000-8000-000000000002';
  v_viewer uuid := '40000000-0000-4000-8000-000000000003';
  v_member uuid := '40000000-0000-4000-8000-000000000004';
  v_trainer uuid := '40000000-0000-4000-8000-000000000005';
  v_pending uuid := '40000000-0000-4000-8000-000000000006';
  v_admin uuid := '40000000-0000-4000-8000-000000000007';
  v_others uuid[] := ARRAY[v_viewer, v_trainer, v_member, v_pending];
  v_other_names text[] := ARRAY['viewer', 'trainer without a training', 'member account', 'waiting account'];
  v_all text := '972|mail.haupt@test.ch|account, 973|Sami.Sub@Test.CH|member, 974|-|-, '
                || '975|pia@test.ch|member, 976|otto@test.ch|member, 979|-|-';
  i integer;
BEGIN
  -- 972: the linked account's sign-in address; 973: the member's, trimmed;
  -- 974 and 979: involved through what they were told, no address; 975:
  -- the account waits, so the member's; 976: main trainer of Wednesday;
  -- 977 only trained on a past date; 978 and 1 are not involved
  PERFORM pg_temp.eq('A1 the TK: every involved member, the account''s address first', pg_temp.addresses(v_tk), v_all);
  PERFORM pg_temp.eq('A2 an admin: the same', pg_temp.addresses(v_admin), v_all);
  PERFORM pg_temp.eq('A3 the main trainer: only the members of their training',
    pg_temp.addresses(v_main), '972|mail.haupt@test.ch|account, 973|Sami.Sub@Test.CH|member, 974|-|-');
  FOR i IN 1 .. array_length(v_others, 1) LOOP
    PERFORM pg_temp.eq('A4 ' || v_other_names[i] || ': no rows', pg_temp.addresses(v_others[i]), '');
  END LOOP;
  PERFORM pg_temp.as_anon();
  PERFORM pg_temp.eq('A4 anon cannot call it',
    pg_temp.state('SELECT * FROM public.training_plan_mail_addresses(ARRAY[972])'), '42501');
  RESET ROLE;
  PERFORM pg_temp.eq('A4 nothing for an empty or missing list',
    pg_temp.addresses(v_tk, ARRAY[]::integer[]) || '/' || pg_temp.addresses(v_tk, NULL), '/');

  -- The address follows the account at once
  UPDATE public.user_profiles SET status = 'disabled' WHERE user_id = v_main;
  PERFORM pg_temp.eq('A5 the account disabled: the member''s address',
    pg_temp.addresses(v_tk, ARRAY[972]), '972|familie.haupt@test.ch|member');
  UPDATE public.user_profiles SET status = 'approved', member_id = NULL WHERE user_id = v_main;
  PERFORM pg_temp.eq('A5 the account unlinked: the member''s address',
    pg_temp.addresses(v_tk, ARRAY[972]), '972|familie.haupt@test.ch|member');
  -- Involvement follows the plan: a substitute from today on counts, a
  -- session moved into the past does not
  UPDATE public.training_plan_sessions SET date = '2020-01-13' WHERE training_id = 971 AND date = '2031-01-06';
  PERFORM pg_temp.eq('A5 a substitute only on a past date: not involved',
    pg_temp.addresses(v_tk, ARRAY[973]), '');
  INSERT INTO public.training_plan_sessions (training_id, date, trainer_id) VALUES (971, pg_temp.today(), 973);
  PERFORM pg_temp.eq('A5 a substitute today: involved',
    pg_temp.addresses(v_tk, ARRAY[973]), '973|Sami.Sub@Test.CH|member');

  -- A test address on the member wins over the linked account's sign-in
  -- address: outside production the Webling sync anonymizes every member,
  -- and an account linked to one must not be mailed through it
  UPDATE public.user_profiles SET member_id = 972 WHERE user_id = v_main;
  PERFORM pg_temp.eq('A6 linked again: the account''s address',
    pg_temp.addresses(v_tk, ARRAY[972]), '972|mail.haupt@test.ch|account');
  UPDATE public.members SET email = ' member-972@Example.INVALID ' WHERE id = 972;
  PERFORM pg_temp.eq('A6 a test address on the member wins over the linked account',
    pg_temp.addresses(v_tk, ARRAY[972]), '972|member-972@Example.INVALID|member');
  PERFORM pg_temp.eq('A6 the main trainer gets the same',
    pg_temp.addresses(v_main, ARRAY[972]), '972|member-972@Example.INVALID|member');
  UPDATE public.members SET email = 'hanna@invalid.ch' WHERE id = 972;
  PERFORM pg_temp.eq('A6 only an address ending in .invalid is a test address',
    pg_temp.addresses(v_tk, ARRAY[972]), '972|mail.haupt@test.ch|account');
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- T training_plan_set_told()
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_tk uuid := '40000000-0000-4000-8000-000000000001';
  v_main uuid := '40000000-0000-4000-8000-000000000002';
  v_mon text := '{"training_id": 971, "is_main": false, "title": "Mail Montag", "weekday": "Monday", "time_from": "19:00", "time_to": "20:30"}';
  v_wed text := '{"training_id": 972, "is_main": true, "title": "Mail Mittwoch", "weekday": "Wednesday", "time_from": "19:00", "time_to": "20:30"}';
  v_before text;
  v text;
BEGIN
  PERFORM pg_temp.act_as(v_tk);
  v := public.training_plan_set_told(format(
         '[{"member_id": 973, "training_ids": [971, 972], "trainings": [%s],
            "dates": [{"training_id": 971, "date": "2031-01-06", "state": "lead"},
                      {"training_id": 971, "date": "2020-01-06", "state": "lead"}]}]', v_mon)::jsonb)::text;
  RESET ROLE;
  PERFORM pg_temp.eq('T1 the TK writes a substitute: one member',
    v || ' ' || pg_temp.told_of(973), '1 971:false:2031-01-06 lead');
  PERFORM pg_temp.eq('T1 the row as written, told_by the TK',
    (SELECT concat_ws('|', title, weekday, time_from, time_to, told_by, told_at = now())
       FROM public.training_plan_told_trainings WHERE member_id = 973),
    'Mail Montag|Monday|19:00|20:30|' || v_tk || '|t');

  PERFORM pg_temp.act_as(v_tk);
  v := public.training_plan_set_told('[{"member_id": 974, "training_ids": [972]}]')::text;
  RESET ROLE;
  PERFORM pg_temp.eq('T2 another training only: the member''s past dates are gone, the rest stays',
    v || ' ' || pg_temp.told_of(974), '1 971:false:2031-01-13 lead');

  PERFORM pg_temp.act_as(v_tk);
  v := public.training_plan_set_told('[{"member_id": 974, "training_ids": [971], "trainings": []}]')::text;
  RESET ROLE;
  PERFORM pg_temp.eq('T3 no longer involved: everything about the training is gone',
    v || ' ' || pg_temp.told_of(974)
    || ' ' || (SELECT count(*) FROM public.training_plan_told WHERE member_id = 974), '1  0');

  PERFORM pg_temp.act_as(v_main);
  v := public.training_plan_set_told(format(
         '[{"member_id": 973, "training_ids": [971], "trainings": [%s],
            "dates": [{"training_id": 971, "date": "2031-01-13", "state": "cancelled"}]}]', v_mon)::jsonb)::text;
  RESET ROLE;
  PERFORM pg_temp.eq('T4 the main trainer writes for their training',
    v || ' ' || pg_temp.told_of(973)
    || ' ' || (SELECT told_by::text FROM public.training_plan_told_trainings WHERE member_id = 973),
    '1 971:false:2031-01-13 cancelled ' || v_main);

  v_before := pg_temp.told();
  PERFORM pg_temp.act_as(v_main);
  PERFORM pg_temp.eq('T5 the main trainer with another training: refused',
    pg_temp.state(format(
      $q$SELECT public.training_plan_set_told('[{"member_id": 973, "training_ids": [971, 972], "trainings": [%s, %s]}]')$q$,
      v_mon, v_wed)), '42501');
  RESET ROLE;
  PERFORM pg_temp.eq('T5 nothing changed, not even for their own training', pg_temp.told(), v_before);

  PERFORM pg_temp.act_as(v_tk);
  PERFORM pg_temp.eq('T6 a training or date outside training_ids; a date without its training',
    pg_temp.state(format(
      $q$SELECT public.training_plan_set_told('[{"member_id": 973, "training_ids": [971], "trainings": [%s, %s]}]')$q$,
      v_mon, v_wed))
    || ' ' || pg_temp.state(format(
      $q$SELECT public.training_plan_set_told('[{"member_id": 973, "training_ids": [971], "trainings": [%s],
           "dates": [{"training_id": 972, "date": "2031-01-08", "state": "lead"}]}]')$q$, v_mon))
    || ' ' || pg_temp.state(
      $q$SELECT public.training_plan_set_told('[{"member_id": 973, "training_ids": [971], "trainings": [],
           "dates": [{"training_id": 971, "date": "2031-01-06", "state": "lead"}]}]')$q$),
    '22023 22023 23503');
  PERFORM pg_temp.eq('T7 bad payloads',
    pg_temp.state('SELECT public.training_plan_set_told(NULL)')
    || ' ' || pg_temp.state($q$SELECT public.training_plan_set_told('{}')$q$)
    || ' ' || pg_temp.state($q$SELECT public.training_plan_set_told('[{"training_ids": []}]')$q$)
    || ' ' || pg_temp.state($q$SELECT public.training_plan_set_told('[{"member_id": "x", "training_ids": []}]')$q$)
    || ' ' || pg_temp.state($q$SELECT public.training_plan_set_told('[{"member_id": 973}]')$q$)
    || ' ' || pg_temp.state($q$SELECT public.training_plan_set_told('[973]')$q$),
    '22023 22023 22023 22023 22023 22023');
  RESET ROLE;
  PERFORM pg_temp.eq('T6 T7 nothing changed', pg_temp.told(), v_before);
END $$;
ROLLBACK TO SAVEPOINT s;

SAVEPOINT s;
DO $$
DECLARE
  v_tk uuid := '40000000-0000-4000-8000-000000000001';
  v_main uuid := '40000000-0000-4000-8000-000000000002';
  v_viewer uuid := '40000000-0000-4000-8000-000000000003';
  v_member uuid := '40000000-0000-4000-8000-000000000004';
  v_trainer uuid := '40000000-0000-4000-8000-000000000005';
  v_pending uuid := '40000000-0000-4000-8000-000000000006';
  v_others uuid[] := ARRAY[v_viewer, v_trainer, v_member, v_pending];
  v_other_names text[] := ARRAY['viewer', 'trainer without a training', 'member account', 'waiting account'];
  v_mon text := '{"training_id": 971, "is_main": false, "title": "Mail Montag", "weekday": "Monday", "time_from": "19:00", "time_to": "20:30"}';
  v_wed text := '{"training_id": 972, "is_main": true, "title": "Mail Mittwoch", "weekday": "Wednesday", "time_from": "19:00", "time_to": "20:30"}';
  v_gone text := '[{"member_id": 979, "training_ids": [973],
                    "trainings": [{"training_id": 973, "is_main": true, "title": "Mail Weg", "weekday": "Thursday",
                                   "time_from": "18:00", "time_to": "19:00"}],
                    "dates": [{"training_id": 973, "date": "2031-01-16", "state": "cancelled"}]}]';
  v_before text;
  v text;
  i integer;
BEGIN
  v_before := pg_temp.told();
  FOR i IN 1 .. array_length(v_others, 1) LOOP
    PERFORM pg_temp.act_as(v_others[i]);
    PERFORM pg_temp.eq('T8 ' || v_other_names[i] || ': refused',
      pg_temp.state(format($q$SELECT public.training_plan_set_told('[{"member_id": 973, "training_ids": [971], "trainings": [%s]}]')$q$, v_mon))
      || ' ' || pg_temp.state($q$SELECT public.training_plan_set_told('[]')$q$), '42501 42501');
    RESET ROLE;
  END LOOP;
  PERFORM pg_temp.as_anon();
  PERFORM pg_temp.eq('T8 anon cannot call it',
    pg_temp.state($q$SELECT public.training_plan_set_told('[]')$q$), '42501');
  RESET ROLE;
  PERFORM pg_temp.eq('T8 nothing changed', pg_temp.told(), v_before);

  PERFORM pg_temp.act_as(v_main);
  PERFORM pg_temp.eq('T9 the main trainer: not a training outside the plan',
    pg_temp.state(format('SELECT public.training_plan_set_told(%L)', v_gone)), '42501');
  RESET ROLE;
  PERFORM pg_temp.eq('T9 nothing changed', pg_temp.told(), v_before);
  PERFORM pg_temp.act_as(v_tk);
  v := public.training_plan_set_told(v_gone::jsonb)::text;
  RESET ROLE;
  PERFORM pg_temp.eq('T9 the TK: also a training no longer planned',
    v || ' ' || pg_temp.told_of(979), '1 973:true:2031-01-16 cancelled');

  PERFORM pg_temp.act_as(v_tk);
  v := public.training_plan_set_told(format(
         '[{"member_id": 973, "training_ids": [971], "trainings": [%s],
            "dates": [{"training_id": 971, "date": "2031-01-06", "state": "lead"}]},
           {"member_id": 976, "training_ids": [971, 972], "trainings": [%s],
            "dates": [{"training_id": 972, "date": "2031-01-08", "state": "not_lead"}]}]', v_mon, v_wed)::jsonb)::text;
  RESET ROLE;
  PERFORM pg_temp.eq('T10 two members in one call',
    v || ' ' || pg_temp.told_of(973) || ' / ' || pg_temp.told_of(976),
    '2 971:false:2031-01-06 lead / 972:true:2031-01-08 not_lead');
  PERFORM pg_temp.act_as(v_tk);
  PERFORM pg_temp.eq('T10 an empty list: nobody',
    (SELECT public.training_plan_set_told('[]')::text), '0');
  RESET ROLE;
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- M Merge
-----------------

SELECT pg_temp.eq('M1 the three references are in the merge''s reviewed list',
  (SELECT string_agg(ref || ' ' || kind, ', ' ORDER BY ref) FROM public.merge_member_references()
    WHERE ref IN ('training_plan_told_trainings.member_id', 'training_plan_mail_optouts.member_id',
                  'training_plan_mails.member_id')),
  'training_plan_mail_optouts.member_id fk, training_plan_mails.member_id fk, training_plan_told_trainings.member_id fk');

-----------------
-- D Deleting
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_tk uuid := '40000000-0000-4000-8000-000000000001';
BEGIN
  PERFORM pg_temp.act_as(v_tk);
  PERFORM public.training_plan_set_told(
    '[{"member_id": 973, "training_ids": [971],
       "trainings": [{"training_id": 971, "is_main": false, "title": "Mail Montag", "weekday": "Monday",
                      "time_from": "19:00", "time_to": "20:30"}],
       "dates": [{"training_id": 971, "date": "2031-01-06", "state": "lead"}]}]');
  INSERT INTO public.training_plan_mail_optouts (member_id) VALUES (973);
  INSERT INTO public.training_plan_mails (member_id, status) VALUES (973, 'marked');
  RESET ROLE;
  PERFORM pg_temp.eq('D1 before: told, opted out, logged',
    (SELECT count(*) FROM public.training_plan_told_trainings WHERE member_id = 973)
    || ' ' || (SELECT count(*) FROM public.training_plan_told WHERE member_id = 973)
    || ' ' || (SELECT count(*) FROM public.training_plan_mail_optouts WHERE member_id = 973)
    || ' ' || (SELECT count(*) FROM public.training_plan_mails WHERE member_id = 973), '1 1 1 1');
  DELETE FROM public.members WHERE id = 973;
  PERFORM pg_temp.eq('D1 a deleted member takes its rows along',
    (SELECT count(*) FROM public.training_plan_told_trainings WHERE member_id = 973)
    || ' ' || (SELECT count(*) FROM public.training_plan_told WHERE member_id = 973)
    || ' ' || (SELECT count(*) FROM public.training_plan_mail_optouts WHERE member_id = 973)
    || ' ' || (SELECT count(*) FROM public.training_plan_mails WHERE member_id = 973), '0 0 0 0');

  DELETE FROM public.trainings WHERE id = 973;
  PERFORM pg_temp.eq('D2 a deleted training: what was told stays (it says "no longer in the plan")',
    pg_temp.told_of(979)
    || ' ' || (SELECT title FROM public.training_plan_told_trainings WHERE member_id = 979),
    '973:true:2031-01-09 cancelled Mail Weg');
END $$;
ROLLBACK TO SAVEPOINT s;

ROLLBACK;

\o
\echo 'training_plan_mail: all checks passed'
