-- Checks for who writes the training plan
-- (20261025090000_training_plan.sql, 20261107120000_main_trainer_plans_own_training.sql,
-- docs/TRAINING_PLAN.md).
--
-- Runs like member_access.sql: on a database with every migration and the
-- seed, as postgres, inside one transaction that is rolled back; each
-- scenario sits in a savepoint. A failed check raises and stops:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/checks/training_plan.sql
--
--   M  my_main_training_ids(): the planned trainings whose main trainer is
--      one of the account's members (my_member_ids()), for trainers and
--      admins only; computed per call, never stored
--   T  the TK (is_exam_manager()) writes every session, the holidays and
--      which trainings are planned
--   H  a trainer plans every date of a planned training they are main trainer
--      of: insert, update, upsert, delete, trainer, topic, notes, cancelled
--   X  but nothing else: no session of another training, no moving a
--      session to another training, no holidays, not which trainings are
--      planned
--   N  nothing new for viewers (main trainer or not), waiting and disabled
--      accounts, member accounts, anon, and main trainers of a training
--      outside the plan
--   P  privileges and the policies themselves

\set ON_ERROR_STOP 1
\o /dev/null
SET client_min_messages = notice;

BEGIN;

-----------------
-- Helpers (as in member_access.sql and calendar_feeds.sql)
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

-- my_main_training_ids() as this account, sorted: '961,962', '' for none
CREATE FUNCTION pg_temp.mine(p_id uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  PERFORM pg_temp.act_as(p_id);
  v := coalesce((SELECT string_agg(x::text, ',' ORDER BY x) FROM public.my_main_training_ids() x), '');
  RESET ROLE;
  RETURN v;
END $$;

-- The same rule computed here on its own: planned trainings whose main
-- trainer is one of my_member_ids(), for trainers and admins
CREATE FUNCTION pg_temp.expected(p_id uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  PERFORM pg_temp.act_as(p_id);
  v := coalesce((SELECT string_agg(pt.training_id::text, ',' ORDER BY pt.training_id)
                 FROM public.training_plan_trainings pt
                 JOIN public.trainings t ON t.id = pt.training_id
                 WHERE public.is_writer() AND t."mainTrainerId" IN (SELECT public.my_member_ids())), '');
  RESET ROLE;
  RETURN v;
END $$;

-- One session as postgres reads it: 'trainer|topic|notes|cancelled', '-' for null
CREATE FUNCTION pg_temp.session(p_training integer, p_date text) RETURNS text
LANGUAGE sql AS $$
  SELECT concat_ws('|', coalesce(trainer_id::text, '-'), coalesce(topic, '-'),
                   coalesce(notes, '-'), coalesce(cancelled::text, '-'))
  FROM public.training_plan_sessions WHERE training_id = p_training AND date = p_date;
$$;

-- Everything about the plan as postgres reads it, to prove a refused write
-- changed nothing
CREATE FUNCTION pg_temp.plan() RETURNS text
LANGUAGE sql AS $$
  SELECT md5(coalesce((SELECT string_agg(concat_ws('|', training_id, date, trainer_id, topic, notes, cancelled),
                                          ',' ORDER BY training_id, date)
                       FROM public.training_plan_sessions), '')
             || coalesce((SELECT string_agg(concat_ws('|', title, date_from, date_to, cancels_training),
                                             ',' ORDER BY id)
                          FROM public.training_plan_breaks), '')
             || coalesce((SELECT string_agg(training_id::text, ',' ORDER BY training_id)
                          FROM public.training_plan_trainings), ''));
$$;

-----------------
-- Test data (ids below 1'000 the seed does not use)
-----------------

-- Members: the main trainer's linked record, their record found by e-mail,
-- a trial record with their address (does not count), the viewer's, one
-- outside the plan, the member account's, the admin's, a guest trainer and
-- the waiting account's
INSERT INTO public.members (id, firstname, lastname, labels, email) VALUES
  (961, 'Hanna', 'Haupt', '[]', NULL),
  (962, 'Hanna', 'Haupt-Mail', '[]', ' Plan.Haupt@Test.CH '),
  (963, 'Tina', 'Probe', '["probetraining"]', 'plan.haupt@test.ch'),
  (964, 'Vito', 'Viewer', '[]', NULL),
  (965, 'Otto', 'Ausserhalb', '[]', NULL),
  (966, 'Mia', 'Mitglied', '[]', 'plan.mitglied@test.ch'),
  (967, 'Ada', 'Admin', '[]', NULL),
  (968, 'Gina', 'Gast', '[]', NULL),
  (969, 'Wanda', 'Wartet', '[]', NULL);

-- Accounts: the TK, the main trainer, a viewer who is main trainer, a
-- member account whose member is main trainer, an admin who is main
-- trainer, a waiting trainer who is main trainer, a trainer who is main
-- trainer only outside the plan
SELECT pg_temp.sign_up('30000000-0000-4000-8000-000000000001', 'plan.tk@test.ch', 'approved', 'trainer', 'manager');
SELECT pg_temp.sign_up('30000000-0000-4000-8000-000000000002', 'plan.haupt@test.ch', 'approved', 'trainer', NULL, 961);
SELECT pg_temp.sign_up('30000000-0000-4000-8000-000000000003', 'plan.viewer@test.ch', 'approved', 'viewer', NULL, 964);
SELECT pg_temp.sign_up('30000000-0000-4000-8000-000000000004', 'plan.mitglied@test.ch', 'approved', 'member');
SELECT pg_temp.sign_up('30000000-0000-4000-8000-000000000005', 'plan.admin@test.ch', 'approved', 'admin', NULL, 967);
SELECT pg_temp.sign_up('30000000-0000-4000-8000-000000000006', 'plan.wartet@test.ch', 'pending', 'trainer', NULL, 969);
SELECT pg_temp.sign_up('30000000-0000-4000-8000-000000000007', 'plan.ausserhalb@test.ch', 'approved', 'trainer', NULL, 965);

-- Trainings: planned ones of each main trainer, two outside the plan
INSERT INTO public.trainings (id, title, weekday, "dateFrom", "dateTo", section, "mainTrainerId") VALUES
  (961, 'Plan Montag', 'Monday', '19:00', '20:30', 'Judo', 961),
  (962, 'Plan Mittwoch', 'Wednesday', '19:00', '20:30', 'Judo', 962),
  (963, 'Plan Freitag', 'Friday', '19:00', '20:30', 'Judo', 964),
  (964, 'Nicht im Plan', 'Thursday', '19:00', '20:30', 'Judo', 961),
  (965, 'Plan Dienstag', 'Tuesday', '19:00', '20:30', 'Judo', 963),
  (966, 'Plan Samstag', 'Saturday', '10:00', '11:30', 'Judo', 966),
  (967, 'Plan Sonntag', 'Sunday', '10:00', '11:30', 'Judo', 967),
  (968, 'Auch nicht im Plan', 'Thursday', '17:00', '18:00', 'Judo', 965),
  (969, 'Plan Sonntagabend', 'Sunday', '18:00', '19:30', 'Judo', 969);
INSERT INTO public.training_plan_trainings (training_id) VALUES (961), (962), (963), (965), (966), (967), (969);

-- Sessions the TK planned, and a closing holiday
INSERT INTO public.training_plan_sessions (training_id, date, trainer_id, topic, notes, cancelled) VALUES
  (961, '2031-01-06', 968, 'Uchi-mata', NULL, NULL),
  (961, '2031-01-13', NULL, 'Seoi-nage', NULL, NULL),
  (962, '2031-01-08', 962, 'Kata', NULL, NULL),
  (963, '2031-01-10', 964, 'Fremdes Thema', 'vom TK', NULL),
  (964, '2031-01-09', 961, 'Ausserhalb', NULL, NULL),
  (965, '2031-01-07', 963, 'Probe', NULL, NULL),
  (966, '2031-01-11', 966, 'Samstag', NULL, NULL);
INSERT INTO public.training_plan_breaks (title, date_from, date_to, cancels_training) VALUES
  ('zz Plan-Check Dojo zu', '2031-02-01', '2031-02-14', true);

-----------------
-- M my_main_training_ids()
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_tk uuid := '30000000-0000-4000-8000-000000000001';
  v_main uuid := '30000000-0000-4000-8000-000000000002';
  v_viewer uuid := '30000000-0000-4000-8000-000000000003';
  v_member uuid := '30000000-0000-4000-8000-000000000004';
  v_admin uuid := '30000000-0000-4000-8000-000000000005';
  v_waiting uuid := '30000000-0000-4000-8000-000000000006';
  v_outside uuid := '30000000-0000-4000-8000-000000000007';
  v_id uuid;
BEGIN
  PERFORM pg_temp.eq('M1 main trainer: the linked record''s and the one by e-mail, not the trial record''s, not outside the plan',
    pg_temp.mine(v_main), '961,962');
  PERFORM pg_temp.eq('M1 admin: the planned training of its member', pg_temp.mine(v_admin), '967');
  PERFORM pg_temp.eq('M1 TK without a member: none', pg_temp.mine(v_tk), '');
  PERFORM pg_temp.eq('M1 viewer who is main trainer: none', pg_temp.mine(v_viewer), '');
  PERFORM pg_temp.eq('M1 member account whose member is main trainer: none', pg_temp.mine(v_member), '');
  PERFORM pg_temp.eq('M1 waiting trainer who is main trainer: none', pg_temp.mine(v_waiting), '');
  PERFORM pg_temp.eq('M1 trainer who is main trainer only outside the plan: none', pg_temp.mine(v_outside), '');
  FOREACH v_id IN ARRAY ARRAY[v_tk, v_main, v_viewer, v_member, v_admin, v_waiting, v_outside] LOOP
    PERFORM pg_temp.eq('M2 the same as the rule computed from my_member_ids() for ' || v_id,
      pg_temp.mine(v_id), pg_temp.expected(v_id));
  END LOOP;
  PERFORM pg_temp.act_as(v_member);
  PERFORM pg_temp.ok('M2 the member account''s member counts (so its role is what refuses)',
    966 IN (SELECT public.my_member_ids()));
  RESET ROLE;

  -- Computed per call: it follows the plan, the main trainer, the member
  -- link, the e-mail and the role at once
  UPDATE public.trainings SET "mainTrainerId" = 968 WHERE id = 961;
  PERFORM pg_temp.eq('M3 another main trainer: that training is gone', pg_temp.mine(v_main), '962');
  UPDATE public.trainings SET "mainTrainerId" = 961 WHERE id = 961;
  DELETE FROM public.training_plan_trainings WHERE training_id = 962;
  PERFORM pg_temp.eq('M3 out of the plan: gone', pg_temp.mine(v_main), '961');
  INSERT INTO public.training_plan_trainings (training_id) VALUES (962), (964);
  PERFORM pg_temp.eq('M3 into the plan: there', pg_temp.mine(v_main), '961,962,964');
  DELETE FROM public.training_plan_trainings WHERE training_id = 964;
  UPDATE public.members SET labels = '[]' WHERE id = 963;
  PERFORM pg_temp.eq('M3 the trial record becomes a member: its training counts', pg_temp.mine(v_main), '961,962,965');
  UPDATE public.members SET labels = '["probetraining"]' WHERE id = 963;
  UPDATE public.members SET email = NULL WHERE id = 962;
  PERFORM pg_temp.eq('M3 no longer the account''s e-mail: gone', pg_temp.mine(v_main), '961');
  UPDATE public.members SET email = 'plan.haupt@test.ch' WHERE id = 962;
  UPDATE public.user_profiles SET member_id = NULL WHERE user_id = v_main;
  PERFORM pg_temp.eq('M3 unlinked: only the one by e-mail', pg_temp.mine(v_main), '962');
  UPDATE public.user_profiles SET member_id = 961 WHERE user_id = v_main;
  UPDATE public.user_profiles SET role = 'viewer' WHERE user_id = v_main;
  PERFORM pg_temp.eq('M3 the same member as viewer: none', pg_temp.mine(v_main), '');
  UPDATE public.user_profiles SET role = 'admin' WHERE user_id = v_main;
  PERFORM pg_temp.eq('M3 the same member as admin: both', pg_temp.mine(v_main), '961,962');
  UPDATE public.user_profiles SET role = 'trainer', status = 'disabled' WHERE user_id = v_main;
  PERFORM pg_temp.eq('M3 disabled: none', pg_temp.mine(v_main), '');
  UPDATE public.user_profiles SET status = 'approved' WHERE user_id = v_main;
  UPDATE public.user_profiles SET role = 'trainer' WHERE user_id = v_viewer;
  PERFORM pg_temp.eq('M3 the viewer made trainer: its training', pg_temp.mine(v_viewer), '963');

  PERFORM pg_temp.act_as('10000000-0000-4000-8000-0000000000ff');
  PERFORM pg_temp.eq('M4 an account without profile: none',
    (SELECT count(*)::text FROM public.my_main_training_ids()), '0');
  RESET ROLE;
  PERFORM pg_temp.as_anon();
  PERFORM pg_temp.eq('M4 anon cannot call it', pg_temp.state('SELECT public.my_main_training_ids()'), '42501');
  RESET ROLE;
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- T The TK
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_tk uuid := '30000000-0000-4000-8000-000000000001';
  v_viewer uuid := '30000000-0000-4000-8000-000000000003';
  v_admin uuid := '30000000-0000-4000-8000-000000000005';
BEGIN
  PERFORM pg_temp.act_as(v_tk);
  PERFORM pg_temp.eq('T1 TK inserts sessions of any training (in the plan or not)',
    pg_temp.n($q$INSERT INTO public.training_plan_sessions (training_id, date, trainer_id, topic, cancelled)
                VALUES (963, '2031-01-17', 968, 'Vom TK', NULL), (964, '2031-01-16', NULL, NULL, true),
                       (961, '2031-01-20', 961, 'Ashi-waza', NULL)$q$), '3');
  PERFORM pg_temp.eq('T1 TK updates any session',
    pg_temp.n($q$UPDATE public.training_plan_sessions SET topic = 'Geändert', cancelled = false
                WHERE training_id IN (961, 962, 963, 965, 966) AND date < '2031-01-14'$q$), '6');
  PERFORM pg_temp.eq('T1 TK upserts any session',
    pg_temp.n($q$INSERT INTO public.training_plan_sessions (training_id, date, trainer_id, topic)
                VALUES (965, '2031-01-07', 961, 'Upsert')
                ON CONFLICT (training_id, date) DO UPDATE
                SET trainer_id = EXCLUDED.trainer_id, topic = EXCLUDED.topic$q$), '1');
  PERFORM pg_temp.eq('T1 TK deletes any session',
    pg_temp.n($q$DELETE FROM public.training_plan_sessions WHERE training_id IN (963, 964)$q$), '4');
  PERFORM pg_temp.eq('T2 TK writes holidays',
    pg_temp.n($q$INSERT INTO public.training_plan_breaks (title, date_from, date_to) VALUES ('zz TK', '2031-03-01', '2031-03-01')$q$)
    || pg_temp.n($q$UPDATE public.training_plan_breaks SET cancels_training = false WHERE title LIKE 'zz %'$q$)
    || pg_temp.n($q$DELETE FROM public.training_plan_breaks WHERE title LIKE 'zz %'$q$), '122');
  PERFORM pg_temp.eq('T2 TK picks the planned trainings',
    pg_temp.n($q$INSERT INTO public.training_plan_trainings (training_id) VALUES (964)$q$)
    || pg_temp.n($q$DELETE FROM public.training_plan_trainings WHERE training_id IN (963, 964)$q$), '12');
  RESET ROLE;
  PERFORM pg_temp.eq('T3 what the TK wrote is there',
    pg_temp.session(965, '2031-01-07') || ' ' || pg_temp.session(961, '2031-01-06') || ' '
    || (SELECT count(*) FROM public.training_plan_sessions WHERE training_id IN (963, 964)),
    '961|Upsert|-|false 968|Geändert|-|false 0');

  -- A viewer with the TK role and an admin write too, sessions they are not
  -- main trainer of included
  UPDATE public.user_profiles SET exam_role = 'manager' WHERE user_id = v_viewer;
  PERFORM pg_temp.act_as(v_viewer);
  PERFORM pg_temp.eq('T4 a viewer who is TK writes sessions',
    pg_temp.n($q$INSERT INTO public.training_plan_sessions (training_id, date, topic) VALUES (961, '2031-01-27', 'Viewer-TK')$q$)
    || pg_temp.n($q$UPDATE public.training_plan_sessions SET notes = 'TK' WHERE training_id = 962$q$), '11');
  RESET ROLE;
  PERFORM pg_temp.act_as(v_admin);
  PERFORM pg_temp.eq('T4 an admin writes sessions of others'' trainings',
    pg_temp.n($q$INSERT INTO public.training_plan_sessions (training_id, date, topic) VALUES (962, '2031-01-15', 'Admin')$q$)
    || pg_temp.n($q$DELETE FROM public.training_plan_sessions WHERE training_id = 966$q$), '11');
  RESET ROLE;
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- H The main trainer plans their trainings
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_main uuid := '30000000-0000-4000-8000-000000000002';
BEGIN
  PERFORM pg_temp.act_as(v_main);
  PERFORM pg_temp.eq('H1 inserts a date: substitute, topic, note, cancelled',
    pg_temp.n($q$INSERT INTO public.training_plan_sessions (training_id, date, trainer_id, topic, notes, cancelled)
                VALUES (961, '2031-01-20', 968, 'Ashi-waza', 'Halle B', true)$q$), '1');
  PERFORM pg_temp.eq('H1 holds a date in a closing holiday',
    pg_temp.n($q$INSERT INTO public.training_plan_sessions (training_id, date, cancelled)
                VALUES (961, '2031-02-03', false)$q$), '1');
  PERFORM pg_temp.eq('H2 updates a date the TK planned: trainer, topic, note, takes place',
    pg_temp.n($q$UPDATE public.training_plan_sessions
                SET trainer_id = 961, topic = 'O-goshi', notes = 'selbst', cancelled = false
                WHERE training_id = 961 AND date = '2031-01-06'$q$), '1');
  PERFORM pg_temp.eq('H3 upserts an existing date (as the app saves a cell)',
    pg_temp.n($q$INSERT INTO public.training_plan_sessions (training_id, date, trainer_id, topic, notes, cancelled)
                VALUES (961, '2031-01-13', 968, 'Ne-waza', NULL, true)
                ON CONFLICT (training_id, date) DO UPDATE
                SET trainer_id = EXCLUDED.trainer_id, topic = EXCLUDED.topic,
                    notes = EXCLUDED.notes, cancelled = EXCLUDED.cancelled$q$), '1');
  PERFORM pg_temp.eq('H3 upserts new dates (as the rotation saves)',
    pg_temp.n($q$INSERT INTO public.training_plan_sessions (training_id, date, trainer_id, topic)
                VALUES (961, '2031-01-27', 961, 'Kata'), (962, '2031-01-22', 962, 'Randori')
                ON CONFLICT (training_id, date) DO UPDATE
                SET trainer_id = EXCLUDED.trainer_id, topic = EXCLUDED.topic$q$), '2');
  PERFORM pg_temp.eq('H4 the training found by e-mail: update and delete',
    pg_temp.n($q$UPDATE public.training_plan_sessions SET topic = 'Kata-Prüfung', cancelled = true
                WHERE training_id = 962 AND date = '2031-01-08'$q$)
    || pg_temp.n($q$DELETE FROM public.training_plan_sessions WHERE training_id = 962 AND date = '2031-01-22'$q$), '11');
  PERFORM pg_temp.eq('H5 deletes an emptied date',
    pg_temp.n($q$DELETE FROM public.training_plan_sessions WHERE training_id = 961 AND date = '2031-01-27'$q$), '1');
  PERFORM pg_temp.eq('H6 reads the whole plan as before',
    (SELECT count(*)::text FROM public.training_plan_sessions WHERE training_id BETWEEN 961 AND 968)
    || ' ' || (SELECT count(*) FROM public.training_plan_breaks WHERE title LIKE 'zz %'), '9 1');
  RESET ROLE;

  PERFORM pg_temp.eq('H7 what they wrote is there',
    concat_ws(' ', pg_temp.session(961, '2031-01-06'), pg_temp.session(961, '2031-01-13'),
              pg_temp.session(961, '2031-01-20'), pg_temp.session(961, '2031-02-03'),
              pg_temp.session(962, '2031-01-08')),
    '961|O-goshi|selbst|false 968|Ne-waza|-|true 968|Ashi-waza|Halle B|true -|-|-|false 962|Kata-Prüfung|-|true');
  PERFORM pg_temp.eq('H7 deleted dates are gone',
    (SELECT count(*)::text FROM public.training_plan_sessions
      WHERE (training_id, date) IN ((961, '2031-01-27'), (962, '2031-01-22'))), '0');
  PERFORM pg_temp.eq('H7 every row they wrote names them (updated_by)',
    (SELECT string_agg(DISTINCT updated_by::text, ',') FROM public.training_plan_sessions
      WHERE (training_id, date) IN ((961, '2031-01-06'), (961, '2031-01-13'), (961, '2031-01-20'),
                                    (961, '2031-02-03'), (962, '2031-01-08'))),
    v_main::text);
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- X Nothing else for the main trainer
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_main uuid := '30000000-0000-4000-8000-000000000002';
  v_before text := pg_temp.plan();
BEGIN
  PERFORM pg_temp.act_as(v_main);
  PERFORM pg_temp.eq('X1 no new session of another planned training',
    pg_temp.state($q$INSERT INTO public.training_plan_sessions (training_id, date, topic) VALUES (963, '2031-01-17', 'x')$q$), '42501');
  PERFORM pg_temp.eq('X1 none of their training outside the plan',
    pg_temp.state($q$INSERT INTO public.training_plan_sessions (training_id, date, topic) VALUES (964, '2031-01-16', 'x')$q$), '42501');
  PERFORM pg_temp.eq('X1 none of the trial record''s training',
    pg_temp.state($q$INSERT INTO public.training_plan_sessions (training_id, date, topic) VALUES (965, '2031-01-14', 'x')$q$), '42501');
  PERFORM pg_temp.eq('X1 not even in one statement with their own',
    pg_temp.state($q$INSERT INTO public.training_plan_sessions (training_id, date, topic)
                    VALUES (961, '2031-01-20', 'x'), (966, '2031-01-18', 'x')$q$), '42501');
  PERFORM pg_temp.eq('X2 no update of another training''s sessions (none in reach)',
    pg_temp.n($q$UPDATE public.training_plan_sessions SET topic = 'x', trainer_id = 961, cancelled = true
                WHERE training_id IN (963, 964, 965, 966)$q$), '0');
  PERFORM pg_temp.eq('X2 no delete of another training''s sessions',
    pg_temp.n($q$DELETE FROM public.training_plan_sessions WHERE training_id IN (963, 964, 965, 966)$q$), '0');
  PERFORM pg_temp.eq('X2 no upsert onto another training''s session',
    pg_temp.state($q$INSERT INTO public.training_plan_sessions (training_id, date, topic) VALUES (963, '2031-01-10', 'x')
                    ON CONFLICT (training_id, date) DO UPDATE SET topic = EXCLUDED.topic$q$), '42501');
  PERFORM pg_temp.eq('X3 no moving their session to another planned training',
    pg_temp.state($q$UPDATE public.training_plan_sessions SET training_id = 963
                    WHERE training_id = 961 AND date = '2031-01-06'$q$), '42501');
  PERFORM pg_temp.eq('X3 nor to their training outside the plan',
    pg_temp.state($q$UPDATE public.training_plan_sessions SET training_id = 964
                    WHERE training_id = 961 AND date = '2031-01-13'$q$), '42501');
  PERFORM pg_temp.eq('X3 no taking over another training''s session',
    pg_temp.n($q$UPDATE public.training_plan_sessions SET training_id = 961, date = '2031-01-20'
                WHERE training_id = 963$q$), '0');
  PERFORM pg_temp.eq('X4 no holidays: insert',
    pg_temp.state($q$INSERT INTO public.training_plan_breaks (title, date_from, date_to, cancels_training)
                    VALUES ('zz Eigene Ferien', '2031-01-05', '2031-01-25', true)$q$), '42501');
  PERFORM pg_temp.eq('X4 no holidays: update, delete',
    pg_temp.n($q$UPDATE public.training_plan_breaks SET cancels_training = false$q$)
    || pg_temp.n($q$DELETE FROM public.training_plan_breaks$q$), '00');
  PERFORM pg_temp.eq('X5 does not pick the planned trainings: add their own',
    pg_temp.state($q$INSERT INTO public.training_plan_trainings (training_id) VALUES (964)$q$), '42501');
  PERFORM pg_temp.eq('X5 nor remove one, their own included',
    pg_temp.n($q$DELETE FROM public.training_plan_trainings WHERE training_id IN (961, 963)$q$), '0');
  RESET ROLE;
  PERFORM pg_temp.eq('X6 the plan is unchanged', pg_temp.plan(), v_before);
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- N Nothing new for anyone else
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_main uuid := '30000000-0000-4000-8000-000000000002';
  v_viewer uuid := '30000000-0000-4000-8000-000000000003';
  v_member uuid := '30000000-0000-4000-8000-000000000004';
  v_waiting uuid := '30000000-0000-4000-8000-000000000006';
  v_outside uuid := '30000000-0000-4000-8000-000000000007';
  v_before text := pg_temp.plan();
BEGIN
  PERFORM pg_temp.act_as(v_viewer);
  PERFORM pg_temp.eq('N1 a viewer who is main trainer: no insert',
    pg_temp.state($q$INSERT INTO public.training_plan_sessions (training_id, date, topic) VALUES (963, '2031-01-17', 'x')$q$), '42501');
  PERFORM pg_temp.eq('N1 a viewer who is main trainer: no update, delete',
    pg_temp.n($q$UPDATE public.training_plan_sessions SET topic = 'x' WHERE training_id = 963$q$)
    || pg_temp.n($q$DELETE FROM public.training_plan_sessions WHERE training_id = 963$q$), '00');
  PERFORM pg_temp.eq('N1 but reads the plan',
    (SELECT count(*)::text FROM public.training_plan_sessions WHERE training_id BETWEEN 961 AND 968), '7');
  RESET ROLE;

  UPDATE public.user_profiles SET role = 'viewer' WHERE user_id = v_main;
  PERFORM pg_temp.act_as(v_main);
  PERFORM pg_temp.eq('N2 the main trainer as viewer: no insert',
    pg_temp.state($q$INSERT INTO public.training_plan_sessions (training_id, date, topic) VALUES (961, '2031-01-20', 'x')$q$), '42501');
  PERFORM pg_temp.eq('N2 the main trainer as viewer: no update, delete',
    pg_temp.n($q$UPDATE public.training_plan_sessions SET topic = 'x' WHERE training_id IN (961, 962)$q$)
    || pg_temp.n($q$DELETE FROM public.training_plan_sessions WHERE training_id IN (961, 962)$q$), '00');
  RESET ROLE;
  UPDATE public.user_profiles SET role = 'trainer', status = 'disabled' WHERE user_id = v_main;
  PERFORM pg_temp.act_as(v_main);
  PERFORM pg_temp.eq('N2 the main trainer disabled: nothing',
    pg_temp.state($q$INSERT INTO public.training_plan_sessions (training_id, date, topic) VALUES (961, '2031-01-20', 'x')$q$)
    || ' ' || pg_temp.n($q$UPDATE public.training_plan_sessions SET topic = 'x' WHERE training_id = 961$q$), '42501 0');
  RESET ROLE;
  UPDATE public.user_profiles SET status = 'approved' WHERE user_id = v_main;

  -- Their training out of the plan, or another main trainer: no longer theirs
  DELETE FROM public.training_plan_trainings WHERE training_id = 961;
  UPDATE public.trainings SET "mainTrainerId" = 968 WHERE id = 962;
  PERFORM pg_temp.act_as(v_main);
  PERFORM pg_temp.eq('N3 their training taken out of the plan, the other given to another trainer: nothing',
    pg_temp.state($q$INSERT INTO public.training_plan_sessions (training_id, date, topic) VALUES (961, '2031-01-20', 'x')$q$)
    || ' ' || pg_temp.state($q$INSERT INTO public.training_plan_sessions (training_id, date, topic) VALUES (962, '2031-01-15', 'x')$q$)
    || ' ' || pg_temp.n($q$UPDATE public.training_plan_sessions SET topic = 'x' WHERE training_id IN (961, 962)$q$),
    '42501 42501 0');
  RESET ROLE;
  INSERT INTO public.training_plan_trainings (training_id) VALUES (961);
  UPDATE public.trainings SET "mainTrainerId" = 962 WHERE id = 962;

  PERFORM pg_temp.act_as(v_outside);
  PERFORM pg_temp.eq('N4 main trainer of a training outside the plan: no insert there or elsewhere',
    pg_temp.state($q$INSERT INTO public.training_plan_sessions (training_id, date, topic) VALUES (968, '2031-01-09', 'x')$q$)
    || ' ' || pg_temp.state($q$INSERT INTO public.training_plan_sessions (training_id, date, topic) VALUES (961, '2031-01-20', 'x')$q$),
    '42501 42501');
  PERFORM pg_temp.eq('N4 no update, delete',
    pg_temp.n($q$UPDATE public.training_plan_sessions SET topic = 'x'$q$)
    || pg_temp.n($q$DELETE FROM public.training_plan_sessions$q$), '00');
  RESET ROLE;

  PERFORM pg_temp.act_as(v_waiting);
  PERFORM pg_temp.eq('N5 a waiting trainer who is main trainer: nothing',
    pg_temp.state($q$INSERT INTO public.training_plan_sessions (training_id, date, topic) VALUES (969, '2031-01-12', 'x')$q$)
    || ' ' || pg_temp.n($q$UPDATE public.training_plan_sessions SET topic = 'x'$q$)
    || ' ' || (SELECT count(*) FROM public.training_plan_sessions), '42501 0 0');
  RESET ROLE;

  PERFORM pg_temp.act_as(v_member);
  PERFORM pg_temp.eq('N6 a member account whose member is main trainer: nothing, not even reading',
    pg_temp.state($q$INSERT INTO public.training_plan_sessions (training_id, date, topic) VALUES (966, '2031-01-18', 'x')$q$)
    || ' ' || pg_temp.n($q$UPDATE public.training_plan_sessions SET topic = 'x'$q$)
    || pg_temp.n($q$DELETE FROM public.training_plan_sessions$q$)
    || ' ' || (SELECT count(*) FROM public.training_plan_sessions)
    || (SELECT count(*) FROM public.training_plan_trainings)
    || (SELECT count(*) FROM public.training_plan_breaks), '42501 00 000');
  RESET ROLE;

  PERFORM pg_temp.as_anon();
  PERFORM pg_temp.eq('N7 anon: no reading, no writing',
    pg_temp.state('SELECT count(*) FROM public.training_plan_sessions')
    || ' ' || pg_temp.state($q$INSERT INTO public.training_plan_sessions (training_id, date, topic) VALUES (961, '2031-01-20', 'x')$q$)
    || ' ' || pg_temp.state($q$UPDATE public.training_plan_sessions SET topic = 'x'$q$)
    || ' ' || pg_temp.state('DELETE FROM public.training_plan_sessions'), '42501 42501 42501 42501');
  RESET ROLE;

  PERFORM pg_temp.eq('N8 the plan is unchanged', pg_temp.plan(), v_before);
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- P Privileges and policies
-----------------

SELECT pg_temp.ok('P1 my_main_training_ids for signed-in accounts and the service role, not anon or PUBLIC',
  has_function_privilege('authenticated', 'public.my_main_training_ids()', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.my_main_training_ids()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.my_main_training_ids()', 'EXECUTE')
  AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                  WHERE p.oid = 'public.my_main_training_ids()'::regprocedure
                    AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'));
SELECT pg_temp.eq('P1 a stable SECURITY DEFINER function with a fixed search_path, returning training ids',
  (SELECT concat_ws(' ', p.prosecdef, p.provolatile, p.proretset, format_type(p.prorettype, NULL),
                    array_to_string(p.proconfig, ','))
     FROM pg_proc p WHERE p.oid = 'public.my_main_training_ids()'::regprocedure),
  't s t smallint search_path=public');
-- Policy expressions as pg_policies shows them, without the blank Postgres
-- puts after an opening bracket
CREATE FUNCTION pg_temp.expr(p_expr text) RETURNS text
LANGUAGE sql AS $$ SELECT regexp_replace(p_expr, '\(\s+', '(', 'g') $$;

SELECT pg_temp.eq('P2 sessions: the TK or the main trainer, for the old and the new row',
  (SELECT string_agg(policyname || ' ' || coalesce(pg_temp.expr(qual), '-') || ' '
                     || coalesce(pg_temp.expr(with_check), '-'), ' / ' ORDER BY policyname)
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'training_plan_sessions' AND cmd <> 'SELECT'),
  'training_plan_sessions_delete ((SELECT is_exam_manager() AS is_exam_manager) OR (training_id IN (SELECT my_main_training_ids() AS my_main_training_ids))) -'
  || ' / training_plan_sessions_insert - ((SELECT is_exam_manager() AS is_exam_manager) OR (training_id IN (SELECT my_main_training_ids() AS my_main_training_ids)))'
  || ' / training_plan_sessions_update ((SELECT is_exam_manager() AS is_exam_manager) OR (training_id IN (SELECT my_main_training_ids() AS my_main_training_ids)))'
  || ' ((SELECT is_exam_manager() AS is_exam_manager) OR (training_id IN (SELECT my_main_training_ids() AS my_main_training_ids)))');
SELECT pg_temp.eq('P3 holidays and the planned trainings: only the TK writes',
  (SELECT string_agg(tablename || ' ' || cmd || ' ' || coalesce(pg_temp.expr(qual), '-') || ' '
                     || coalesce(pg_temp.expr(with_check), '-'), ' / ' ORDER BY tablename, cmd)
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('training_plan_breaks', 'training_plan_trainings')
      AND cmd <> 'SELECT'),
  'training_plan_breaks DELETE (SELECT is_exam_manager() AS is_exam_manager) -'
  || ' / training_plan_breaks INSERT - (SELECT is_exam_manager() AS is_exam_manager)'
  || ' / training_plan_breaks UPDATE (SELECT is_exam_manager() AS is_exam_manager) (SELECT is_exam_manager() AS is_exam_manager)'
  || ' / training_plan_trainings DELETE (SELECT is_exam_manager() AS is_exam_manager) -'
  || ' / training_plan_trainings INSERT - (SELECT is_exam_manager() AS is_exam_manager)');
SELECT pg_temp.eq('P4 reading unchanged: all staff',
  (SELECT string_agg(tablename || ' ' || cmd || ' ' || pg_temp.expr(qual), ', ' ORDER BY tablename)
     FROM pg_policies
    WHERE schemaname = 'public' AND tablename LIKE 'training_plan%' AND cmd IN ('SELECT', 'ALL')),
  'training_plan_breaks SELECT (SELECT is_staff() AS is_staff), '
  || 'training_plan_sessions SELECT (SELECT is_staff() AS is_staff), '
  || 'training_plan_trainings SELECT (SELECT is_staff() AS is_staff)');

ROLLBACK;

\o
\echo 'training_plan: all checks passed'
