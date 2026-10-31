-- Checks for phase 1b: member accounts need an active or passive membership
-- (20261027120000_member_access_requires_membership.sql, docs/INTEGRATIONS.md).
--
-- Runs on a database with every migration and the seed (supabase db start,
-- or a preview branch) as postgres, inside one transaction that is rolled
-- back; each scenario sits in a savepoint. A failed check raises and stops:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/checks/member_access.sql
-- S1 … S27 are the lifecycle cases listed in docs/INTEGRATIONS.md. What
-- member accounts with access see of other members is checked in
-- supabase/checks/member_data.sql.
--
-- Accounts act through the API roles: pg_temp.act_as() sets the JWT claims
-- and SET LOCAL ROLE authenticated; the Webling sync acts as service_role.

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

-- Sign up through Supabase Auth (fires handle_auth_user_change)
CREATE FUNCTION pg_temp.sign_up(p_id uuid, p_email text, p_confirmed boolean DEFAULT true) RETURNS uuid
LANGUAGE sql AS $$
  INSERT INTO auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  VALUES ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
          CASE WHEN p_confirmed THEN now() END, '{}', '{}', now(), now())
  RETURNING id;
$$;

-- A later sign-in (GoTrue updates last_sign_in_at)
CREATE FUNCTION pg_temp.sign_in(p_id uuid) RETURNS void
LANGUAGE sql AS $$
  UPDATE auth.users SET last_sign_in_at = now(), updated_at = now() WHERE id = p_id;
$$;

CREATE FUNCTION pg_temp.st(p_id uuid) RETURNS text
LANGUAGE sql AS $$
  SELECT status || '/' || role FROM public.user_profiles WHERE user_id = p_id;
$$;

-- Act as this account until RESET ROLE (or the savepoint is rolled back)
CREATE FUNCTION pg_temp.act_as(p_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
END $$;

CREATE FUNCTION pg_temp.access() RETURNS text
LANGUAGE sql AS $$
  SELECT has_access || ' ' || member_statuses::text FROM public.my_access();
$$;

-- Everything the current role can read that a member account without access
-- must not see: every table and view in public (except its own profile and
-- the public club settings), the avatars, every STABLE zero-argument RPC
-- (except my_access, which always answers one row) and the RPCs taking a
-- member id. Returns what leaked, '' when nothing did.
CREATE FUNCTION pg_temp.leaks() RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  r record;
  v_call text;
  n bigint;
  v_out text := '';
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'v', 'm', 'p')
      AND has_table_privilege(current_user, c.oid, 'SELECT')
      AND c.relname NOT IN ('user_profiles', 'app_settings')
    ORDER BY 1
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', r.relname) INTO n;
    IF n > 0 THEN v_out := v_out || r.relname || '=' || n || ' '; END IF;
  END LOOP;

  SELECT count(*) INTO n FROM public.user_profiles WHERE user_id IS DISTINCT FROM auth.uid();
  IF n > 0 THEN v_out := v_out || 'other user_profiles=' || n || ' '; END IF;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'avatars';
  IF n > 0 THEN v_out := v_out || 'avatars=' || n || ' '; END IF;

  FOR r IN
    SELECT p.proname FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.pronargs = 0 AND p.proretset AND p.provolatile <> 'v'
      AND has_function_privilege(current_user, p.oid, 'EXECUTE')
      AND p.proname <> 'my_access'
    ORDER BY 1
  LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I()', r.proname) INTO n;
    EXCEPTION WHEN OTHERS THEN n := 0;  -- refusing is fine
    END;
    IF n > 0 THEN v_out := v_out || r.proname || '()=' || n || ' '; END IF;
  END LOOP;

  -- The RPCs that take a member id or a limit
  FOREACH v_call IN ARRAY ARRAY[
    'get_member_badges(103)', 'get_member_current_grades(103)',
    'get_member_badge_progress(103)', 'get_recent_achievements(1000)'
  ] LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%s', v_call) INTO n;
    EXCEPTION WHEN OTHERS THEN n := 0;  -- refusing is fine
    END;
    IF n > 0 THEN v_out := v_out || v_call || '=' || n || ' '; END IF;
  END LOOP;
  RETURN v_out;
END $$;

-- The current account has the club area of a member with access
CREATE FUNCTION pg_temp.member_view() RETURNS text
LANGUAGE sql AS $$
  SELECT public.is_approved_user()
    || ' trainings>0=' || ((SELECT count(*) FROM public.trainings) > 0)
    || ' directory>0=' || ((SELECT count(*) FROM public.get_member_directory()) > 0);
$$;

-- An avatar, so the avatars policy has something to hide (the bucket comes
-- from config.toml, which supabase db start does not apply)
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name) VALUES ('avatars', 'avatars') ON CONFLICT DO NOTHING;
  INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', 'phase1b-check.jpg');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'skip avatars object: %', SQLERRM;
END $$;

-- An open exam a month from now (the seeded ones close as time passes)
INSERT INTO public.exams (id, section, title, date, registration_deadline)
VALUES (990001, 'Judo', 'Phase 1b check', to_char(current_date + 30, 'YYYY-MM-DD'), to_char(current_date + 20, 'YYYY-MM-DD'));


-- Members the scenarios use: app ids below 1'000 count as created in
-- Alleda, ids from 5'001 lie in the Webling range
INSERT INTO public.members (id, firstname, lastname, labels, email) VALUES
  (901, 'Anna', 'Aktiv', '[]', '  Anna.Aktiv@Test.CH '),
  (902, 'Paul', 'Passiv', '["Ehrenmitglieder"]', 'paul@test.ch');

-----------------
-- Seed: member@example.com, parent of two active app members (103, 107)
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_member uuid := 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
  v_listed integer[];
BEGIN
  PERFORM pg_temp.eq('seed: member account approved', pg_temp.st(v_member), 'approved/member');
  PERFORM pg_temp.act_as(v_member);
  PERFORM pg_temp.eq('seed: club access', pg_temp.member_view(), 'true trainings>0=true directory>0=true');
  PERFORM pg_temp.eq('seed: both children', (SELECT string_agg(x::text, ',' ORDER BY x) FROM public.my_member_ids() x), '103,107');
  PERFORM pg_temp.eq('seed: my_access', pg_temp.access(), 'true {active}');
  v_listed := ARRAY(SELECT id FROM public.get_member_directory() WHERE NOT "isMine");
  RESET ROLE;
  PERFORM pg_temp.ok('directory lists members who trained', cardinality(v_listed) > 0);
  PERFORM pg_temp.ok('directory lists only members that count (A2)', NOT EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.id = ANY (v_listed)
      AND NOT public.member_grants_access(m.membership_status, m."archivedAt", m.labels)));
  PERFORM pg_temp.ok('directory hides recent trainees that do not count', EXISTS (
    SELECT 1 FROM public.logs l JOIN public.members m ON m.id = l."memberId"
    WHERE m.membership_status IN ('non_member', 'left')
      AND l.date >= to_char((SELECT max(date)::date - 365 FROM public.logs), 'YYYY-MM-DD')));
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- S1, S23: sign-up with the e-mail of an active or passive member
-----------------

SAVEPOINT s;
DO $$
DECLARE
  u1 uuid := pg_temp.sign_up('10000000-0000-4000-8000-000000000001', 'anna.aktiv@test.ch');
  u2 uuid := pg_temp.sign_up('10000000-0000-4000-8000-000000000002', 'paul@test.ch');
  u3 uuid;
BEGIN
  PERFORM pg_temp.eq('S1 active, case and spaces ignored: approved', pg_temp.st(u1), 'approved/member');
  PERFORM pg_temp.eq('S1 passive (Ehrenmitglieder): approved', pg_temp.st(u2), 'approved/member');
  PERFORM pg_temp.act_as(u1);
  PERFORM pg_temp.eq('S1 club access', pg_temp.member_view(), 'true trainings>0=true directory>0=true');
  PERFORM pg_temp.eq('S1 my_access', pg_temp.access(), 'true {active}');
  RESET ROLE;
  -- Tab or no-break space around the address: no match (fails closed)
  INSERT INTO public.members (id, firstname, lastname, labels, email)
  VALUES (903, 'Nora', 'Nbsp', '[]', 'nbsp@test.ch' || chr(160));
  u3 := pg_temp.sign_up('10000000-0000-4000-8000-000000000003', 'nbsp@test.ch');
  PERFORM pg_temp.eq('S23 no-break space: waits', pg_temp.st(u3), 'pending/member');
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- S2, S3, S4, S27: sign-ups whose records do not count wait as 'member'
-----------------

SAVEPOINT s;
DO $$
DECLARE
  u uuid;
BEGIN
  INSERT INTO public.members (id, firstname, lastname, labels, email) VALUES
    (904, 'Nina', 'Nicht', '["Nicht-Mitglieder"]', 'nina@test.ch'),
    (905, 'Leo', 'Left', '["Aktiv", "03_Austritt"]', 'leo@test.ch'),
    (906, 'Una', 'Confirmed', '[]', 'unconfirmed@test.ch');

  u := pg_temp.sign_up('10000000-0000-4000-8000-000000000004', 'nina@test.ch');
  PERFORM pg_temp.eq('S2 non-member: waits as member', pg_temp.st(u), 'pending/member');
  PERFORM pg_temp.act_as(u);
  PERFORM pg_temp.eq('S2 my_access', pg_temp.access(), 'false {non_member}');
  PERFORM pg_temp.eq('S2 sees nothing', pg_temp.leaks(), '');
  RESET ROLE;
  UPDATE public.members SET labels = '["Aktiv"]' WHERE id = 904;
  PERFORM pg_temp.eq('S2 turns Aktiv: approved by the trigger', pg_temp.st(u), 'approved/member');
  PERFORM pg_temp.act_as(u);
  PERFORM pg_temp.eq('S2 then has club access', pg_temp.member_view(), 'true trainings>0=true directory>0=true');
  RESET ROLE;

  u := pg_temp.sign_up('10000000-0000-4000-8000-000000000005', 'leo@test.ch');
  PERFORM pg_temp.eq('S3 left (03_Austritt wins over Aktiv): waits', pg_temp.st(u), 'pending/member');
  PERFORM pg_temp.act_as(u);
  PERFORM pg_temp.eq('S3 my_access', pg_temp.access(), 'false {left}');
  RESET ROLE;

  -- App trial candidate from the seed (195, lara.meier@example.com)
  u := pg_temp.sign_up('10000000-0000-4000-8000-000000000006', 'lara.meier@example.com');
  PERFORM pg_temp.eq('S4 trial candidate: waits', pg_temp.st(u), 'pending/member');
  PERFORM pg_temp.sign_in(u);
  PERFORM pg_temp.eq('S4 signing in again changes nothing', pg_temp.st(u), 'pending/member');
  PERFORM pg_temp.act_as(u);
  PERFORM pg_temp.eq('S4 my_access', pg_temp.access(), 'false {trial}');
  PERFORM pg_temp.eq('S4 sees nothing', pg_temp.leaks(), '');
  RESET ROLE;

  u := pg_temp.sign_up('10000000-0000-4000-8000-000000000007', 'unconfirmed@test.ch', false);
  PERFORM pg_temp.eq('S27 unconfirmed e-mail: waits', pg_temp.st(u), 'pending/member');
  PERFORM pg_temp.act_as(u);
  PERFORM pg_temp.eq('S27 unconfirmed: my_access reveals no member', pg_temp.access(), 'false {}');
  RESET ROLE;
  UPDATE auth.users SET email_confirmed_at = now() WHERE id = u;
  PERFORM pg_temp.act_as(u);
  PERFORM pg_temp.eq('S27 confirmed: my_access', pg_temp.access(), 'true {active}');
  RESET ROLE;
  PERFORM pg_temp.eq('S27 confirmed: approved', pg_temp.st(u), 'approved/member');
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- S4 legacy Webling Probetraining, S5 no match, link revival, S6 mixed
-----------------

SAVEPOINT s;
DO $$
DECLARE
  u uuid;
BEGIN
  SET LOCAL ROLE service_role;
  INSERT INTO public.members (id, firstname, lastname, labels, email) VALUES
    (5002, 'Pia', 'Legacy', '["Probetraining"]', 'pia@test.ch'),
    (5003, 'Ben', 'Back', '["Aktiv"]', 'ben@test.ch');
  INSERT INTO public.member_links (connection, external_id, member_id, last_seen_at, gone_at) VALUES
    ('webling', '5002', 5002, now(), NULL),
    ('webling', '5003', 5003, now(), now());
  RESET ROLE;

  u := pg_temp.sign_up('10000000-0000-4000-8000-000000000008', 'pia@test.ch');
  PERFORM pg_temp.eq('S4 legacy Probetraining (non-member): waits', pg_temp.st(u), 'pending/member');

  u := pg_temp.sign_up('10000000-0000-4000-8000-000000000009', 'nobody@test.ch');
  PERFORM pg_temp.eq('S5 no match: waits', pg_temp.st(u), 'pending/member');
  PERFORM pg_temp.act_as(u);
  PERFORM pg_temp.eq('S5 my_access', pg_temp.access(), 'false {}');
  RESET ROLE;
  UPDATE public.members SET email = 'Nobody@Test.ch' WHERE id = 110;  -- trainer adds it
  PERFORM pg_temp.eq('S5 e-mail added to an active member: approved', pg_temp.st(u), 'approved/member');

  u := pg_temp.sign_up('10000000-0000-4000-8000-000000000010', 'ben@test.ch');
  PERFORM pg_temp.eq('S5 member gone from Webling: waits', pg_temp.st(u), 'pending/member');
  SET LOCAL ROLE service_role;
  UPDATE public.member_links SET gone_at = NULL, last_seen_at = now() WHERE member_id = 5003;
  RESET ROLE;
  PERFORM pg_temp.eq('S5 link revived by the sync: approved at once', pg_temp.st(u), 'approved/member');

  INSERT INTO public.members (id, firstname, lastname, labels, email) VALUES
    (907, 'Max', 'Left', '["03_Austritt"]', 'mixed@test.ch'),
    (908, 'Mia', 'Active', '[]', 'mixed@test.ch');
  u := pg_temp.sign_up('10000000-0000-4000-8000-000000000011', 'mixed@test.ch');
  PERFORM pg_temp.eq('S6 mixed records: approved', pg_temp.st(u), 'approved/member');
  PERFORM pg_temp.act_as(u);
  PERFORM pg_temp.eq('S6 only the record that counts', (SELECT string_agg(x::text, ',') FROM public.my_member_ids() x), '908');
  PERFORM pg_temp.eq('S6 my_access', pg_temp.access(), 'true {active,left}');
  PERFORM pg_temp.eq('S6 members readable', (SELECT string_agg(id::text, ',') FROM public.members), '908');
  RESET ROLE;
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- S7, S8, S9: an approved account whose membership ends, then comes back
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_member uuid := 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
  v_admin uuid := 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  v_approved_at timestamptz := (SELECT approved_at FROM public.user_profiles WHERE user_id = 'b2c3d4e5-f6a7-8901-bcde-f12345678901');
  v_ok boolean;
BEGIN
  UPDATE public.members SET labels = '["Nicht-Mitglieder"]' WHERE id IN (103, 107);
  PERFORM pg_temp.eq('S7 profile stays approved', pg_temp.st(v_member), 'approved/member');
  PERFORM pg_temp.act_as(v_member);
  PERFORM pg_temp.ok('S7 is_approved_user false', NOT public.is_approved_user());
  PERFORM pg_temp.eq('S7 no own records', (SELECT count(*) FROM public.my_member_ids())::text, '0');
  PERFORM pg_temp.eq('S7 my_access', pg_temp.access(), 'false {non_member}');
  PERFORM pg_temp.eq('S7 sees nothing (tables, avatars, RPCs)', pg_temp.leaks(), '');
  PERFORM pg_temp.eq('S7 sees its own profile', (SELECT count(*) FROM public.user_profiles)::text, '1');
  BEGIN
    PERFORM public.register_for_exam(990001, 103, '2. Kyu');
    v_ok := false;
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
  END;
  PERFORM pg_temp.ok('S7 exam registration refused', v_ok);
  RESET ROLE;

  PERFORM pg_temp.act_as(v_admin);
  PERFORM pg_temp.eq('S7 in the access report',
    (SELECT statuses::text FROM public.member_access_report() WHERE user_id = v_member), '{non_member}');
  RESET ROLE;

  UPDATE public.members SET labels = '["Aktiv"]' WHERE id IN (103, 107);
  PERFORM pg_temp.act_as(v_member);
  PERFORM pg_temp.eq('S8 back at once', pg_temp.member_view(), 'true trainings>0=true directory>0=true');
  RESET ROLE;
  PERFORM pg_temp.ok('S8 profile untouched', (SELECT approved_at FROM public.user_profiles WHERE user_id = v_member) = v_approved_at);
  PERFORM pg_temp.act_as(v_admin);
  PERFORM pg_temp.ok('S8 out of the report', NOT EXISTS (SELECT 1 FROM public.member_access_report() WHERE user_id = v_member));
  RESET ROLE;
END $$;
ROLLBACK TO SAVEPOINT s;

-- The same through the Webling sync's writes: a labels upsert, then Webling
-- no longer has the member (link gone), then it is back (link live again)
SAVEPOINT s;
DO $$
DECLARE
  u uuid;
BEGIN
  SET LOCAL ROLE service_role;
  INSERT INTO public.members (id, firstname, lastname, labels, email)
  VALUES (5004, 'Wera', 'Webling', '["Aktiv"]', 'wera@test.ch');
  INSERT INTO public.member_links (connection, external_id, member_id, last_seen_at)
  VALUES ('webling', '5004', 5004, now());
  RESET ROLE;
  u := pg_temp.sign_up('10000000-0000-4000-8000-000000000012', 'wera@test.ch');
  PERFORM pg_temp.eq('S7 Webling member: approved', pg_temp.st(u), 'approved/member');

  SET LOCAL ROLE service_role;
  INSERT INTO public.members (id, firstname, lastname, labels, email)
  VALUES (5004, 'Wera', 'Webling', '["03_Austritt"]', 'wera@test.ch')
  ON CONFLICT (id) DO UPDATE SET firstname = EXCLUDED.firstname, lastname = EXCLUDED.lastname,
    labels = EXCLUDED.labels, email = EXCLUDED.email;
  RESET ROLE;
  PERFORM pg_temp.act_as(u);
  PERFORM pg_temp.eq('S7 sync upsert 03_Austritt: no access', pg_temp.access(), 'false {left}');
  PERFORM pg_temp.eq('S7 sync upsert: sees nothing', pg_temp.leaks(), '');
  RESET ROLE;

  SET LOCAL ROLE service_role;
  UPDATE public.members SET labels = '["Aktiv"]' WHERE id = 5004;
  RESET ROLE;
  PERFORM pg_temp.act_as(u);
  PERFORM pg_temp.eq('S8 Aktiv again: access', pg_temp.access(), 'true {active}');
  RESET ROLE;

  SET LOCAL ROLE service_role;
  UPDATE public.member_links SET gone_at = now() WHERE member_id = 5004;
  RESET ROLE;
  PERFORM pg_temp.act_as(u);
  PERFORM pg_temp.eq('S7 gone from Webling: no access', pg_temp.access(), 'false {left}');
  RESET ROLE;

  SET LOCAL ROLE service_role;
  UPDATE public.member_links SET gone_at = NULL WHERE member_id = 5004;
  RESET ROLE;
  PERFORM pg_temp.act_as(u);
  PERFORM pg_temp.eq('S8 back in Webling: access', pg_temp.access(), 'true {active}');
  RESET ROLE;
  PERFORM pg_temp.eq('S8 profile never left approved', pg_temp.st(u), 'approved/member');
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- S10: a parent with one active child and one who left
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_member uuid := 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
  v_reg107 bigint;
  v_badges107 bigint := (SELECT count(*) FROM public.member_badges WHERE "memberId" = 107);
  v_ok boolean;
BEGIN
  PERFORM pg_temp.act_as(v_member);
  v_reg107 := public.register_for_exam(990001, 107, '4. Kyu');
  RESET ROLE;
  UPDATE public.members SET labels = '["03_Austritt"]' WHERE id = 107;

  PERFORM pg_temp.act_as(v_member);
  PERFORM pg_temp.eq('S10 still has access', pg_temp.member_view(), 'true trainings>0=true directory>0=true');
  PERFORM pg_temp.eq('S10 only the active child', (SELECT string_agg(x::text, ',') FROM public.my_member_ids() x), '103');
  PERFORM pg_temp.eq('S10 members readable', (SELECT string_agg(id::text, ',') FROM public.members), '103');
  PERFORM pg_temp.ok('S10 attendance only of the active child', NOT EXISTS (SELECT 1 FROM public.logs WHERE "memberId" <> 103));
  PERFORM pg_temp.eq('S10 my_access', pg_temp.access(), 'true {active,left}');
  PERFORM pg_temp.ok('S10 no badges of the child who left',
    v_badges107 > 0
    AND (SELECT count(*) FROM public.get_member_badges(107)) = 0
    AND NOT EXISTS (SELECT 1 FROM public.member_badges WHERE "memberId" = 107));
  PERFORM pg_temp.eq('S10 registrations only of the active child',
    (SELECT count(*) FROM public.get_my_exam_registrations() WHERE member_id = 107)::text, '0');
  PERFORM pg_temp.ok('S10 registers the active child', public.register_for_exam(990001, 103, '2. Kyu') IS NOT NULL);
  BEGIN
    PERFORM public.register_for_exam(990001, 107, '3. Kyu');
    v_ok := false;
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
  END;
  PERFORM pg_temp.ok('S10 cannot register the child who left', v_ok);
  BEGIN
    PERFORM public.withdraw_exam_registration(v_reg107);
    v_ok := false;
  EXCEPTION WHEN OTHERS THEN v_ok := true;
  END;
  PERFORM pg_temp.ok('S10 cannot withdraw the child who left', v_ok);
  RESET ROLE;
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- S11, S12, S13, S14: what admins do in Benutzer
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_admin uuid := 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  v_viewer uuid := 'c3d4e5f6-a7b8-9012-cdef-123456789012';
  u uuid := pg_temp.sign_up('10000000-0000-4000-8000-000000000013', 'stranger@test.ch');
  w uuid := pg_temp.sign_up('10000000-0000-4000-8000-000000000014', 'waiting@test.ch');
  t uuid := pg_temp.sign_up('10000000-0000-4000-8000-000000000015', 'future.trainer@test.ch');
BEGIN
  PERFORM pg_temp.eq('S12 sign-up waits as member', pg_temp.st(u), 'pending/member');
  PERFORM pg_temp.act_as(v_admin);
  PERFORM pg_temp.eq('S12 waiting account without a record in the report',
    (SELECT statuses::text FROM public.member_access_report() WHERE user_id = u), '{}');
  -- The users page approves like this (approve())
  UPDATE public.user_profiles SET status = 'approved', approved_at = now(), approved_by = v_admin
   WHERE user_id = u;
  RESET ROLE;
  PERFORM pg_temp.eq('S12 hand approval keeps the role member', pg_temp.st(u), 'approved/member');
  PERFORM pg_temp.act_as(u);
  PERFORM pg_temp.eq('S12 hand-approved without membership: no access', pg_temp.access(), 'false {}');
  PERFORM pg_temp.eq('S12 sees nothing', pg_temp.leaks(), '');
  RESET ROLE;

  -- S11: a link to a member who left grants nothing, a link to an active one does
  PERFORM pg_temp.act_as(v_admin);
  UPDATE public.user_profiles SET member_id = 32382 WHERE user_id = u;
  RESET ROLE;
  PERFORM pg_temp.act_as(u);
  PERFORM pg_temp.eq('S11 linked to a member who left: no access', pg_temp.access(), 'false {left}');
  PERFORM pg_temp.eq('S11 not even that record', (SELECT count(*) FROM public.members)::text, '0');
  RESET ROLE;
  PERFORM pg_temp.act_as(v_admin);
  UPDATE public.user_profiles SET member_id = 901 WHERE user_id = u;
  UPDATE public.user_profiles SET member_id = 902 WHERE user_id = w;
  RESET ROLE;
  PERFORM pg_temp.act_as(u);
  PERFORM pg_temp.eq('S11 linked to an active member: access', pg_temp.access(), 'true {active}');
  PERFORM pg_temp.eq('S11 the linked record', (SELECT string_agg(x::text, ',') FROM public.my_member_ids() x), '901');
  RESET ROLE;
  PERFORM pg_temp.eq('S11 linking does not approve a waiting account', pg_temp.st(w), 'pending/member');
  PERFORM pg_temp.act_as(w);
  PERFORM pg_temp.eq('S11 waiting with a record that counts', pg_temp.access(), 'false {passive}');
  RESET ROLE;
  PERFORM pg_temp.act_as(v_admin);
  PERFORM pg_temp.ok('S11 waiting account with a record that counts is not in the report',
    NOT EXISTS (SELECT 1 FROM public.member_access_report() WHERE user_id IN (u, w)));

  -- S12: an admin picks a staff role before approving; the automatic
  -- approval no longer turns the account into a member
  UPDATE public.user_profiles SET role = 'trainer' WHERE user_id = t;
  RESET ROLE;
  UPDATE public.members SET email = 'future.trainer@test.ch' WHERE id = 115;
  PERFORM pg_temp.sign_in(t);
  PERFORM pg_temp.eq('S12 staff role picked: waits for the admin', pg_temp.st(t), 'pending/trainer');

  -- S13: a viewer (examiner) demoted to member without a record
  PERFORM pg_temp.act_as(v_admin);
  UPDATE public.user_profiles SET role = 'member' WHERE user_id = v_viewer;
  RESET ROLE;
  PERFORM pg_temp.eq('S13 exam role cleared', (SELECT coalesce(exam_role, '-') FROM public.user_profiles WHERE user_id = v_viewer), '-');
  PERFORM pg_temp.act_as(v_viewer);
  PERFORM pg_temp.eq('S13 demoted without membership: no access', pg_temp.access(), 'false {}');
  PERFORM pg_temp.ok('S13 no exam role either', NOT public.is_examiner());
  RESET ROLE;

  -- S14: back to staff: access from the role, membership irrelevant
  PERFORM pg_temp.act_as(v_admin);
  UPDATE public.user_profiles SET role = 'trainer' WHERE user_id = v_viewer;
  RESET ROLE;
  PERFORM pg_temp.act_as(v_viewer);
  PERFORM pg_temp.ok('S14 member promoted to staff: access', public.is_approved_user() AND public.is_writer());
  RESET ROLE;
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- S15, S16, S17, S18: disabled, bootstrap admin, staff, exam roles
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_member uuid := 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
  v_admin uuid := 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  v_viewer uuid := 'c3d4e5f6-a7b8-9012-cdef-123456789012';
  b uuid;
BEGIN
  PERFORM pg_temp.act_as(v_admin);
  UPDATE public.user_profiles SET status = 'disabled' WHERE user_id = v_member;
  RESET ROLE;
  UPDATE public.members SET labels = '["Aktiv", "Kindertrainer"]' WHERE id IN (103, 107);
  PERFORM pg_temp.sign_in(v_member);
  PERFORM pg_temp.eq('S15 disabled stays disabled', pg_temp.st(v_member), 'disabled/member');
  PERFORM pg_temp.act_as(v_member);
  PERFORM pg_temp.eq('S15 disabled: no access', pg_temp.access(), 'false {active}');
  PERFORM pg_temp.eq('S15 sees nothing', pg_temp.leaks(), '');
  RESET ROLE;

  b := pg_temp.sign_up('10000000-0000-4000-8000-000000000016', 'andreas.schmid@jacwohlen.ch');
  PERFORM pg_temp.eq('S16 bootstrap admin', pg_temp.st(b), 'approved/admin');
  PERFORM pg_temp.act_as(b);
  PERFORM pg_temp.ok('S16 bootstrap admin without member record: access', public.is_approved_user() AND public.is_admin());
  RESET ROLE;

  -- S17: a viewer whose only record is a non-member keeps everything
  UPDATE public.members SET email = 'examiner@example.com', labels = '["Nicht-Mitglieder"]' WHERE id = 110;
  PERFORM pg_temp.act_as(v_viewer);
  PERFORM pg_temp.ok('S17 staff with a non-member record: access', public.is_approved_user() AND public.is_staff());
  PERFORM pg_temp.eq('S17 keeps "Mein Profil"', (SELECT string_agg(x::text, ',') FROM public.my_member_ids() x), '110');
  PERFORM pg_temp.eq('S17 directory mine', (SELECT string_agg(id::text, ',') FROM public.get_member_directory() WHERE "isMine"), '110');
  RESET ROLE;
  PERFORM pg_temp.act_as(v_admin);
  PERFORM pg_temp.ok('S17 admin without member record: everything', public.is_approved_user()
    AND (SELECT count(*) FROM public.members) > 600);
  PERFORM pg_temp.ok('S17 staff are never in the report',
    NOT EXISTS (SELECT 1 FROM public.member_access_report() WHERE user_id IN (v_admin, v_viewer)));

  -- S18: an exam role only exists on top of a staff role
  UPDATE public.user_profiles SET exam_role = 'examiner' WHERE user_id = v_member;
  RESET ROLE;
  PERFORM pg_temp.eq('S18 no exam role on a member account',
    (SELECT coalesce(exam_role, '-') FROM public.user_profiles WHERE user_id = v_member), '-');
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- S19, S20, S21, S22, S24: e-mail changed, archived, deleted, trial labels
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_member uuid := 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
  v_admin uuid := 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  o uuid;
  n uuid;
BEGIN
  -- S19: Webling now has a different address for the member
  SET LOCAL ROLE service_role;
  INSERT INTO public.members (id, firstname, lastname, labels, email)
  VALUES (5005, 'Emil', 'Mail', '["Aktiv"]', 'old@test.ch');
  INSERT INTO public.member_links (connection, external_id, member_id, last_seen_at)
  VALUES ('webling', '5005', 5005, now());
  RESET ROLE;
  o := pg_temp.sign_up('10000000-0000-4000-8000-000000000017', 'old@test.ch');
  n := pg_temp.sign_up('10000000-0000-4000-8000-000000000018', 'new@test.ch');
  PERFORM pg_temp.eq('S19 old address approved', pg_temp.st(o), 'approved/member');
  PERFORM pg_temp.eq('S19 new address waits', pg_temp.st(n), 'pending/member');
  SET LOCAL ROLE service_role;
  INSERT INTO public.members (id, firstname, lastname, labels, email)
  VALUES (5005, 'Emil', 'Mail', '["Aktiv"]', 'new@test.ch')
  ON CONFLICT (id) DO UPDATE SET labels = EXCLUDED.labels, email = EXCLUDED.email;
  RESET ROLE;
  PERFORM pg_temp.act_as(o);
  PERFORM pg_temp.eq('S19 old address: no access', pg_temp.access(), 'false {}');
  RESET ROLE;
  PERFORM pg_temp.eq('S19 new address approved by the upsert', pg_temp.st(n), 'approved/member');
END $$;
ROLLBACK TO SAVEPOINT s;

SAVEPOINT s;
DO $$
DECLARE
  v_member uuid := 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
  v_admin uuid := 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  u uuid;
BEGIN
  -- S20: archived records count for nothing, unarchiving lets the account in
  UPDATE public.members SET "archivedAt" = now() WHERE id IN (103, 107);
  PERFORM pg_temp.act_as(v_member);
  PERFORM pg_temp.eq('S20 archived: no access', pg_temp.access(), 'false {archived}');
  PERFORM pg_temp.eq('S20 sees nothing', pg_temp.leaks(), '');
  RESET ROLE;
  UPDATE public.members SET "archivedAt" = NULL WHERE id = 103;
  PERFORM pg_temp.act_as(v_member);
  PERFORM pg_temp.eq('S20 one unarchived: access to it', (SELECT string_agg(x::text, ',') FROM public.my_member_ids() x), '103');
  RESET ROLE;

  INSERT INTO public.members (id, firstname, lastname, labels, email, "archivedAt")
  VALUES (909, 'Ari', 'Archived', '[]', 'arch@test.ch', now());
  u := pg_temp.sign_up('10000000-0000-4000-8000-000000000019', 'arch@test.ch');
  PERFORM pg_temp.eq('S20 archived only: waits', pg_temp.st(u), 'pending/member');
  UPDATE public.members SET "archivedAt" = NULL WHERE id = 909;
  PERFORM pg_temp.eq('S20 unarchived: approved by the trigger', pg_temp.st(u), 'approved/member');

  -- S21: the linked (and e-mail matched) member is deleted
  PERFORM pg_temp.act_as(v_admin);
  UPDATE public.user_profiles SET member_id = 909 WHERE user_id = u;
  RESET ROLE;
  DELETE FROM public.members WHERE id = 909;
  PERFORM pg_temp.eq('S21 link cleared', (SELECT coalesce(member_id::text, '-') FROM public.user_profiles WHERE user_id = u), '-');
  PERFORM pg_temp.act_as(u);
  PERFORM pg_temp.eq('S21 member deleted: no access', pg_temp.access(), 'false {}');
  PERFORM pg_temp.eq('S21 sees nothing', pg_temp.leaks(), '');
  RESET ROLE;

  -- S24: Aktiv plus a trial label: no access, and the report says why
  UPDATE public.members SET "archivedAt" = NULL, labels = '["Aktiv", "Probetraining"]' WHERE id IN (103, 107);
  PERFORM pg_temp.act_as(v_member);
  PERFORM pg_temp.eq('S24 Aktiv + Probetraining: no access', pg_temp.access(), 'false {trial}');
  RESET ROLE;
  PERFORM pg_temp.act_as(v_admin);
  PERFORM pg_temp.eq('S24 report gives the reason, not "active"',
    (SELECT statuses::text FROM public.member_access_report() WHERE user_id = v_member), '{trial}');
  RESET ROLE;

  -- S22 (known, phase 1c): a trainer removes the trial label of an app
  -- trial candidate, which then counts as an active member (1a rule)
  u := pg_temp.sign_up('10000000-0000-4000-8000-000000000020', 'lara.meier@example.com');
  UPDATE public.members SET labels = '[]' WHERE id = 195;
  PERFORM pg_temp.eq('S22 trial label removed: counts as active', pg_temp.st(u), 'approved/member');
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- S25: a member Webling has just added, before the sync writes its link
-----------------

SAVEPOINT s;
DO $$
DECLARE
  u uuid := pg_temp.sign_up('10000000-0000-4000-8000-000000000021', 'neu@test.ch');
  a uuid := pg_temp.sign_up('10000000-0000-4000-8000-000000000022', 'neu.aktiv@test.ch');
BEGIN
  SET LOCAL ROLE service_role;
  INSERT INTO public.members (id, firstname, lastname, labels, email) VALUES
    (5006, 'Nele', 'Neu', '["01_Anmeldung"]', 'neu@test.ch'),
    (5007, 'Nick', 'Neu', '["Aktiv"]', 'neu.aktiv@test.ch');
  RESET ROLE;
  PERFORM pg_temp.eq('S25 no status group, no link yet: non-member',
    (SELECT membership_status FROM public.members WHERE id = 5006), 'non_member');
  PERFORM pg_temp.eq('S25 so the account keeps waiting', pg_temp.st(u), 'pending/member');
  PERFORM pg_temp.eq('S25 Aktiv: approved before the link exists', pg_temp.st(a), 'approved/member');
  SET LOCAL ROLE service_role;
  INSERT INTO public.member_links (connection, external_id, member_id, last_seen_at) VALUES
    ('webling', '5006', 5006, now()), ('webling', '5007', 5007, now());
  RESET ROLE;
  PERFORM pg_temp.eq('S25 linked: still waiting', pg_temp.st(u), 'pending/member');
  PERFORM pg_temp.act_as(a);
  PERFORM pg_temp.eq('S25 linked Aktiv: access', pg_temp.access(), 'true {active}');
  RESET ROLE;
  SET LOCAL ROLE service_role;
  UPDATE public.members SET labels = '["01_Anmeldung", "Aktiv"]' WHERE id = 5006;
  RESET ROLE;
  PERFORM pg_temp.eq('S25 Aktiv set in Webling: approved', pg_temp.st(u), 'approved/member');
  PERFORM pg_temp.eq('S25 app members without labels stay active',
    (SELECT membership_status FROM public.members WHERE id = 901), 'active');
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- S26: every Webling member flips (e.g. Aktiv renamed): members out, staff not
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_member uuid := 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
  v_admin uuid := 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  v_viewer uuid := 'c3d4e5f6-a7b8-9012-cdef-123456789012';
BEGIN
  UPDATE public.members SET labels = '["Nicht-Mitglieder"]';
  PERFORM pg_temp.act_as(v_member);
  PERFORM pg_temp.eq('S26 member account out', pg_temp.access(), 'false {non_member}');
  RESET ROLE;
  PERFORM pg_temp.act_as(v_viewer);
  PERFORM pg_temp.ok('S26 viewer unaffected', public.is_approved_user() AND (SELECT count(*) FROM public.members) > 600);
  RESET ROLE;
  PERFORM pg_temp.act_as(v_admin);
  PERFORM pg_temp.ok('S26 admin unaffected', public.is_approved_user() AND (SELECT count(*) FROM public.trainings) > 0);
  RESET ROLE;
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- The nightly sync with nothing changed does not run the approval
-----------------

SAVEPOINT s;
DO $$
DECLARE
  u uuid;
BEGIN
  SET LOCAL ROLE service_role;
  INSERT INTO public.members (id, firstname, lastname, labels, email)
  VALUES (5008, 'Otto', 'Same', '["Aktiv"]', 'same@test.ch');
  INSERT INTO public.member_links (connection, external_id, member_id, last_seen_at)
  VALUES ('webling', '5008', 5008, now());
  RESET ROLE;
  u := pg_temp.sign_up('10000000-0000-4000-8000-000000000023', 'same@test.ch');
  -- Only to observe the trigger: a waiting account it would approve
  UPDATE public.user_profiles SET status = 'pending' WHERE user_id = u;

  SET LOCAL ROLE service_role;
  -- Upserts that change nothing (the merge-duplicates POSTs of the sync
  -- before the integration layer)
  INSERT INTO public.members (id, firstname, lastname, labels, email)
  VALUES (5008, 'Otto', 'Same', '["Aktiv"]', 'same@test.ch')
  ON CONFLICT (id) DO UPDATE SET firstname = EXCLUDED.firstname, lastname = EXCLUDED.lastname,
    labels = EXCLUDED.labels, email = EXCLUDED.email;
  INSERT INTO public.member_links (connection, external_id, member_id, last_seen_at, gone_at)
  VALUES ('webling', '5008', 5008, now(), NULL)
  ON CONFLICT (connection, external_id) DO UPDATE SET member_id = EXCLUDED.member_id,
    last_seen_at = EXCLUDED.last_seen_at, gone_at = EXCLUDED.gone_at;
  RESET ROLE;
  PERFORM pg_temp.eq('unchanged upserts skip the approval trigger', pg_temp.st(u), 'pending/member');

  SET LOCAL ROLE service_role;
  INSERT INTO public.members (id, firstname, lastname, labels, email)
  VALUES (5008, 'Otto', 'Same', '["Aktiv", "Kindertrainer"]', 'same@test.ch')
  ON CONFLICT (id) DO UPDATE SET labels = EXCLUDED.labels, email = EXCLUDED.email;
  RESET ROLE;
  PERFORM pg_temp.eq('a changed upsert runs it', pg_temp.st(u), 'approved/member');
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- Anonymous callers, an account without profile, privileges
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_ok boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  PERFORM pg_temp.ok('anon: is_approved_user false', NOT public.is_approved_user());
  PERFORM pg_temp.eq('anon sees nothing', pg_temp.leaks(), '');
  BEGIN
    PERFORM public.my_access();
    v_ok := false;
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
  END;
  PERFORM pg_temp.ok('anon cannot call my_access', v_ok);
  RESET ROLE;

  PERFORM pg_temp.act_as('10000000-0000-4000-8000-0000000000ff');
  PERFORM pg_temp.eq('no profile: my_access', pg_temp.access(), 'false {}');
  RESET ROLE;
END $$;
ROLLBACK TO SAVEPOINT s;

SELECT pg_temp.ok('helpers not callable through the API', NOT (
     has_function_privilege('authenticated', 'public.member_grants_access(text, timestamptz, jsonb)', 'EXECUTE')
  OR has_function_privilege('anon', 'public.member_grants_access(text, timestamptz, jsonb)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'public.member_access_status(text, timestamptz, jsonb)', 'EXECUTE')
  OR has_function_privilege('anon', 'public.member_access_status(text, timestamptz, jsonb)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'public.member_account_has_access(integer, text)', 'EXECUTE')
  OR has_function_privilege('anon', 'public.member_account_has_access(integer, text)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'public.grant_member_access(text)', 'EXECUTE')));
SELECT pg_temp.ok('my_access only for signed-in accounts',
  has_function_privilege('authenticated', 'public.my_access()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.my_access()', 'EXECUTE'));
SELECT pg_temp.eq('new accounts default to member',
  (SELECT column_default FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'role'),
  '''member''::user_role');

-- Guard for later changes: club data reaches accounts only through the
-- helpers that apply the membership rule (is_approved_user, my_member_ids)
-- or require a staff role. A policy reading user_profiles itself, or a new
-- API function doing so, would skip the rule; extend this list only for a
-- function that applies it. calendar_feed applies the staff rule of
-- is_staff() to the account its token belongs to (calendar_feeds.sql).
-- training_plan_mail_addresses reads the sign-in address of the account
-- linked to a trainer, for planners and involved members only; it grants the
-- account nothing (training_plan_mail.sql).
SELECT pg_temp.ok('no policy reads user_profiles itself',
  NOT EXISTS (SELECT 1 FROM pg_policies
              WHERE coalesce(qual, '') || coalesce(with_check, '') ~ 'user_profiles'));
SELECT pg_temp.eq('API functions reading user_profiles',
  (SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.prorettype <> 'trigger'::regtype
     AND p.prosrc ~ 'user_profiles'
     AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
          OR has_function_privilege('anon', p.oid, 'EXECUTE'))),
  'calendar_feed,is_admin,is_approved_user,is_exam_manager,is_examiner,is_staff,is_writer,member_access_report,my_access,my_member_ids,training_plan_mail_addresses');

ROLLBACK;

\o
\echo 'member_access: all checks passed'
