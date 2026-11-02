-- Checks for the API keys and the public training plan
-- (20261110120000_api_keys.sql, docs/API.md).
--
-- Runs like calendar_feeds.sql: on a database with every migration and the
-- seed, as postgres, inside one transaction that is rolled back; each
-- scenario sits in a savepoint. A failed check raises and stops:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/checks/api_keys.sql
--
--   K  keys: admins create, read, change and delete them; nobody else, and
--      nobody reads the hash; the database checks scopes and origins
--   P  privileges: what anon and signed-in accounts may call
--   F  the plan for a key: only the plan's trainings, the sessions and
--      holidays of the period, no notes, names as the key says
--   N  no plan: unknown, malformed or deleted key, a key without the scope;
--      a bad period is refused

\set ON_ERROR_STOP 1
\o /dev/null
SET client_min_messages = notice;

BEGIN;

-----------------
-- Helpers (as in calendar_feeds.sql)
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

CREATE FUNCTION pg_temp.act_as(p_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
END $$;

CREATE FUNCTION pg_temp.as_anon() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role": "anon"}', true);
  SET LOCAL ROLE anon;
END $$;

-- A new key, created by the admin; returns the plaintext
CREATE FUNCTION pg_temp.new_key(p_name text, p_scopes text[], p_origins text[] DEFAULT '{}',
                                p_names text DEFAULT 'full') RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v jsonb;
BEGIN
  PERFORM pg_temp.act_as('30000000-0000-4000-8000-000000000003');
  v := public.api_key_create(p_name, p_scopes, p_origins, p_names);
  RESET ROLE;
  RETURN v->>'key';
END $$;

-- The plan as the website's server fetches it (the anon key)
CREATE FUNCTION pg_temp.plan(p_key text, p_from integer DEFAULT 0, p_to integer DEFAULT 60)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v jsonb;
BEGIN
  PERFORM pg_temp.as_anon();
  v := public.api_training_plan(p_key, current_date + p_from, current_date + p_to);
  RESET ROLE;
  RETURN v;
END $$;

CREATE FUNCTION pg_temp.d(p_day integer) RETURNS text
LANGUAGE sql AS $$ SELECT to_char(current_date + p_day, 'YYYY-MM-DD') $$;

CREATE FUNCTION pg_temp.list(p_plan jsonb, p_key text, p_field text) RETURNS text
LANGUAGE sql AS $$
  SELECT string_agg(e->>p_field, ',' ORDER BY e->>p_field COLLATE "C") FROM jsonb_array_elements(p_plan->p_key) e;
$$;

CREATE FUNCTION pg_temp.keys(p_obj jsonb) RETURNS text
LANGUAGE sql AS $$
  SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(p_obj) k;
$$;

-----------------
-- Test data
-----------------

-- Only this check's plan (the seed may have one)
DELETE FROM public.training_plan_sessions;
DELETE FROM public.training_plan_trainings;
DELETE FROM public.training_plan_breaks;

SELECT pg_temp.sign_up('30000000-0000-4000-8000-000000000001', 'api.trainer@test.ch', 'approved', 'trainer');
SELECT pg_temp.sign_up('30000000-0000-4000-8000-000000000002', 'api.viewer@test.ch', 'approved', 'viewer');
SELECT pg_temp.sign_up('30000000-0000-4000-8000-000000000003', 'api.admin@test.ch', 'approved', 'admin');
SELECT pg_temp.sign_up('30000000-0000-4000-8000-000000000004', 'api.member@test.ch', 'approved', 'member');

INSERT INTO public.members (id, firstname, lastname, labels, email) VALUES
  (961, 'Anna', 'Muster', '[]', 'anna@test.ch'),
  (962, 'Beni', ' Beispiel ', '[]', NULL),
  (963, 'Otto', 'Ausserhalb', '[]', NULL),
  (964, 'Fritz', 'Fremd', '[]', NULL);

INSERT INTO public.trainings (id, title, weekday, "dateFrom", "dateTo", section, "mainTrainerId") VALUES
  (961, 'API Check', 'Tuesday', '18.00', '19.30', 'Judo', 961),
  (962, 'Nicht im Plan', 'Thursday', '18:00', '19:30', 'Judo', 964);
INSERT INTO public.training_plan_trainings (training_id) VALUES (961);

INSERT INTO public.training_plan_sessions (training_id, date, trainer_id, topic, notes, cancelled) VALUES
  (961, pg_temp.d(-1), 963, 'Vorher', NULL, NULL),
  (961, pg_temp.d(0), 962, 'Erster Tag', 'intern: Halle', NULL),
  (961, pg_temp.d(7), NULL, NULL, 'GV', true),
  (961, pg_temp.d(60), 962, 'Letzter Tag', NULL, false),
  (961, pg_temp.d(61), 963, 'Danach', NULL, NULL),
  (962, pg_temp.d(7), 964, 'Nicht im Plan', NULL, NULL);

INSERT INTO public.training_plan_breaks (title, date_from, date_to, cancels_training) VALUES
  ('zz vorbei', pg_temp.d(-20), pg_temp.d(-1), true),
  ('zz Ferien', pg_temp.d(20), pg_temp.d(30), false),
  ('zz beginnt am Rand', pg_temp.d(60), pg_temp.d(70), true),
  ('zz zu weit', pg_temp.d(61), pg_temp.d(70), true);

-----------------
-- K Keys
-----------------

SAVEPOINT s;
DO $$
DECLARE
  k text;
  v_id uuid;
BEGIN
  k := pg_temp.new_key(' Webseite ', ARRAY['training_plan:read'], ARRAY['https://www.jtc.ch']);
  PERFORM pg_temp.ok('K1 a key is alleda_ and 48 hex characters', k ~ '^alleda_[0-9a-f]{48}$');
  SELECT id INTO v_id FROM public.api_keys WHERE name = 'Webseite';
  PERFORM pg_temp.eq('K1 stored with name trimmed, prefix, the hash only, who made it',
    (SELECT prefix || ' ' || (key_hash = encode(extensions.digest(k, 'sha256'), 'hex'))::text
            || ' ' || created_by::text || ' ' || (last_used_at IS NULL)::text
     FROM public.api_keys WHERE id = v_id),
    substr(k, 8, 8) || ' true 30000000-0000-4000-8000-000000000003 true');
  PERFORM pg_temp.ok('K1 the plaintext is stored nowhere',
    NOT EXISTS (SELECT 1 FROM public.api_keys a WHERE a::text LIKE '%' || substr(k, 8) || '%'));
  PERFORM pg_temp.ok('K1 two keys differ',
    pg_temp.new_key('Zweiter', ARRAY['training_plan:read']) <> k);

  -- Admins read (without the hash), change and delete
  PERFORM pg_temp.act_as('30000000-0000-4000-8000-000000000003');
  PERFORM pg_temp.eq('K2 admins list the keys',
    (SELECT string_agg(name, ',' ORDER BY name) FROM public.api_keys), 'Webseite,Zweiter');
  PERFORM pg_temp.eq('K2 but never the hash',
    pg_temp.state('SELECT key_hash FROM public.api_keys'), '42501');
  PERFORM pg_temp.eq('K2 nor change it',
    pg_temp.state($q$UPDATE public.api_keys SET key_hash = repeat('0', 64)$q$), '42501');
  PERFORM pg_temp.eq('K2 nor insert a key of their own',
    pg_temp.state($q$INSERT INTO public.api_keys (name, prefix, key_hash) VALUES ('x', '00000000', repeat('0', 64))$q$),
    '42501');
  UPDATE public.api_keys SET allowed_origins = ARRAY['https://jtc.ch'], trainer_names = 'initial'
   WHERE id = v_id;
  PERFORM pg_temp.eq('K2 admins change origins and names',
    (SELECT allowed_origins::text || trainer_names FROM public.api_keys WHERE id = v_id),
    '{https://jtc.ch}initial');
  PERFORM pg_temp.eq('K3 an unknown scope is refused',
    pg_temp.state($q$UPDATE public.api_keys SET scopes = ARRAY['members:read']$q$), '23514');
  PERFORM pg_temp.eq('K3 an origin with a path is refused',
    pg_temp.state($q$UPDATE public.api_keys SET allowed_origins = ARRAY['https://jtc.ch/']$q$), '23514');
  PERFORM pg_temp.eq('K3 a wildcard is refused',
    pg_temp.state($q$UPDATE public.api_keys SET allowed_origins = ARRAY['*']$q$), '23514');
  PERFORM pg_temp.eq('K3 an unknown name mode is refused',
    pg_temp.state($q$SELECT public.api_key_create('x', ARRAY['training_plan:read'], '{}', 'nick')$q$),
    '23514');
  DELETE FROM public.api_keys WHERE id = v_id;
  RESET ROLE;
  PERFORM pg_temp.ok('K2 admins delete keys', NOT EXISTS (SELECT 1 FROM public.api_keys WHERE id = v_id));

  -- Nobody else
  PERFORM pg_temp.act_as('30000000-0000-4000-8000-000000000001');
  PERFORM pg_temp.eq('K4 a trainer cannot create a key',
    pg_temp.state($q$SELECT public.api_key_create('x', ARRAY['training_plan:read'])$q$), '42501');
  PERFORM pg_temp.eq('K4 nor sees any',
    (SELECT count(*)::text FROM public.api_keys), '0');
  DELETE FROM public.api_keys;
  RESET ROLE;
  PERFORM pg_temp.eq('K4 nor deletes any', (SELECT count(*)::text FROM public.api_keys), '1');
  PERFORM pg_temp.act_as('30000000-0000-4000-8000-000000000004');
  PERFORM pg_temp.eq('K4 a member account cannot create a key',
    pg_temp.state($q$SELECT public.api_key_create('x', ARRAY['training_plan:read'])$q$), '42501');
  RESET ROLE;
  PERFORM pg_temp.as_anon();
  PERFORM pg_temp.eq('K4 anon reads no keys',
    pg_temp.state('SELECT id FROM public.api_keys'), '42501');
  RESET ROLE;
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- P Privileges
-----------------

SELECT pg_temp.ok('P1 anon and signed-in accounts may ask for the plan',
  has_function_privilege('anon', 'public.api_training_plan(text, date, date)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.api_training_plan(text, date, date)', 'EXECUTE'));
SELECT pg_temp.ok('P2 api_key_use is internal', NOT (
     has_function_privilege('anon', 'public.api_key_use(text, text)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'public.api_key_use(text, text)', 'EXECUTE')));
SELECT pg_temp.ok('P3 only signed-in accounts reach api_key_create (it checks is_admin)',
  NOT has_function_privilege('anon', 'public.api_key_create(text, text[], text[], text)', 'EXECUTE'));

-----------------
-- F The plan for a key
-----------------

SAVEPOINT s;
DO $$
DECLARE
  k text := pg_temp.new_key('Voll', ARRAY['training_plan:read'], ARRAY['https://www.jtc.ch']);
  p jsonb;
BEGIN
  p := pg_temp.plan(k);
  PERFORM pg_temp.eq('F1 the answer''s parts',
    pg_temp.keys(p), 'allowed_origins,breaks,sessions,trainers,trainings');
  PERFORM pg_temp.eq('F1 the key''s origins', p->>'allowed_origins', '["https://www.jtc.ch"]');
  PERFORM pg_temp.eq('F2 only planned trainings', pg_temp.list(p, 'trainings', 'id'), '961');
  PERFORM pg_temp.eq('F2 a training''s fields',
    pg_temp.keys(p->'trainings'->0), 'dateFrom,dateTo,id,mainTrainerId,section,title,weekday');
  PERFORM pg_temp.eq('F3 sessions of the period only, of planned trainings',
    pg_temp.list(p, 'sessions', 'topic'), 'Erster Tag,Letzter Tag');
  PERFORM pg_temp.eq('F3 the cancelled one too', (
    SELECT count(*)::text FROM jsonb_array_elements(p->'sessions') e WHERE (e->>'cancelled')::boolean),
    '1');
  PERFORM pg_temp.eq('F4 no notes, no timestamps',
    pg_temp.keys(p->'sessions'->0), 'cancelled,date,id,topic,trainer_id,training_id');
  PERFORM pg_temp.ok('F4 the notes are nowhere in the answer',
    p::text NOT LIKE '%intern%' AND p::text NOT LIKE '%GV%');
  PERFORM pg_temp.eq('F5 holidays overlapping the period',
    pg_temp.list(p, 'breaks', 'title'), 'zz Ferien,zz beginnt am Rand');
  PERFORM pg_temp.eq('F6 the trainers of the period and the main trainer, full names',
    pg_temp.list(p, 'trainers', 'name'), 'Anna Muster,Beni Beispiel');
  PERFORM pg_temp.eq('F6 only id and name', pg_temp.keys(p->'trainers'->0), 'id,name');
  PERFORM pg_temp.ok('F6 no e-mail', p::text NOT LIKE '%@%');
  PERFORM pg_temp.ok('F7 the use is noted',
    (SELECT last_used_at = now() FROM public.api_keys WHERE name = 'Voll'));

  UPDATE public.api_keys SET trainer_names = 'initial';
  p := pg_temp.plan(k);
  PERFORM pg_temp.eq('F8 first name and initial',
    pg_temp.list(p, 'trainers', 'name'), 'Anna M.,Beni B.');

  UPDATE public.api_keys SET trainer_names = 'none';
  p := pg_temp.plan(k);
  PERFORM pg_temp.eq('F9 no names: no trainers', p->>'trainers', '[]');
  PERFORM pg_temp.ok('F9 and no ids to look them up',
    p->'trainings'->0->'mainTrainerId' = 'null'::jsonb
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p->'sessions') e
                    WHERE e->'trainer_id' <> 'null'::jsonb));

  -- A signed-in browser on the app's own origin gets the same
  PERFORM pg_temp.act_as('30000000-0000-4000-8000-000000000002');
  PERFORM pg_temp.ok('F10 as authenticated',
    public.api_training_plan(k, current_date, current_date + 60) IS NOT NULL);
  RESET ROLE;
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- N No plan
-----------------

SAVEPOINT s;
DO $$
DECLARE
  k text := pg_temp.new_key('Webseite', ARRAY['training_plan:read']);
  k2 text := pg_temp.new_key('Ohne Rechte', '{}');
BEGIN
  PERFORM pg_temp.ok('N1 a valid key works', pg_temp.plan(k) IS NOT NULL);
  PERFORM pg_temp.ok('N1 an unknown key: null',
    pg_temp.plan('alleda_' || repeat('0', 48)) IS NULL);
  PERFORM pg_temp.ok('N1 a malformed key: null',
    pg_temp.plan(substr(k, 1, 40)) IS NULL AND pg_temp.plan(NULL) IS NULL
    AND pg_temp.plan(upper(k)) IS NULL AND pg_temp.plan('') IS NULL);
  PERFORM pg_temp.ok('N1 the hash is no key', pg_temp.plan(
    (SELECT key_hash FROM public.api_keys WHERE name = 'Webseite')) IS NULL);
  PERFORM pg_temp.ok('N2 a key without the scope: null', pg_temp.plan(k2) IS NULL);
  PERFORM pg_temp.ok('N2 its use is not noted',
    (SELECT last_used_at IS NULL FROM public.api_keys WHERE name = 'Ohne Rechte'));

  PERFORM pg_temp.as_anon();
  PERFORM pg_temp.eq('N3 to before from is refused',
    pg_temp.state(format('SELECT public.api_training_plan(%L, current_date, current_date - 1)', k)),
    '22023');
  PERFORM pg_temp.eq('N3 more than 400 days are refused',
    pg_temp.state(format('SELECT public.api_training_plan(%L, current_date, current_date + 401)', k)),
    '22023');
  PERFORM pg_temp.eq('N3 400 days are fine',
    pg_temp.state(format('SELECT public.api_training_plan(%L, current_date, current_date + 400)', k)),
    '');
  PERFORM pg_temp.eq('N3 an unknown key with a bad period is just null, not an error',
    pg_temp.state($q$SELECT public.api_training_plan('x', current_date, current_date - 1)$q$), '');
  RESET ROLE;

  DELETE FROM public.api_keys WHERE name = 'Webseite';
  PERFORM pg_temp.ok('N4 a deleted key: null at once', pg_temp.plan(k) IS NULL);
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- E An empty plan
-----------------

SAVEPOINT s;
DO $$
DECLARE
  k text := pg_temp.new_key('Leer', ARRAY['training_plan:read']);
BEGIN
  DELETE FROM public.training_plan_trainings;
  DELETE FROM public.training_plan_breaks;
  PERFORM pg_temp.eq('E1 nothing planned: empty arrays', pg_temp.plan(k)::text,
    '{"breaks": [], "sessions": [], "trainers": [], "trainings": [], "allowed_origins": []}');
END $$;
ROLLBACK TO SAVEPOINT s;

ROLLBACK;

\o
\echo 'api_keys: all checks passed'
