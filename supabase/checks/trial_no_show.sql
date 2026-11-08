-- Checks for trial candidates who do not show up and who confirm they come
-- (20261114120000_trial_no_show_and_confirmation.sql, docs/TRIAL_EMAILS.md).
--
-- Runs on a database with every migration and the seed, as postgres, inside
-- one transaction that is rolled back. A failed check raises and stops:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/checks/trial_no_show.sql
--
--   R  removing from a check-in list: last training 'no_show', another one
--      left 'assigned', a member is not touched, viewers cannot
--   U  unassigning in the trial overview (plain DELETE) still means 'new'
--   C  confirming through the status link: only while assigned, kept on
--      a second training, cleared by any status change; anon reaches it

\set ON_ERROR_STOP 1
\o /dev/null
SET client_min_messages = notice;

BEGIN;

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

CREATE FUNCTION pg_temp.status(p_id integer) RETURNS text
LANGUAGE sql AS $$ SELECT "trialStatus" FROM public.members WHERE id = p_id $$;

-- Two trainings, a trainer, a viewer, three candidates and a member
SELECT pg_temp.sign_up('00000000-0000-0000-0000-00000000a701', 'trainer.noshow@example.invalid', 'trainer');
SELECT pg_temp.sign_up('00000000-0000-0000-0000-00000000a702', 'viewer.noshow@example.invalid', 'viewer');

INSERT INTO public.trainings (id, title, weekday, "dateFrom", "dateTo", section)
VALUES (9701, 'Check Kinder', 'Friday', '17:30', '18:30', 'Judo'),
       (9702, 'Check Jugend', 'Tuesday', '18:30', '19:45', 'Judo');

INSERT INTO public.members (id, firstname, lastname, labels, "trialRegisteredAt")
VALUES (970101, 'Nora', 'Noshow', '["probetraining"]', now()),
       (970102, 'Tim', 'Twotrainings', '["probetraining"]', now()),
       (970103, 'Ula', 'Unassigned', '["probetraining"]', now());
INSERT INTO public.members (id, firstname, lastname, labels)
VALUES (970104, 'Max', 'Member', '[]');

INSERT INTO public.participants ("trainingId", "memberId")
VALUES (9701, 970101), (9701, 970102), (9702, 970102), (9701, 970103), (9701, 970104);

SELECT pg_temp.eq('assigning makes a candidate assigned', pg_temp.status(970101), 'assigned');

-----------------
-- R  removing from a check-in list
-----------------
SAVEPOINT r;
DO $$
BEGIN
  PERFORM pg_temp.act_as('00000000-0000-0000-0000-00000000a702');
  PERFORM public.remove_trial_participant(9701, 970101);
  RESET ROLE;
  PERFORM pg_temp.eq('a viewer removes nothing',
    (SELECT count(*)::text FROM public.participants WHERE "memberId" = 970101), '1');
  PERFORM pg_temp.eq('and the status stays', pg_temp.status(970101), 'assigned');

  PERFORM pg_temp.act_as('00000000-0000-0000-0000-00000000a701');
  PERFORM pg_temp.eq('last training removed: no show',
    public.remove_trial_participant(9701, 970101), 'no_show');
  PERFORM pg_temp.eq('another training left: still assigned',
    public.remove_trial_participant(9701, 970102), 'assigned');
  PERFORM pg_temp.ok('a member has no trial status',
    public.remove_trial_participant(9701, 970104) IS NULL);
  RESET ROLE;
  PERFORM pg_temp.eq('the member is out of the training',
    (SELECT count(*)::text FROM public.participants WHERE "memberId" = 970104), '0');
  PERFORM pg_temp.eq('the no-show is stored', pg_temp.status(970101), 'no_show');

  -- Assigning again takes the candidate out of no show
  INSERT INTO public.participants ("trainingId", "memberId") VALUES (9702, 970101);
  PERFORM pg_temp.eq('assigned again', pg_temp.status(970101), 'assigned');
END $$;
ROLLBACK TO SAVEPOINT r;

-----------------
-- U  unassigning in the trial overview
-----------------
SAVEPOINT u;
DO $$
BEGIN
  PERFORM pg_temp.act_as('00000000-0000-0000-0000-00000000a701');
  DELETE FROM public.participants WHERE "trainingId" = 9701 AND "memberId" = 970103;
  RESET ROLE;
  PERFORM pg_temp.eq('unassigned: new again', pg_temp.status(970103), 'new');
END $$;
ROLLBACK TO SAVEPOINT u;

-----------------
-- C  confirming through the status link
-----------------
SAVEPOINT c;
DO $$
DECLARE
  v_token uuid := (SELECT "trialToken" FROM public.members WHERE id = 970101);
  v_new uuid := (SELECT "trialToken" FROM public.members WHERE id = 970103);
BEGIN
  PERFORM pg_temp.ok('nobody has confirmed yet',
    (public.get_trial_status(v_token)->'confirmedAt') = 'null'::jsonb);

  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  PERFORM pg_temp.ok('a wrong token confirms nothing', NOT public.confirm_trial(gen_random_uuid()));
  PERFORM pg_temp.ok('no token confirms nothing', NOT public.confirm_trial(NULL));
  PERFORM pg_temp.ok('the candidate confirms', public.confirm_trial(v_token));
  PERFORM pg_temp.ok('the status page shows it',
    (public.get_trial_status(v_token)->>'confirmedAt') IS NOT NULL);
  RESET ROLE;

  UPDATE public.members SET "trialConfirmedAt" = '2026-01-01T00:00:00Z' WHERE id = 970101;
  PERFORM public.confirm_trial(v_token);
  PERFORM pg_temp.eq('confirming twice keeps the first time',
    (SELECT "trialConfirmedAt"::date::text FROM public.members WHERE id = 970101), '2026-01-01');

  INSERT INTO public.participants ("trainingId", "memberId") VALUES (9702, 970101);
  PERFORM pg_temp.ok('a second training keeps the confirmation',
    (SELECT "trialConfirmedAt" IS NOT NULL FROM public.members WHERE id = 970101));

  DELETE FROM public.participants WHERE "memberId" = 970101;
  PERFORM pg_temp.ok('a status change clears it',
    (SELECT "trialConfirmedAt" IS NULL FROM public.members WHERE id = 970101));

  DELETE FROM public.participants WHERE "memberId" = 970103;
  PERFORM pg_temp.ok('only an assigned candidate confirms', NOT public.confirm_trial(v_new));
END $$;
ROLLBACK TO SAVEPOINT c;

ROLLBACK;

\o
\echo 'trial_no_show: all checks passed'
