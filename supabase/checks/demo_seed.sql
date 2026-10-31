-- Checks for the demo club (supabase/demo/seed.sql), run right after the seed
-- by .github/workflows/demo-reset.yml and locally:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/checks/demo_seed.sql
--
-- Runs as postgres inside one transaction that is rolled back, so it changes
-- nothing (the guard tests write, then everything is undone). A failed check
-- raises 'FAIL: <name>' and stops. Accounts act through the API role like in
-- supabase/checks/member_access.sql: pg_temp.act_as() sets the JWT claims
-- and SET LOCAL ROLE authenticated.

\set ON_ERROR_STOP 1
\o /dev/null
SET client_min_messages = notice;

BEGIN;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

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
    RAISE EXCEPTION 'FAIL: %: got %, expected %', p_name, coalesce(p_actual, 'NULL'),
      coalesce(p_expected, 'NULL');
  END IF;
  RAISE NOTICE 'ok   %', p_name;
END $$;

-- The statement raises an error whose message matches p_like (by default
-- the demo guards' 'In der Demo …'; any other error, e.g. a constraint that
-- happens to fire, is a failure); the subtransaction undoes what it did
CREATE FUNCTION pg_temp.raises(p_name text, p_sql text, p_like text DEFAULT 'In der Demo %')
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_msg text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  IF v_msg IS NULL THEN
    RAISE EXCEPTION 'FAIL: % did not raise', p_name;
  ELSIF v_msg NOT LIKE p_like THEN
    RAISE EXCEPTION 'FAIL: % raised the wrong error: %', p_name, v_msg;
  END IF;
  RAISE NOTICE 'ok   % (%)', p_name, v_msg;
END $$;

-- Act as this account until RESET ROLE (or the transaction ends)
CREATE FUNCTION pg_temp.act_as(p_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
END $$;

-- Where the app sends the signed-in account: homePath() in src/lib/roles.ts
-- (staff → /dashboard, approved member with access → /club, else /pending)
CREATE FUNCTION pg_temp.home_path(p_id uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_profile public.user_profiles;
  v_access boolean;
BEGIN
  SELECT * INTO v_profile FROM public.user_profiles WHERE user_id = p_id;
  PERFORM pg_temp.act_as(p_id);
  SELECT has_access INTO v_access FROM public.my_access();
  RESET ROLE;
  IF v_profile.status = 'approved' AND v_profile.role IN ('viewer', 'trainer', 'admin') THEN
    RETURN '/dashboard';
  ELSIF v_profile.status = 'approved' AND v_profile.role = 'member'
        AND v_access IS DISTINCT FROM false THEN
    RETURN '/club';
  END IF;
  RETURN '/pending';
END $$;

CREATE FUNCTION pg_temp.profile(p_email text) RETURNS text
LANGUAGE sql AS $$
  SELECT status || '/' || role || '/' || coalesce(exam_role, '-') || '/'
         || coalesce(member_id::text, '-')
  FROM public.user_profiles WHERE email = p_email;
$$;

-- ---------------------------------------------------------------------------
-- Marker, settings, storage
-- ---------------------------------------------------------------------------

SELECT pg_temp.eq('database is marked as the demo',
  (SELECT shobj_description(oid, 'pg_database') FROM pg_database
   WHERE datname = current_database()), 'administra-demo');
SELECT pg_temp.ok('no bootstrap admin', NOT EXISTS (SELECT 1 FROM public.bootstrap_admins));
SELECT pg_temp.ok('avatars bucket exists',
  EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'avatars'));
SELECT pg_temp.ok('lesson-plans bucket takes only lesson plan files',
  EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'lesson-plans'
          AND file_size_limit = 10485760
          AND 'application/pdf' = ANY (allowed_mime_types)
          AND NOT 'application/x-msdownload' = ANY (allowed_mime_types)));
SELECT pg_temp.eq('club name', (SELECT value #>> '{}' FROM public.app_settings
                                WHERE key = 'club.name'), 'Budo-Club Musterwil');
SELECT pg_temp.eq('club sections', (SELECT value::text FROM public.app_settings
                                    WHERE key = 'club.sections'), '["Judo", "Aikido"]');
SELECT pg_temp.eq('default language', (SELECT value #>> '{}' FROM public.app_settings
                                       WHERE key = 'locale.default'), 'de');

-- ---------------------------------------------------------------------------
-- Demo accounts
-- ---------------------------------------------------------------------------

SELECT pg_temp.eq('vorstand: approved admin, own member record',
  pg_temp.profile('vorstand@demo.alleda.ch'), 'approved/admin/-/101');
SELECT pg_temp.eq('trainer: approved trainer and examiner, own member record',
  pg_temp.profile('trainer@demo.alleda.ch'), 'approved/trainer/examiner/102');
SELECT pg_temp.eq('mitglied: approved member account (automatically)',
  pg_temp.profile('mitglied@demo.alleda.ch'), 'approved/member/-/-');
SELECT pg_temp.eq('neu: waiting for approval',
  pg_temp.profile('neu@demo.alleda.ch'), 'pending/member/-/-');
SELECT pg_temp.ok('demo logins can sign in with a password (confirmed, bcrypt)',
  (SELECT count(*) FROM auth.users u
   JOIN auth.identities i ON i.user_id = u.id AND i.provider = 'email'
   WHERE u.email IN ('vorstand@demo.alleda.ch',
                     'trainer@demo.alleda.ch',
                     'mitglied@demo.alleda.ch')
     AND u.email_confirmed_at IS NOT NULL
     AND u.encrypted_password = extensions.crypt('administra-demo', u.encrypted_password)) = 3);

SELECT pg_temp.eq('vorstand lands on the dashboard',
  pg_temp.home_path('d3e40000-0000-4000-8000-000000000001'), '/dashboard');
SELECT pg_temp.eq('trainer lands on the dashboard',
  pg_temp.home_path('d3e40000-0000-4000-8000-000000000002'), '/dashboard');
SELECT pg_temp.eq('mitglied lands in the club area',
  pg_temp.home_path('d3e40000-0000-4000-8000-000000000003'), '/club');
SELECT pg_temp.eq('neu lands on the pending page',
  pg_temp.home_path('d3e40000-0000-4000-8000-000000000004'), '/pending');

DO $$
DECLARE
  v_approved boolean;
  v_access text;
  v_ids text;
  v_exams integer;
BEGIN
  PERFORM pg_temp.act_as('d3e40000-0000-4000-8000-000000000003');
  v_approved := public.is_approved_user();
  SELECT has_access || ' ' || member_statuses::text INTO v_access FROM public.my_access();
  SELECT string_agg(x::text, ',' ORDER BY x) INTO v_ids FROM public.my_member_ids() x;
  SELECT count(*) INTO v_exams FROM public.exams;
  RESET ROLE;
  PERFORM pg_temp.ok('mitglied: is_approved_user()', v_approved);
  PERFORM pg_temp.eq('mitglied: my_access()', v_access, 'true {active}');
  PERFORM pg_temp.eq('mitglied: exactly the two Brunner children', v_ids, '120,150');
  PERFORM pg_temp.ok('mitglied: sees the exam days', v_exams >= 2);
END $$;

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------

SELECT pg_temp.ok('no member id in the Webling range',
  NOT EXISTS (SELECT 1 FROM public.members WHERE id BETWEEN 1000 AND 9999999));
SELECT pg_temp.ok('no member_links', NOT EXISTS (SELECT 1 FROM public.member_links));
SELECT pg_temp.ok('100 or more members',
  (SELECT count(*) FROM public.members) >= 100);
SELECT pg_temp.ok('active, passive, left and trial members',
  (SELECT count(DISTINCT membership_status) FROM public.members
   WHERE membership_status IN ('active', 'passive', 'left', 'trial')) = 4);
SELECT pg_temp.ok('no member photo to download',
  NOT EXISTS (SELECT 1 FROM public.members WHERE "imgUploaded" IS NOT NULL));

-- ---------------------------------------------------------------------------
-- Attendance and badges
-- ---------------------------------------------------------------------------

SELECT pg_temp.ok('logs within the last 14 days',
  EXISTS (SELECT 1 FROM public.logs
          WHERE date >= to_char(current_date - 14, 'YYYY-MM-DD')));
SELECT pg_temp.ok('no logs today or later',
  NOT EXISTS (SELECT 1 FROM public.logs WHERE date >= to_char(current_date, 'YYYY-MM-DD')));
SELECT pg_temp.ok('logs span at least 400 days',
  (SELECT max(date)::date - min(date)::date FROM public.logs) >= 400);
SELECT pg_temp.ok('logs cover the whole year before last (season comparisons)',
  (SELECT min(date) FROM public.logs)
    < make_date(extract(year FROM current_date)::int - 2, 1, 15)::text);
SELECT pg_temp.ok('every training has logs',
  NOT EXISTS (SELECT 1 FROM public.trainings t
              WHERE NOT EXISTS (SELECT 1 FROM public.logs l WHERE l."trainingId" = t.id)));
SELECT pg_temp.ok('every logged session has a main trainer',
  NOT EXISTS (SELECT 1 FROM (SELECT DISTINCT "trainingId", date FROM public.logs) s
              WHERE NOT EXISTS (SELECT 1 FROM public.logs l
                                WHERE l."trainingId" = s."trainingId" AND l.date = s.date
                                  AND l."trainerRole" = 'main_trainer')));
SELECT pg_temp.ok('season badges for the previous year',
  EXISTS (SELECT 1 FROM public.member_badges
          WHERE season = extract(year FROM current_date)::int - 1
            AND "badgeId" IN ('top_3', 'season_regular')));
SELECT pg_temp.ok('more than 50 member badges',
  (SELECT count(*) FROM public.member_badges) > 50);
SELECT pg_temp.ok('no badge earned in the future',
  NOT EXISTS (SELECT 1 FROM public.member_badges WHERE "earnedAt" > now()));
SELECT pg_temp.ok('no badge celebration right after the reset',
  NOT EXISTS (SELECT 1 FROM public.member_badges WHERE "earnedAt" > now() - interval '1 minute'));

-- ---------------------------------------------------------------------------
-- Q-Prüfungen
-- ---------------------------------------------------------------------------

SELECT pg_temp.ok('an upcoming exam open for at least 7 more days, with candidates',
  EXISTS (SELECT 1 FROM public.exams e
          WHERE e.registration_deadline >= to_char(current_date + 7, 'YYYY-MM-DD')
            AND EXISTS (SELECT 1 FROM public.exam_candidates c WHERE c.exam_id = e.id)));
SELECT pg_temp.ok('a past exam with passed candidates and their grades',
  EXISTS (SELECT 1 FROM public.exams e
          WHERE e.date < to_char(current_date, 'YYYY-MM-DD')
            AND EXISTS (SELECT 1 FROM public.exam_candidates c
                        WHERE c.exam_id = e.id AND c.result = 'passed'))
  AND NOT EXISTS (SELECT 1 FROM public.exam_candidates c
                  WHERE c.result = 'passed' AND c.member_grade_id IS NULL));
SELECT pg_temp.ok('passed sheets reach the minimum, the failed one does not',
  NOT EXISTS (SELECT 1 FROM public.exam_candidates c
              WHERE c.result IS NOT NULL
                AND (c.total_points IS NULL
                     OR (c.result = 'passed') <> (c.total_points >= c.min_points))));
SELECT pg_temp.ok('one failed candidate',
  (SELECT count(*) FROM public.exam_candidates WHERE result = 'failed') = 1);
-- The migration seeds the real club's programs; the demo replaces them
SELECT pg_temp.ok('exam programs and sheets are the demo''s invented ones, not the club''s',
  EXISTS (SELECT 1 FROM public.exam_programs)
  AND NOT EXISTS (SELECT 1 FROM public.exam_programs
                  WHERE NOT parts @> '[{"key": "tachi"}]'
                     OR parts @> '[{"key": "stichproben"}]' OR parts @> '[{"key": "boden"}]')
  AND NOT EXISTS (SELECT 1 FROM public.exam_candidates
                  WHERE program IS NOT NULL AND NOT program @> '[{"key": "tachi"}]'));
SELECT pg_temp.ok('the demo member has an eligible child not yet registered',
  EXISTS (SELECT 1 FROM public.exams e
          CROSS JOIN (VALUES (120), (150)) AS k(member_id)
          WHERE e.registration_deadline >= to_char(current_date, 'YYYY-MM-DD')
            AND NOT EXISTS (SELECT 1 FROM public.exam_candidates c
                            WHERE c.exam_id = e.id AND c.member_id = k.member_id))
  AND EXISTS (SELECT 1 FROM public.exam_candidates c
              JOIN public.exams e ON e.id = c.exam_id
              WHERE c.member_id IN (120, 150)
                AND e.date >= to_char(current_date, 'YYYY-MM-DD')));

SELECT pg_temp.ok('no exam day or event in the Christmas or summer break',
  NOT EXISTS (SELECT 1 FROM (SELECT date FROM public.exams UNION ALL
                             SELECT date FROM public.events) x
              WHERE right(x.date, 5) >= '12-24' OR right(x.date, 5) <= '01-04'
                 OR right(x.date, 5) BETWEEN '07-11' AND '08-10'));
SELECT pg_temp.ok('no event on an exam day',
  NOT EXISTS (SELECT 1 FROM public.events e JOIN public.exams x ON x.date = e.date));
SELECT pg_temp.ok('plausible grade ages (2. Kyu from 13, 1. Kyu from 15, Dan from 16)',
  NOT EXISTS (SELECT 1 FROM public.member_grades mg
              JOIN public.members m ON m.id = mg."memberId"
              JOIN public.grade_definitions g ON g.section = mg.section AND g.grade = mg.grade
              WHERE age(mg."examDate"::date, m.birthday::date)
                    < make_interval(years => CASE WHEN g."isDan" THEN 16
                                                  WHEN g.grade = '1. Kyu' THEN 15
                                                  WHEN g.grade = '2. Kyu' THEN 13
                                                  ELSE 0 END)));
SELECT pg_temp.ok('one grade per member and exam day',
  NOT EXISTS (SELECT 1 FROM public.member_grades
              GROUP BY "memberId", section, "examDate" HAVING count(*) > 1));
SELECT pg_temp.ok('nobody under 16 leads or assists a training',
  NOT EXISTS (SELECT 1 FROM public.logs l JOIN public.members m ON m.id = l."memberId"
              WHERE l."trainerRole" IN ('main_trainer', 'assistant')
                AND age(l.date::date, m.birthday::date) < interval '16 years'));
SELECT pg_temp.ok('competitors from 30 start as Masters, not Elite',
  NOT EXISTS (SELECT 1 FROM public.member_medals md JOIN public.members m ON m.id = md."memberId"
              WHERE md.category LIKE 'Elite%'
                AND age(md.date::date, m.birthday::date) >= interval '30 years'));
SELECT pg_temp.ok('attendees at most a year outside the training''s age range (then)',
  NOT EXISTS (SELECT 1 FROM public.logs l
              JOIN public.members m ON m.id = l."memberId"
              JOIN public.trainings t ON t.id = l."trainingId"
              CROSS JOIN LATERAL (SELECT extract(year FROM age(l.date::date, m.birthday::date))
                                    AS a) x
              WHERE l."trainerRole" = 'attendee'
                AND (x.a < t."ageFrom" - 1 OR x.a > t."ageTo" + 1)));

-- ---------------------------------------------------------------------------
-- Training plan
-- ---------------------------------------------------------------------------

SELECT pg_temp.ok('plan sessions reach at least 70 days ahead',
  (SELECT max(date) FROM public.training_plan_sessions)
    >= to_char(current_date + 70, 'YYYY-MM-DD'));
SELECT pg_temp.ok('plan sessions fall on their training''s weekday',
  NOT EXISTS (SELECT 1 FROM public.training_plan_sessions s
              JOIN public.trainings t ON t.id = s.training_id
              WHERE (ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
                           'Sunday'])[extract(isodow FROM s.date::date)::int] <> t.weekday));
SELECT pg_temp.ok('plan sessions only for planned trainings',
  NOT EXISTS (SELECT 1 FROM public.training_plan_sessions s
              WHERE s.training_id NOT IN (SELECT training_id
                                          FROM public.training_plan_trainings)));
-- The trainer login plans exactly one training himself: the one he is main
-- trainer of (docs/TRAINING_PLAN.md); the other accounts as their role says
CREATE FUNCTION pg_temp.main_trainings(p_id uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  PERFORM pg_temp.act_as(p_id);
  v := (SELECT string_agg(t.id || ' ' || t.title, ',' ORDER BY t.id)
        FROM public.my_main_training_ids() x JOIN public.trainings t ON t.id = x);
  RESET ROLE;
  RETURN coalesce(v, '-');
END $$;

SELECT pg_temp.eq('trainer: plans exactly one training himself, as its main trainer',
  pg_temp.main_trainings('d3e40000-0000-4000-8000-000000000002')
  || ' ' || (SELECT "mainTrainerId" FROM public.trainings WHERE id = 2), '2 Judo Jugend 102');
SELECT pg_temp.ok('trainer: that training has plan sessions ahead',
  EXISTS (SELECT 1 FROM public.training_plan_sessions
          WHERE training_id = 2 AND date >= to_char(current_date + 28, 'YYYY-MM-DD')));
SELECT pg_temp.ok('trainer: is not the TK (plans no other training)',
  NOT EXISTS (SELECT 1 FROM public.user_profiles
              WHERE user_id = 'd3e40000-0000-4000-8000-000000000002'
                AND exam_role = 'manager'));
SELECT pg_temp.eq('mitglied: plans nothing',
  pg_temp.main_trainings('d3e40000-0000-4000-8000-000000000003'), '-');
SELECT pg_temp.ok('a future school holiday and a future closed day',
  EXISTS (SELECT 1 FROM public.training_plan_breaks
          WHERE NOT cancels_training AND date_to >= to_char(current_date, 'YYYY-MM-DD'))
  AND EXISTS (SELECT 1 FROM public.training_plan_breaks
              WHERE cancels_training AND date_from >= to_char(current_date, 'YYYY-MM-DD')));

-- ---------------------------------------------------------------------------
-- Events and trial candidates
-- ---------------------------------------------------------------------------

SELECT pg_temp.ok('past and upcoming events',
  EXISTS (SELECT 1 FROM public.events WHERE date < to_char(current_date, 'YYYY-MM-DD'))
  AND EXISTS (SELECT 1 FROM public.events
              WHERE date >= to_char(current_date + 70, 'YYYY-MM-DD')));
SELECT pg_temp.ok('trial candidates in every status',
  (SELECT count(DISTINCT "trialStatus") FROM public.members
   WHERE "trialStatus" IN ('new', 'waitlist', 'assigned', 'cancelled')) = 4);
SELECT pg_temp.ok('fewer than 20 trial registrations in the last hour (rate limit)',
  (SELECT count(*) FROM public.members
   WHERE "trialRegisteredAt" > now() - interval '1 hour') < 20);
SELECT pg_temp.ok('trial start dates: after today, on the weekday, on a day the training runs',
  NOT EXISTS (SELECT 1 FROM public.participants p
              JOIN public.trainings t ON t.id = p."trainingId"
              WHERE p."trialStartDate" IS NOT NULL
                AND p."trialStartDate" >= current_date
                AND ((ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
                            'Sunday'])[extract(isodow FROM p."trialStartDate")::int] <> t.weekday
                     OR to_char(p."trialStartDate", 'MM-DD') >= '12-24'
                     OR to_char(p."trialStartDate", 'MM-DD') <= '01-04'
                     -- trainings without logs in last year's summer break pause then
                     OR (to_char(p."trialStartDate", 'MM-DD') BETWEEN '07-11' AND '08-10'
                         AND NOT EXISTS (
                           SELECT 1 FROM public.logs l
                           WHERE l."trainingId" = t.id
                             AND l.date BETWEEN (extract(year FROM current_date)::int - 1)
                                                  || '-07-11'
                                            AND (extract(year FROM current_date)::int - 1)
                                                  || '-08-10'))
                     OR EXISTS (SELECT 1 FROM public.training_plan_breaks b
                                WHERE b.cancels_training
                                  AND to_char(p."trialStartDate", 'YYYY-MM-DD')
                                      BETWEEN b.date_from AND b.date_to)
                     OR EXISTS (SELECT 1 FROM public.training_plan_sessions s
                                WHERE s.training_id = t.id AND s.cancelled
                                  AND s.date = to_char(p."trialStartDate", 'YYYY-MM-DD'))))
  AND (SELECT count(*) FROM public.participants
       WHERE "trialStartDate" >= current_date) >= 2);
SELECT pg_temp.ok('a trial candidate who should become a member',
  EXISTS (SELECT 1 FROM public.members m
          WHERE m."trialStatus" = 'assigned'
            AND (SELECT count(*) FROM public.logs l WHERE l."memberId" = m.id) >= 3));

-- ---------------------------------------------------------------------------
-- Guards (each change is undone with the transaction)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_before text;
BEGIN
  SELECT encrypted_password INTO v_before FROM auth.users
  WHERE id = 'd3e40000-0000-4000-8000-000000000001';
  UPDATE auth.users
  SET encrypted_password = extensions.crypt('hijacked', extensions.gen_salt('bf')),
      email = 'someone@example.com', last_sign_in_at = now() - interval '1 minute'
  WHERE id = 'd3e40000-0000-4000-8000-000000000001';
  PERFORM pg_temp.eq('guard: demo admin keeps its password',
    (SELECT encrypted_password FROM auth.users
     WHERE id = 'd3e40000-0000-4000-8000-000000000001'), v_before);
  PERFORM pg_temp.eq('guard: demo admin keeps its e-mail',
    (SELECT email FROM auth.users WHERE id = 'd3e40000-0000-4000-8000-000000000001'),
    'vorstand@demo.alleda.ch');
  PERFORM pg_temp.ok('guard: sign-in still updates last_sign_in_at',
    (SELECT last_sign_in_at FROM auth.users
     WHERE id = 'd3e40000-0000-4000-8000-000000000001')
      BETWEEN now() - interval '2 minutes' AND now());
  UPDATE auth.users SET encrypted_password = 'x'
  WHERE id = 'd3e40000-0000-4000-8000-000000000004';
  PERFORM pg_temp.eq('guard: other accounts are not protected',
    (SELECT encrypted_password FROM auth.users
     WHERE id = 'd3e40000-0000-4000-8000-000000000004'), 'x');
END $$;

SELECT pg_temp.raises('guard: deleting a demo login',
  $$DELETE FROM auth.users WHERE id = 'd3e40000-0000-4000-8000-000000000002'$$);
SELECT pg_temp.raises('guard: demoting the demo trainer',
  $$UPDATE public.user_profiles SET role = 'viewer'
    WHERE user_id = 'd3e40000-0000-4000-8000-000000000002'$$);
SELECT pg_temp.raises('guard: disabling the demo member account',
  $$UPDATE public.user_profiles SET status = 'disabled'
    WHERE user_id = 'd3e40000-0000-4000-8000-000000000003'$$);
SELECT pg_temp.raises('guard: deleting a demo profile',
  $$DELETE FROM public.user_profiles
    WHERE user_id = 'd3e40000-0000-4000-8000-000000000002'$$);
SELECT pg_temp.raises('guard: deleting the demo admin profile',
  $$DELETE FROM public.user_profiles
    WHERE user_id = 'd3e40000-0000-4000-8000-000000000001'$$);
SELECT pg_temp.raises('guard: changing the club name',
  $$UPDATE public.app_settings SET value = '"Hacked"' WHERE key = 'club.name'$$);
SELECT pg_temp.raises('guard: deleting the club logo setting',
  $$DELETE FROM public.app_settings WHERE key = 'club.logo'$$);
SELECT pg_temp.raises('guard: emptying the sections',
  $$UPDATE public.app_settings SET value = '[]' WHERE key = 'club.sections'$$);
SELECT pg_temp.raises('guard: switching the default language',
  $$UPDATE public.app_settings SET value = '"en"' WHERE key = 'locale.default'$$);
SELECT pg_temp.raises('guard: upserting another contact e-mail',
  $$INSERT INTO public.app_settings (key, value) VALUES ('club.contactEmail', '"x@example.com"')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value$$);
SELECT pg_temp.raises('guard: deleting a Brunner child',
  $$DELETE FROM public.members WHERE id = 120$$);
SELECT pg_temp.raises('guard: deleting the upcoming exam day',
  $$DELETE FROM public.exams WHERE registration_deadline >= to_char(current_date, 'YYYY-MM-DD')$$);
SELECT pg_temp.raises('guard: closing the upcoming exam''s registration',
  $$UPDATE public.exams SET registration_deadline = to_char(current_date - 1, 'YYYY-MM-DD')
    WHERE registration_deadline >= to_char(current_date, 'YYYY-MM-DD')$$);
SELECT pg_temp.raises('guard: archiving a Brunner child',
  $$UPDATE public.members SET "archivedAt" = now() WHERE id = 150$$);
SELECT pg_temp.raises('guard: changing the trainer''s member e-mail',
  $$UPDATE public.members SET email = 'x@example.com' WHERE id = 102$$);
SELECT pg_temp.raises('guard: giving Judo Jugend another main trainer',
  $$UPDATE public.trainings SET "mainTrainerId" = 105 WHERE id = 2$$);
SELECT pg_temp.raises('guard: as the demo trainer, handing over his training',
  $$SELECT pg_temp.act_as('d3e40000-0000-4000-8000-000000000002');
    UPDATE public.trainings SET "mainTrainerId" = NULL WHERE id = 2$$);
RESET ROLE;
SELECT pg_temp.raises('guard: approving the pending example request',
  $$UPDATE public.user_profiles SET status = 'approved', role = 'admin'
    WHERE user_id = 'd3e40000-0000-4000-8000-000000000004'$$);
SELECT pg_temp.raises('guard: deleting the pending example request',
  $$DELETE FROM public.user_profiles
    WHERE user_id = 'd3e40000-0000-4000-8000-000000000004'$$);
SELECT pg_temp.raises('guard: adding a stranger to the Brunner family',
  $$INSERT INTO public.members (id, firstname, lastname, email)
    VALUES (990, 'Fremd', 'Person', ' Mitglied@Demo.Alleda.ch')$$);
SELECT pg_temp.raises('guard: moving a demo login e-mail to another member',
  $$UPDATE public.members SET email = 'trainer@demo.alleda.ch' WHERE id = 201$$);
SELECT pg_temp.raises('guard: starting the sheet of a Brunner child on the upcoming exam',
  $$UPDATE public.exam_candidates SET started_at = now()
    WHERE exam_id = 2 AND member_id = 150$$);
SELECT pg_temp.raises('guard: deleting all events',
  $$DELETE FROM public.events WHERE id > 0$$);
SELECT pg_temp.raises('guard: deleting one seeded event',
  $$DELETE FROM public.events WHERE id = (SELECT max(id) FROM public.events)$$);
SELECT pg_temp.raises('guard: deleting the registrations of a seeded event',
  $$DELETE FROM public.event_participants
    WHERE "eventId" = (SELECT max("eventId") FROM public.event_participants)$$);
SELECT pg_temp.raises('guard: deleting all exam programs',
  $$DELETE FROM public.exam_programs WHERE id > 0$$);
SELECT pg_temp.raises('guard: removing a training from the plan',
  $$DELETE FROM public.training_plan_trainings
    WHERE training_id = (SELECT min(training_id) FROM public.training_plan_trainings)$$);
SELECT pg_temp.raises('guard: deleting the whole training plan',
  $$DELETE FROM public.training_plan_sessions WHERE id > 0$$);
SELECT pg_temp.raises('guard: deleting all holidays',
  $$DELETE FROM public.training_plan_breaks WHERE id > 0$$);
SELECT pg_temp.raises('guard: deleting a day of attendance',
  $$DELETE FROM public.logs WHERE date = (SELECT max(date) FROM public.logs)$$);
SELECT pg_temp.raises('guard: emptying a roster',
  $$DELETE FROM public.participants WHERE "trainingId" = 1$$);
SELECT pg_temp.raises('guard: deleting a trial candidate',
  $$DELETE FROM public.members WHERE "trialStatus" = 'new'
    AND id = (SELECT min(id) FROM public.members WHERE "trialStatus" = 'new')$$);
SELECT pg_temp.raises('guard: deleting several members at once',
  $$DELETE FROM public.members WHERE id IN (303, 304)$$);
SELECT pg_temp.raises('guard: deleting the upcoming exam''s registrations',
  $$DELETE FROM public.exam_candidates WHERE exam_id = 2$$);
SELECT pg_temp.raises('guard: as the demo admin, deleting all events through the API role',
  $$SELECT pg_temp.act_as('d3e40000-0000-4000-8000-000000000001');
    DELETE FROM public.events WHERE id > 0$$);
RESET ROLE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'demo_guard_mfa_factors') THEN
    PERFORM pg_temp.raises('guard: MFA factor on a demo login',
      $q$INSERT INTO auth.mfa_factors (id, user_id, friendly_name, factor_type, status,
                                       created_at, updated_at)
         VALUES (gen_random_uuid(), 'd3e40000-0000-4000-8000-000000000002', 'x', 'totp',
                 'unverified', now(), now())$q$);
  ELSE
    RAISE NOTICE 'skip guard: MFA factor on a demo login (trigger not installed)';
  END IF;
END $$;

DO $$
BEGIN
  UPDATE public.user_profiles
  SET full_name = 'Sandra K.', email = 'nobody@example.com',
      avatar_url = 'https://evil.example/x.png', updated_at = now() - interval '1 minute'
  WHERE user_id = 'd3e40000-0000-4000-8000-000000000001';
  PERFORM pg_temp.eq('guard: demo profile keeps name, e-mail and avatar',
    (SELECT full_name || ' ' || email || ' ' || coalesce(avatar_url, '-')
     FROM public.user_profiles WHERE user_id = 'd3e40000-0000-4000-8000-000000000001'),
    'Sandra Keller vorstand@demo.alleda.ch -');
  PERFORM pg_temp.ok('guard: a demo profile update still goes through (updated_at)',
    (SELECT updated_at FROM public.user_profiles
     WHERE user_id = 'd3e40000-0000-4000-8000-000000000001') > now() - interval '2 minutes');
  UPDATE public.user_profiles SET full_name = 'Luca B.'
  WHERE user_id = 'd3e40000-0000-4000-8000-000000000004';
  PERFORM pg_temp.eq('guard: other profiles are not protected',
    (SELECT full_name FROM public.user_profiles
     WHERE user_id = 'd3e40000-0000-4000-8000-000000000004'), 'Luca B.');
  UPDATE public.exams SET notes = 'Neue Notiz' WHERE id IN (1, 2);
  PERFORM pg_temp.ok('guard: exam notes may change',
    (SELECT count(*) FROM public.exams WHERE notes = 'Neue Notiz') = 2);
  UPDATE public.trainings SET title = 'Judo Jugend (ab 11)', "dateTo" = '20:15' WHERE id = 2;
  UPDATE public.trainings SET "mainTrainerId" = 106 WHERE id = 3;
  PERFORM pg_temp.eq('guard: Judo Jugend may change otherwise, other main trainers too',
    (SELECT string_agg(title || ' ' || "mainTrainerId", ',' ORDER BY id) FROM public.trainings
     WHERE id IN (2, 3)), 'Judo Jugend (ab 11) 102,Judo Erwachsene 106');
  UPDATE public.members SET mobile = '079 000 00 00', notes = 'geändert' WHERE id = 120;
  PERFORM pg_temp.eq('guard: a protected member''s mobile may change',
    (SELECT mobile FROM public.members WHERE id = 120), '079 000 00 00');
  UPDATE public.members SET mobile = '079 111 11 11', labels = '["Passiv"]' WHERE id = 201;
  PERFORM pg_temp.eq('guard: other members are not protected',
    (SELECT membership_status FROM public.members WHERE id = 201), 'passive');
  INSERT INTO public.app_settings (key, value) VALUES ('club.name', '"Budo-Club Musterwil"')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  INSERT INTO public.app_settings (key, value) VALUES ('display.checklistStreakLength', '12')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  PERFORM pg_temp.ok('guard: other settings and unchanged upserts are allowed', true);
  DELETE FROM public.members WHERE id = 303;  -- no logs (logs.memberId is part of the PK)
  PERFORM pg_temp.ok('guard: other members can be deleted',
    NOT EXISTS (SELECT 1 FROM public.members WHERE id = 303));
  DELETE FROM public.members WHERE id = 304;  -- cascades to several grades
  PERFORM pg_temp.ok('guard: a member''s cascade (several grades) is not a bulk delete',
    NOT EXISTS (SELECT 1 FROM public.member_grades WHERE "memberId" = 304));
  UPDATE public.members SET email = 'neue.adresse@example.com' WHERE id = 202;
  INSERT INTO public.members (id, firstname, lastname, email)
  VALUES (991, 'Neues', 'Mitglied', 'neues.mitglied@example.com');
  PERFORM pg_temp.ok('guard: ordinary member e-mails may be set', true);
  -- one plan session cleared (the app deletes an emptied session), a few at once
  DELETE FROM public.training_plan_sessions
  WHERE id = (SELECT min(id) FROM public.training_plan_sessions);
  DELETE FROM public.training_plan_sessions
  WHERE id IN (SELECT id FROM public.training_plan_sessions ORDER BY id DESC LIMIT 5);
  DELETE FROM public.training_plan_breaks
  WHERE id = (SELECT max(id) FROM public.training_plan_breaks);
  DELETE FROM public.logs
  WHERE ("trainingId", date, "memberId") = (SELECT "trainingId", date, "memberId"
                                            FROM public.logs WHERE "trainerRole" = 'attendee'
                                            ORDER BY date DESC LIMIT 1);
  DELETE FROM public.event_participants
  WHERE ("eventId", "memberId") = (SELECT "eventId", "memberId" FROM public.event_participants
                                   ORDER BY "eventId", "memberId" LIMIT 1);
  PERFORM pg_temp.ok('guard: single deletes (plan, holiday, log, registration) still work', true);
  -- a visitor's own event with several registrations can be deleted like in the app
  INSERT INTO public.events (id, title, date) VALUES (9001, 'Eigener Anlass', '2030-01-05');
  INSERT INTO public.event_participants ("eventId", "memberId")
  VALUES (9001, 201), (9001, 202), (9001, 203);
  DELETE FROM public.event_participants WHERE "eventId" = 9001;
  DELETE FROM public.events WHERE id = 9001;
  PERFORM pg_temp.ok('guard: a visitor''s own event can be deleted',
    NOT EXISTS (SELECT 1 FROM public.events WHERE id = 9001));
END $$;

-- The trainer records attendance and removes it again (set_attendance
-- deletes one log)
DO $$
DECLARE
  v_log record;
BEGIN
  SELECT * INTO v_log FROM public.logs
  WHERE "trainingId" = 1 AND "trainerRole" = 'attendee' ORDER BY date DESC LIMIT 1;
  PERFORM pg_temp.act_as('d3e40000-0000-4000-8000-000000000002');
  PERFORM public.set_attendance(v_log.date, v_log."trainingId", v_log."memberId", false,
                                'attendee');
  PERFORM public.set_attendance(v_log.date, v_log."trainingId", v_log."memberId", true,
                                'attendee');
  RESET ROLE;
  PERFORM pg_temp.ok('trainer: set_attendance still removes and adds a log',
    EXISTS (SELECT 1 FROM public.logs WHERE date = v_log.date
              AND "trainingId" = v_log."trainingId" AND "memberId" = v_log."memberId"));
END $$;

-- The trainer plans Judo Jugend (a date's topic and trainer, a new date
-- cancelled, then cleared again), but not another training or the holidays
DO $$
DECLARE
  v_session record;
  v_other record;
  v_date text;
  v_n bigint;
  v_breaks text := (SELECT string_agg(id || ':' || cancels_training, ',' ORDER BY id)
                    FROM public.training_plan_breaks);
BEGIN
  SELECT * INTO v_session FROM public.training_plan_sessions
  WHERE training_id = 2 AND date >= to_char(current_date, 'YYYY-MM-DD') ORDER BY date LIMIT 1;
  SELECT * INTO v_other FROM public.training_plan_sessions
  WHERE training_id = 3 AND date >= to_char(current_date, 'YYYY-MM-DD') ORDER BY date LIMIT 1;
  -- a Monday of Judo Jugend without a session yet
  SELECT to_char(d, 'YYYY-MM-DD') INTO v_date
  FROM generate_series(current_date + 7, current_date + 400, interval '1 day') d
  WHERE extract(isodow FROM d) = 1
    AND NOT EXISTS (SELECT 1 FROM public.training_plan_sessions s
                    WHERE s.training_id = 2 AND s.date = to_char(d, 'YYYY-MM-DD'))
  ORDER BY d LIMIT 1;

  PERFORM pg_temp.act_as('d3e40000-0000-4000-8000-000000000002');
  UPDATE public.training_plan_sessions SET topic = 'Ippon-seoi-nage', trainer_id = 110
  WHERE id = v_session.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO public.training_plan_sessions (training_id, date, notes, cancelled)
  VALUES (2, v_date, 'Fällt aus: Trainerweiterbildung', true)
  ON CONFLICT (training_id, date) DO UPDATE SET notes = EXCLUDED.notes,
                                                cancelled = EXCLUDED.cancelled;
  DELETE FROM public.training_plan_sessions WHERE training_id = 2 AND date = v_date;
  UPDATE public.training_plan_sessions SET topic = 'Fremdes Thema' WHERE id = v_other.id;
  UPDATE public.training_plan_breaks SET cancels_training = NOT cancels_training;
  RESET ROLE;
  PERFORM pg_temp.eq('trainer: plans a date of Judo Jugend',
    v_n || ' ' || (SELECT topic || ' ' || trainer_id FROM public.training_plan_sessions
                   WHERE id = v_session.id), '1 Ippon-seoi-nage 110');
  PERFORM pg_temp.ok('trainer: adds and clears a date of Judo Jugend',
    v_date IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.training_plan_sessions
                                       WHERE training_id = 2 AND date = v_date));
  PERFORM pg_temp.eq('trainer: leaves the other trainings and the holidays alone',
    (SELECT coalesce(topic, '-') FROM public.training_plan_sessions WHERE id = v_other.id)
    || ' ' || (SELECT string_agg(id || ':' || cancels_training, ',' ORDER BY id)
               FROM public.training_plan_breaks),
    coalesce(v_other.topic, '-') || ' ' || v_breaks);
END $$;
SELECT pg_temp.raises('trainer: cannot add a date to a training he does not plan',
  $$SELECT pg_temp.act_as('d3e40000-0000-4000-8000-000000000002');
    INSERT INTO public.training_plan_sessions (training_id, date, topic)
    VALUES (3, '2099-01-06', 'x')$$,
  'new row violates row-level security policy%');
RESET ROLE;

-- The member flow, as the member account: register Lena for the upcoming
-- exam, withdraw, register again; the same for Jonas' seeded registration
DO $$
DECLARE
  v_exam bigint;
  v_grade text;
  v_id bigint;
  v_jonas bigint;
  v_jonas_grade text;
BEGIN
  SELECT id INTO v_exam FROM public.exams
  WHERE registration_deadline >= to_char(current_date, 'YYYY-MM-DD');
  SELECT g.grade INTO v_grade FROM public.grade_definitions g
  WHERE g.section = 'Judo' AND NOT g."isDan"
    AND g."gradeRank" > (SELECT max(gd."gradeRank") FROM public.member_grades mg
                         JOIN public.grade_definitions gd
                           ON gd.section = mg.section AND gd.grade = mg.grade
                         WHERE mg."memberId" = 120 AND mg.section = 'Judo')
  ORDER BY g."gradeRank" LIMIT 1;
  SELECT id, grade INTO v_jonas, v_jonas_grade
  FROM public.exam_candidates WHERE exam_id = v_exam AND member_id = 150;

  PERFORM pg_temp.act_as('d3e40000-0000-4000-8000-000000000003');
  v_id := public.register_for_exam(v_exam, 120, v_grade);
  PERFORM public.withdraw_exam_registration(v_id);
  v_id := public.register_for_exam(v_exam, 120, v_grade);
  PERFORM public.withdraw_exam_registration(v_jonas);
  PERFORM public.register_for_exam(v_exam, 150, v_jonas_grade);
  RESET ROLE;
  PERFORM pg_temp.eq('member: register, withdraw and register again',
    (SELECT string_agg(member_id || ':' || status, ',' ORDER BY member_id)
     FROM public.exam_candidates WHERE exam_id = v_exam AND member_id IN (120, 150)),
    '120:registered,150:registered');
END $$;

ROLLBACK;

\o
\echo 'demo_seed: all checks passed'
