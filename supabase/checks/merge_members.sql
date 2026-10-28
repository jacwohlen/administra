-- Checks for phase 1c: merging a duplicate member
-- (20261028110000_merge_duplicate_members.sql, docs/INTEGRATIONS.md).
--
-- Runs on a database with every migration and the seed (supabase db start,
-- or a preview branch) as postgres, inside one transaction that is rolled
-- back; each scenario sits in a savepoint. A failed check raises and stops:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/checks/merge_members.sql
--
-- Accounts act through the API roles: pg_temp.act_as() sets the JWT claims
-- and SET LOCAL ROLE authenticated. The seed has no account links, photos
-- or duplicates, so the fixtures below make their own.

\set ON_ERROR_STOP 1
\o /dev/null
SET client_min_messages = notice;

BEGIN;

-- No account until act_as(); savepoint rollbacks return here
SELECT set_config('request.jwt.claims', '{}', true);

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

CREATE FUNCTION pg_temp.sign_up(p_id uuid, p_email text) RETURNS uuid
LANGUAGE sql AS $$
  INSERT INTO auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  VALUES ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
          now(), '{}', '{}', now(), now())
  RETURNING id;
$$;

CREATE FUNCTION pg_temp.act_as(p_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
END $$;

-- The seeded admin (test@example.com)
CREATE FUNCTION pg_temp.as_admin() RETURNS void
LANGUAGE sql AS $$
  SELECT pg_temp.act_as('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
$$;

-- The refusal code of a merge (or preview), 'merged' if it went through
CREATE FUNCTION pg_temp.refusal(p_keep integer, p_drop integer, p_preview boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  IF p_preview THEN
    PERFORM public.merge_members_preview(p_keep, p_drop);
  ELSE
    PERFORM public.merge_members(p_keep, p_drop);
  END IF;
  RETURN 'merged';
EXCEPTION WHEN OTHERS THEN
  RETURN split_part(SQLERRM, ':', 1) || ' ' || SQLSTATE;
END $$;

-- Everything that references these members, the rows themselves and all
-- badges, as one string: equal before and after means nothing changed
CREATE FUNCTION pg_temp.fingerprint(p_ids integer[]) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  r record;
  h text;
  v text := '';
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f' AND c.confrelid = 'public.members'::regclass
    ORDER BY 1, 2
  LOOP
    EXECUTE format('SELECT md5(coalesce(string_agg(t::text, ''|'' ORDER BY t::text), '''')) FROM %s t WHERE %I = ANY ($1)',
                   r.tbl, r.col) INTO h USING p_ids;
    v := v || r.tbl || '.' || r.col || '=' || h || ' ';
  END LOOP;
  SELECT v || 'members=' || md5(coalesce(string_agg(m::text, '|' ORDER BY m.id), '')) INTO v
  FROM public.members m WHERE m.id = ANY (p_ids);
  SELECT v || ' badges=' || md5(string_agg(b::text, '|' ORDER BY b::text)) INTO v FROM public.member_badges b;
  RETURN v;
END $$;

-- Rows anywhere that still point at this member
CREATE FUNCTION pg_temp.references_to(p_id integer) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  r record;
  n bigint;
  v text := '';
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f' AND c.confrelid = 'public.members'::regclass
    ORDER BY 1, 2
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', r.tbl, r.col) INTO n USING p_id;
    IF n > 0 THEN v := v || r.tbl || '.' || r.col || '=' || n || ' '; END IF;
  END LOOP;
  RETURN v;
END $$;

CREATE FUNCTION pg_temp.badges_md5() RETURNS text
LANGUAGE sql AS $$
  SELECT md5(string_agg(b::text, '|' ORDER BY b::text)) FROM public.member_badges b;
$$;

-----------------
-- Fixtures. Ids from 5'901 lie in the Webling range, 9xx and from
-- 10'000'001 on are app rows.
-----------------

-- A training only these members attend: twelve Mondays in 2024
INSERT INTO public.trainings (id, title, section, weekday, "dateFrom", "dateTo")
VALUES (990, 'Merge check', 'Judo', 'Monday', '18:00', '19:30');

-- W: Mira from Webling; T: her trial registration from before (same
-- person); Z: another Webling member in the same training
INSERT INTO public.members (id, firstname, lastname, labels, email, birthday) VALUES
  (5901, 'Mira', 'Dupont', '["Aktiv"]', 'mira@test.ch', '2012-03-04'),
  (5903, 'Zoe', 'Zeller', '["Aktiv"]', NULL, NULL);
INSERT INTO public.members (id, firstname, lastname, labels, email, notes, "trialRegisteredAt", "trialSection", "trialLocale",
                            img, "imgUploaded")
VALUES (10000901, 'Mira', 'Dupont', '["probetraining"]', 'mira.trial@test.ch', 'Kam über eine Freundin',
        '2023-12-20 10:00+01', 'Judo', 'de', 'data:image/webp;base64,AAAA', '2024-05-01 10:00:00.123+00');
INSERT INTO public.member_links (connection, external_id, member_id, last_seen_at, gone_at) VALUES
  ('webling', '5901', 5901, now(), NULL),
  ('webling', '5903', 5903, now(), NULL);

-- Attendance: Z every Monday, W the first eight and the eleventh, T the
-- last four (the eleventh as assistant, so that date is under both)
INSERT INTO public.logs (date, "trainingId", "memberId", "trainerRole")
SELECT to_char(d, 'YYYY-MM-DD'), 990, 5903, 'attendee'::public.trainer_role
FROM generate_series('2024-01-01'::date, '2024-03-18'::date, '7 days') d;
INSERT INTO public.logs (date, "trainingId", "memberId", "trainerRole")
SELECT to_char(d, 'YYYY-MM-DD'), 990, 5901, 'attendee'::public.trainer_role
FROM generate_series('2024-01-01'::date, '2024-02-19'::date, '7 days') d
UNION ALL SELECT '2024-03-11', 990, 5901, 'attendee';
INSERT INTO public.logs (date, "trainingId", "memberId", "trainerRole") VALUES
  ('2024-02-26', 990, 10000901, 'attendee'),
  ('2024-03-04', 990, 10000901, 'attendee'),
  ('2024-03-11', 990, 10000901, 'assistant'),
  ('2024-03-18', 990, 10000901, 'attendee');

-- Trial assignments: training 23 under both, 26 only T (assigning makes T 'assigned')
INSERT INTO public.participants ("trainingId", "memberId", "trialStartDate") VALUES
  (23, 10000901, '2024-01-05'), (26, 10000901, NULL), (23, 5901, NULL);

-- Event 4 under both (a Webling import for W, attended in the app for T), event 7 only T
INSERT INTO public.event_participants ("eventId", "memberId", "attendanceStatus", notes, "registeredAt") VALUES
  (4, 5901, 'registered', 'Imported from Webling - Confirmed: confirmed', '2026-06-01 10:00+00'),
  (4, 10000901, 'attended', NULL, '2026-05-01 10:00+00'),
  (7, 10000901, 'registered', 'per Telefon', '2026-04-01 10:00+00');
INSERT INTO public.event_logs ("eventId", "memberId", "isCoach", notes) VALUES
  (4, 5901, false, NULL),
  (4, 10000901, true, 'Betreuerin');

-- Grades: 5. Kyu under both, T's from a Q-Prüfung sheet (exam 1)
INSERT INTO public.member_grades ("memberId", section, grade, "examDate", note) VALUES
  (5901, 'Judo', '5. Kyu', '2025-12-01', 'Pass'),
  (10000901, 'Judo', '6. Kyu', '2025-06-01', NULL);
INSERT INTO public.exam_candidates (id, exam_id, member_id, section, grade, note)
VALUES (990001, 1, 10000901, 'Judo', '5. Kyu', 'Gürtel 220');
UPDATE public.exam_candidates SET started_at = now(), result = 'passed' WHERE id = 990001;

-- Medals: event 7 under both (T's gold wins and takes W's category), one
-- without event under both (exact duplicate), one without event only T
INSERT INTO public.member_medals ("memberId", "eventId", competition, date, section, medal, category) VALUES
  (5901, 7, 'Jugend Wettkampf', '2026-04-26', 'Judo', 'bronze', '-40 kg'),
  (10000901, 7, 'Jugend Wettkampf', '2026-04-26', 'Judo', 'gold', NULL),
  (5901, NULL, 'Kantonal', '2023-05-01', 'Judo', 'silver', NULL),
  (10000901, NULL, 'Kantonal', '2023-05-01', 'Judo', 'silver', NULL),
  (10000901, NULL, 'Schulsport', '2023-09-09', 'Judo', 'gold', NULL);

INSERT INTO public.trial_emails (member_id, kind, to_email, status, token)
SELECT id, 'welcome', email, 'sent', "trialToken" FROM public.members WHERE id = 10000901;
INSERT INTO public.training_plan_sessions (training_id, date, trainer_id) VALUES (990, '2024-03-25', 10000901);
UPDATE public.trainings SET "mainTrainerId" = 10000901 WHERE id = 990;

-- T's account (a parent signed up with the trial address, linked by an admin)
SELECT pg_temp.sign_up('20000000-0000-4000-8000-000000000001', 'mira.trial@test.ch');
UPDATE public.user_profiles SET member_id = 10000901 WHERE user_id = '20000000-0000-4000-8000-000000000001';

-- As if T had earned it earlier (after the inserts above, whose triggers
-- recompute T's badges): the merged badge keeps the earliest date
INSERT INTO public.member_badges ("memberId", "badgeId", "earnedAt") VALUES (10000901, 'attendance_10', '2024-03-01 12:00+00');

-- A trainer account, for the refusals
SELECT pg_temp.sign_up('20000000-0000-4000-8000-000000000002', 'trainer.merge@test.ch');
UPDATE public.user_profiles SET role = 'trainer', status = 'approved'
WHERE user_id = '20000000-0000-4000-8000-000000000002';

-----------------
-- Schema: every foreign key to members is in the reviewed list
-----------------

SELECT pg_temp.eq('every foreign key to members is handled (merge_member_references)',
  (SELECT string_agg(r, ',' ORDER BY r) FROM (
     SELECT c.conrelid::regclass::text || '.' || a.attname AS r
     FROM pg_constraint c
     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.contype = 'f' AND c.confrelid = 'public.members'::regclass) x),
  (SELECT string_agg(ref, ',' ORDER BY ref) FROM public.merge_member_references() WHERE kind = 'fk'));

-- References without a foreign key would be missed silently: a new integer
-- column named like a member, or a new JSON column, needs a decision here
-- (and in merge_members_apply) before this list may grow
SELECT pg_temp.eq('no member-like column without a foreign key',
  (SELECT string_agg(c.relname || '.' || a.attname, ',' ORDER BY c.relname, a.attname)
   FROM pg_attribute a
   JOIN pg_class c ON c.oid = a.attrelid
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
     AND a.attnum > 0 AND NOT a.attisdropped
     AND a.atttypid IN ('int2'::regtype, 'int4'::regtype, 'int8'::regtype)
     AND a.attname ~* '(member|trainer|coach|person|athlete|participant|candidate|kept|dropped)_?id$'
     AND NOT EXISTS (SELECT 1 FROM pg_constraint k
                     WHERE k.contype IN ('f', 'p') AND k.conrelid = c.oid AND a.attnum = ANY (k.conkey))),
  -- member_merges.dropped_id names a row that no longer exists
  'member_merges.dropped_id');
SELECT pg_temp.eq('JSON columns (none holds member ids)',
  (SELECT string_agg(c.relname || '.' || a.attname, ',' ORDER BY c.relname, a.attname)
   FROM pg_attribute a
   JOIN pg_class c ON c.oid = a.attrelid
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
     AND a.attnum > 0 AND NOT a.attisdropped
     AND a.atttypid IN ('json'::regtype, 'jsonb'::regtype, 'int4[]'::regtype, 'int8[]'::regtype)),
  'app_settings.value,exam_candidates.program,exam_programs.parts,member_merges.dropped,member_merges.result,members.labels');

SELECT pg_temp.ok('the merge itself is not callable through the API', NOT (
     has_function_privilege('authenticated', 'public.merge_members_apply(integer, integer)', 'EXECUTE')
  OR has_function_privilege('anon', 'public.merge_members_apply(integer, integer)', 'EXECUTE')
  OR has_function_privilege('service_role', 'public.merge_members_apply(integer, integer)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'public.merge_member_references()', 'EXECUTE')
  OR has_function_privilege('authenticated', 'public.merge_members_join_text(text, text, text)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'public.merge_members_field_rule(text, text, boolean, boolean)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'public.exam_candidate_has_sheet(bigint)', 'EXECUTE')
  OR has_function_privilege('service_role', 'public.exam_candidate_has_sheet(bigint)', 'EXECUTE')
  OR has_function_privilege('authenticated', 'public.merge_members_account_finds(public.user_profiles, public.members)', 'EXECUTE')));
SELECT pg_temp.ok('merge and preview: signed-in accounts only (admins checked inside)',
  has_function_privilege('authenticated', 'public.merge_members(integer, integer)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.merge_members_preview(integer, integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.merge_members(integer, integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.merge_members_preview(integer, integer)', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.merge_members(integer, integer)', 'EXECUTE'));
SELECT pg_temp.ok('member_merges: RLS on, nothing for anon, read-only for the API roles',
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.member_merges'::regclass)
  AND NOT has_table_privilege('anon', 'public.member_merges', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.member_merges', 'INSERT,UPDATE,DELETE,TRUNCATE')
  AND NOT has_table_privilege('service_role', 'public.member_merges', 'INSERT,UPDATE,DELETE,TRUNCATE')
  AND has_table_privilege('service_role', 'public.member_merges', 'SELECT'));

-- A custom setting in a function's SET clause (SET app.x = ...) only works
-- for a superuser: the local postgres here is one, the postgres of hosted
-- Supabase and of the CLI is not, so such a migration would pass these
-- checks and fail on every preview branch and project. Pause badges with
-- set_config(..., true) inside the function instead.
SELECT pg_temp.eq('no function sets a custom setting in its SET clause',
  (SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY 1)
   FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE split_part(c, '=', 1) LIKE '%.%')),
  NULL);

-----------------
-- Refusals
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_ok boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.merge_members_preview(5901, 10000901);
    v_ok := false;
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
  END;
  PERFORM pg_temp.ok('anon cannot call the preview', v_ok);
  RESET ROLE;

  PERFORM pg_temp.act_as('c3d4e5f6-a7b8-9012-cdef-123456789012');  -- viewer
  PERFORM pg_temp.eq('viewer: refused', pg_temp.refusal(5901, 10000901), 'NOT_ALLOWED 42501');
  PERFORM pg_temp.eq('viewer: preview refused', pg_temp.refusal(5901, 10000901, true), 'NOT_ALLOWED 42501');
  RESET ROLE;
  PERFORM pg_temp.act_as('20000000-0000-4000-8000-000000000002');  -- trainer
  PERFORM pg_temp.eq('trainer: refused', pg_temp.refusal(5901, 10000901), 'NOT_ALLOWED 42501');
  RESET ROLE;
  PERFORM pg_temp.act_as('b2c3d4e5-f6a7-8901-bcde-f12345678901');  -- member account
  PERFORM pg_temp.eq('member account: refused', pg_temp.refusal(5901, 10000901), 'NOT_ALLOWED 42501');
  RESET ROLE;

  -- An unlinked row in the Webling range (the sync adds the link right after)
  INSERT INTO public.members (id, firstname, lastname, labels) VALUES (5905, 'Una', 'Linked', '["Aktiv"]');

  PERFORM pg_temp.as_admin();
  PERFORM pg_temp.eq('same member', pg_temp.refusal(5901, 5901), 'SAME_MEMBER P0001');
  PERFORM pg_temp.eq('unknown member', pg_temp.refusal(5901, 999999), 'MEMBER_NOT_FOUND P0001');
  PERFORM pg_temp.eq('both in Webling', pg_temp.refusal(5901, 5903), 'BOTH_IN_PROVIDER P0001');
  PERFORM pg_temp.eq('both in Webling: preview says the same', pg_temp.refusal(5901, 5903, true), 'BOTH_IN_PROVIDER P0001');
  PERFORM pg_temp.eq('the Webling row must stay', pg_temp.refusal(10000901, 5901), 'KEEP_PROVIDER_ROW P0001');
  PERFORM pg_temp.eq('also when not linked yet (Webling id)', pg_temp.refusal(10000901, 5905), 'KEEP_PROVIDER_ROW P0001');
  RESET ROLE;
  PERFORM pg_temp.ok('nothing changed by refusals', pg_temp.references_to(10000901) <> ''
    AND NOT EXISTS (SELECT 1 FROM public.member_merges));
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- Trial registration into the Webling member: the preview changes
-- nothing and says exactly what the merge does; every reference moves
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_before text := pg_temp.fingerprint(ARRAY[5901, 10000901]);
  v_z_badges text := (SELECT string_agg("badgeId" || ':' || "earnedAt", ',' ORDER BY "badgeId") FROM public.member_badges WHERE "memberId" = 5903);
  v_token uuid := (SELECT "trialToken" FROM public.members WHERE id = 10000901);
  v_grade bigint := (SELECT member_grade_id FROM public.exam_candidates WHERE id = 990001);
  v_preview jsonb;
  v_result jsonb;
  v_badges text;
BEGIN
  PERFORM pg_temp.as_admin();
  v_preview := public.merge_members_preview(5901, 10000901);
  RESET ROLE;
  PERFORM pg_temp.eq('preview changes nothing', pg_temp.fingerprint(ARRAY[5901, 10000901]), v_before);
  PERFORM pg_temp.ok('preview leaves badge refresh on', current_setting('app.skip_badge_refresh', true) IS DISTINCT FROM 'true');

  PERFORM pg_temp.as_admin();
  v_result := public.merge_members(5901, 10000901);
  RESET ROLE;
  PERFORM pg_temp.eq('preview equals the merge', v_preview::text, (v_result - 'mergeId')::text);
  PERFORM pg_temp.ok('badge refresh on again after the merge', current_setting('app.skip_badge_refresh', true) IS DISTINCT FROM 'true');
  PERFORM pg_temp.eq('every listed reference reports what moved',
    (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(v_result->'moved') k),
    (SELECT string_agg(ref, ',' ORDER BY ref) FROM public.merge_member_references() WHERE kind = 'fk'));

  PERFORM pg_temp.ok('trial row deleted', NOT EXISTS (SELECT 1 FROM public.members WHERE id = 10000901));
  PERFORM pg_temp.eq('nothing points at it any more', pg_temp.references_to(10000901), '');

  -- logs: twelve Mondays, the shared one as assistant
  PERFORM pg_temp.eq('logs moved and merged', v_result->'moved'->>'logs.memberId', '{"moved": 3, "merged": 1}');
  PERFORM pg_temp.eq('twelve trainings', (SELECT count(*)::text FROM public.logs WHERE "memberId" = 5901), '12');
  PERFORM pg_temp.eq('shared date: higher role', (SELECT "trainerRole"::text FROM public.logs
    WHERE "memberId" = 5901 AND date = '2024-03-11' AND "trainingId" = 990), 'assistant');

  PERFORM pg_temp.eq('participants', (SELECT string_agg("trainingId" || ':' || coalesce("trialStartDate"::text, '-'), ',' ORDER BY "trainingId")
    FROM public.participants WHERE "memberId" = 5901), '23:2024-01-05,26:-');

  PERFORM pg_temp.eq('event 4: attended, no longer a Webling import',
    (SELECT "attendanceStatus" || ' ' || coalesce(notes, '-') || ' ' || "registeredAt"::date
     FROM public.event_participants WHERE "eventId" = 4 AND "memberId" = 5901), 'attended - 2026-05-01');
  PERFORM pg_temp.eq('event 7 moved', (SELECT notes FROM public.event_participants WHERE "eventId" = 7 AND "memberId" = 5901), 'per Telefon');
  PERFORM pg_temp.eq('event attendance once, as coach', (SELECT count(*) || ' ' || bool_or("isCoach") || ' ' || string_agg(notes, '')
    FROM public.event_logs WHERE "eventId" = 4 AND "memberId" = 5901), '1 true Betreuerin');

  PERFORM pg_temp.eq('5. Kyu: the exam''s row stays, still on its sheet',
    (SELECT id || ' ' || "examDate" || ' ' || note FROM public.member_grades WHERE "memberId" = 5901 AND grade = '5. Kyu'),
    v_grade || ' 2025-12-06 Q-Prüfung / Pass');
  PERFORM pg_temp.eq('sheet moved with its grade', (SELECT member_id || ' ' || member_grade_id FROM public.exam_candidates WHERE id = 990001),
    '5901 ' || v_grade);
  PERFORM pg_temp.eq('grades', (SELECT string_agg(grade, ',' ORDER BY grade) FROM public.member_grades WHERE "memberId" = 5901), '5. Kyu,6. Kyu');
  PERFORM pg_temp.eq('grade conflict reported',
    (SELECT c->>'grade' || ' ' || (c->>'kept') || ' ' || (c->>'reason') FROM jsonb_array_elements(v_result->'conflicts') c
     WHERE c->>'ref' = 'member_grades.memberId'), '5. Kyu drop exam');

  PERFORM pg_temp.eq('medals: the better one, no duplicate',
    (SELECT string_agg(competition || ' ' || medal, ',' ORDER BY competition) FROM public.member_medals WHERE "memberId" = 5901),
    'Jugend Wettkampf gold,Kantonal silver,Schulsport gold');
  PERFORM pg_temp.eq('the better medal takes the category it lacked',
    (SELECT category FROM public.member_medals WHERE "memberId" = 5901 AND "eventId" = 7), '-40 kg');
  PERFORM pg_temp.eq('medal conflict reported',
    (SELECT (c->>'competition') || ' ' || (c->>'keptMedal') || ' ' || (c->>'droppedMedal') FROM jsonb_array_elements(v_result->'conflicts') c
     WHERE c->>'ref' = 'member_medals.memberId'), 'Jugend Wettkampf gold bronze');

  PERFORM pg_temp.eq('trial e-mail, plan, main trainer, account moved',
    (SELECT count(*) FROM public.trial_emails WHERE member_id = 5901)
    || ' ' || (SELECT trainer_id FROM public.training_plan_sessions WHERE training_id = 990)
    || ' ' || (SELECT "mainTrainerId" FROM public.trainings WHERE id = 990)
    || ' ' || (SELECT member_id FROM public.user_profiles WHERE user_id = '20000000-0000-4000-8000-000000000001'),
    '1 5901 5901 5901');

  -- Badges: twelve in a row now; the earn date of a badge T had stays
  v_badges := (SELECT string_agg("badgeId", ',' ORDER BY "badgeId") FROM public.member_badges WHERE "memberId" = 5901 AND season = 0);
  PERFORM pg_temp.ok('streak and attendance recomputed: ' || v_badges,
    v_badges LIKE '%attendance_10%' AND v_badges LIKE '%streak_10%' AND v_badges LIKE '%first_gold%');
  PERFORM pg_temp.eq('earliest earn date kept', (SELECT "earnedAt"::date::text FROM public.member_badges
    WHERE "memberId" = 5901 AND "badgeId" = 'attendance_10'), '2024-03-01');
  PERFORM pg_temp.ok('result lists the new badges', v_result->'badges'->'added' ? 'streak_10:0:');
  PERFORM pg_temp.eq('other members'' badges unchanged',
    (SELECT string_agg("badgeId" || ':' || "earnedAt", ',' ORDER BY "badgeId") FROM public.member_badges WHERE "memberId" = 5903), v_z_badges);
  -- Derived data equals a full recompute
  v_before := pg_temp.badges_md5();
  PERFORM public.refresh_member_badges(5901);
  PERFORM public.refresh_member_grade_medal_badges(5901);
  PERFORM public.refresh_member_season_badges(5901, 2024);
  PERFORM public.refresh_section_season_badges('Judo', 2024);
  PERFORM public.refresh_section_season_badges('Judo', 2025);
  PERFORM pg_temp.eq('badges equal a full recompute', pg_temp.badges_md5(), v_before);

  -- The kept row: Webling fields untouched, app data taken over
  PERFORM pg_temp.eq('Webling fields stay', (SELECT email || ' ' || birthday || ' ' || labels::text || ' ' || membership_status
    FROM public.members WHERE id = 5901), 'mira@test.ch 2012-03-04 ["Aktiv"] active');
  PERFORM pg_temp.eq('notes and photo taken over', (SELECT notes || ' ' || img || ' ' || "imgUploaded"
    FROM public.members WHERE id = 5901), 'Kam über eine Freundin data:image/webp;base64,AAAA 2024-05-01 10:00:00.123+00');
  PERFORM pg_temp.eq('photo decision', v_result->'fields'->>'photo', 'from_drop');
  PERFORM pg_temp.ok('photo file named by the database''s upload time',
    (v_result->'fields'->>'dropPhotoUploaded')::timestamptz = '2024-05-01 10:00:00.123+00');
  PERFORM pg_temp.eq('kept status before and after', v_result->>'status', '{"after": "active", "before": "active"}');
  PERFORM pg_temp.eq('trial e-mail not copied', v_result->'fields'->>'email', 'not_copied_provider');
  PERFORM pg_temp.eq('trial history and status link', (SELECT "trialStatus" || ' ' || "trialSection" || ' ' || ("trialToken" = v_token)
    || ' ' || "trialRegisteredAt"::date FROM public.members WHERE id = 5901), 'assigned Judo true 2023-12-20');
  PERFORM pg_temp.eq('status page answers member', public.get_trial_status(v_token)->>'status', 'member');
  PERFORM pg_temp.ok('the status link cannot cancel a member', NOT public.cancel_trial(v_token));
  -- T's account waits (a trial row lets nobody in): its link moved to
  -- Mira, but a waiting account finds nobody (my_member_ids), before or after
  PERFORM pg_temp.eq('account report',
    (SELECT string_agg((a->>'email') || ' ' || (a->>'role') || ' ' || (a->>'before') || '>' || (a->>'after')
                       || ' finds ' || (a->>'findsBefore') || '>' || (a->>'findsAfter'), ',')
     FROM jsonb_array_elements(v_result->'accounts') a),
    'mira.trial@test.ch member false>false finds false>false');
  PERFORM pg_temp.ok('no account loses access', NOT v_result->'warnings' @> '[{"code": "ACCOUNT_LOSES_ACCESS"}]');

  -- The log
  PERFORM pg_temp.eq('logged', (SELECT kept_id || ' ' || dropped_id || ' ' || merged_by || ' ' || (result = v_result - 'mergeId')
    FROM public.member_merges WHERE id = (v_result->>'mergeId')::bigint),
    '5901 10000901 a1b2c3d4-e5f6-7890-abcd-ef1234567890 true');
  PERFORM pg_temp.ok('snapshot without photo data and token', (SELECT NOT (dropped->'member' ? 'img') AND NOT (dropped->'member' ? 'trialToken')
    AND dropped->'member'->>'email' = 'mira.trial@test.ch' FROM public.member_merges));
  PERFORM pg_temp.act_as('c3d4e5f6-a7b8-9012-cdef-123456789012');  -- viewer
  PERFORM pg_temp.eq('viewer sees no merge log', (SELECT count(*)::text FROM public.member_merges), '0');
  RESET ROLE;
  PERFORM pg_temp.as_admin();
  PERFORM pg_temp.eq('admin sees it', (SELECT count(*)::text FROM public.member_merges), '1');
  RESET ROLE;
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- Cancelled trials: the kept member's trainings survive
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_token uuid;
BEGIN
  INSERT INTO public.members (id, firstname, lastname, labels) VALUES
    (10000902, 'Ivo', 'Cancel', '["probetraining"]'),
    (10000903, 'Ida', 'Cancel', '["probetraining"]');
  UPDATE public.members SET "trialStatus" = 'cancelled', "trialSelfCancelled" = true WHERE id IN (10000902, 10000903);
  -- Z (5903) trains on Fridays; Ida (5906) is in Webling without trainings
  INSERT INTO public.participants ("trainingId", "memberId") VALUES (25, 5903);
  INSERT INTO public.members (id, firstname, lastname, labels) VALUES (5906, 'Ida', 'Cancel', '["Aktiv"]');
  INSERT INTO public.member_links (connection, external_id, member_id, last_seen_at) VALUES ('webling', '5906', 5906, now());

  v_token := (SELECT "trialToken" FROM public.members WHERE id = 10000902);
  PERFORM pg_temp.as_admin();
  PERFORM public.merge_members(5903, 10000902);
  RESET ROLE;
  PERFORM pg_temp.eq('cancelled trial: the member''s training stays', (SELECT string_agg("trainingId"::text, ',') FROM public.participants WHERE "memberId" = 5903), '25');
  PERFORM pg_temp.eq('status follows the trainings', (SELECT "trialStatus" FROM public.members WHERE id = 5903), 'assigned');
  PERFORM pg_temp.eq('old link answers member', public.get_trial_status(v_token)->>'status', 'member');

  v_token := (SELECT "trialToken" FROM public.members WHERE id = 10000903);
  PERFORM pg_temp.as_admin();
  PERFORM public.merge_members(5906, 10000903);
  RESET ROLE;
  PERFORM pg_temp.eq('without trainings it stays cancelled', (SELECT "trialStatus" || ' ' || "trialSelfCancelled" FROM public.members WHERE id = 5906), 'cancelled true');
  PERFORM pg_temp.eq('old link answers member', public.get_trial_status(v_token)->>'status', 'member');
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- A member Webling no longer has into an app row: its gone link goes,
-- the kept status does not change, no waiting account is approved on
-- the way; e-mail, birthday and photo fill the app row's empty fields
-----------------

SAVEPOINT s;
DO $$
DECLARE
  u uuid;
  v_result jsonb;
BEGIN
  INSERT INTO public.members (id, firstname, lastname, labels, email, birthday, img, "imgUploaded") VALUES
    (5904, 'Gil', 'Gone', '["Aktiv"]', 'gil@test.ch', '2001-01-01', 'data:image/webp;base64,BBBB', '2023-01-01 00:00+00');
  INSERT INTO public.member_links (connection, external_id, member_id, last_seen_at, gone_at)
  VALUES ('webling', '5904', 5904, now() - interval '1 year', now() - interval '1 month');
  INSERT INTO public.members (id, firstname, lastname, labels) VALUES (904, 'Gil', 'Gone', '["Nicht-Mitglieder"]');
  u := pg_temp.sign_up('20000000-0000-4000-8000-000000000003', 'gil@test.ch');
  PERFORM pg_temp.eq('fixture: account waits (left, non-member)',
    (SELECT status::text FROM public.user_profiles WHERE user_id = u), 'pending');

  PERFORM pg_temp.as_admin();
  v_result := public.merge_members(904, 5904);
  RESET ROLE;
  PERFORM pg_temp.eq('gone link removed', v_result->'moved'->>'member_links.member_id', '{"moved": 0, "merged": 0, "removed": 1}');
  PERFORM pg_temp.ok('no link left', NOT EXISTS (SELECT 1 FROM public.member_links WHERE external_id = '5904'));
  PERFORM pg_temp.eq('kept status unchanged', (SELECT membership_status FROM public.members WHERE id = 904), 'non_member');
  PERFORM pg_temp.eq('no account approved on the way', (SELECT status::text FROM public.user_profiles WHERE user_id = u), 'pending');
  PERFORM pg_temp.eq('empty fields filled', (SELECT email || ' ' || birthday || ' ' || img FROM public.members WHERE id = 904),
    'gil@test.ch 2001-01-01 data:image/webp;base64,BBBB');
  PERFORM pg_temp.eq('photo decision', v_result->'fields'->>'photo', 'from_drop');
  PERFORM pg_temp.eq('the link is in the log', (SELECT dropped->'links'->0->>'external_id' FROM public.member_merges), '5904');
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- Two app rows: no e-mail from a trial registration; the account that
-- signed up with it is listed, but it never got in, so it loses nothing
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  INSERT INTO public.members (id, firstname, lastname, labels) VALUES (905, 'Tom', 'Twice', '[]');
  INSERT INTO public.members (id, firstname, lastname, labels, email) VALUES (10000905, 'Tom', 'Twice', '["probetraining"]', 'tom@test.ch');
  PERFORM pg_temp.sign_up('20000000-0000-4000-8000-000000000005', 'tom@test.ch');
  PERFORM pg_temp.as_admin();
  v_result := public.merge_members(905, 10000905);
  RESET ROLE;
  PERFORM pg_temp.eq('trial e-mail not copied', (SELECT coalesce(email, '-') FROM public.members WHERE id = 905), '-');
  PERFORM pg_temp.eq('reason', v_result->'fields'->>'email', 'not_copied_trial');
  PERFORM pg_temp.ok('e-mail not copied: warned', v_result->'warnings' ? 'EMAIL_NOT_COPIED');
  PERFORM pg_temp.eq('the trial address''s account: no access before or after',
    (SELECT string_agg((a->>'email') || ' ' || (a->>'before') || '>' || (a->>'after'), ',')
     FROM jsonb_array_elements(v_result->'accounts') a), 'tom@test.ch false>false');
  PERFORM pg_temp.ok('so no account loses access', NOT v_result->'warnings' @> '[{"code": "ACCOUNT_LOSES_ACCESS"}]');
  PERFORM pg_temp.eq('labels stay the kept row''s', (SELECT labels::text || ' ' || membership_status FROM public.members WHERE id = 905), '[] active');
  PERFORM pg_temp.eq('labels not carried over are listed', v_result->'fields'->>'labelsNotCarried', '["probetraining"]');
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- Accounts found by e-mail: a member account whose only counting record
-- is the dropped one loses access (the Webling row keeps its own e-mail)
-- and is reported; a trainer with the dropped row's address keeps access
-- by role and only no longer finds the record. Nothing is linked.
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_parent uuid := '20000000-0000-4000-8000-000000000021';
  v_coach uuid := '20000000-0000-4000-8000-000000000022';
  v_result jsonb;
BEGIN
  INSERT INTO public.members (id, firstname, lastname, labels, email) VALUES
    (5907, 'Lea', 'Konto', '["Aktiv"]', 'lea@test.ch'),
    (5908, 'Tim', 'Trainer', '["Aktiv"]', 'tim.webling@test.ch'),
    (921, 'Lea', 'Konto', '[]', 'lea.family@test.ch'),
    (922, 'Tim', 'Trainer', '[]', 'tim@test.ch');
  INSERT INTO public.member_links (connection, external_id, member_id, last_seen_at) VALUES
    ('webling', '5907', 5907, now()), ('webling', '5908', 5908, now());
  PERFORM pg_temp.sign_up(v_parent, 'lea.family@test.ch');
  PERFORM pg_temp.sign_up(v_coach, 'tim@test.ch');
  UPDATE public.user_profiles SET role = 'trainer', status = 'approved' WHERE user_id = v_coach;
  PERFORM pg_temp.eq('fixture: the parent got in by the app row''s e-mail',
    (SELECT role || ' ' || status FROM public.user_profiles WHERE user_id = v_parent), 'member approved');

  PERFORM pg_temp.as_admin();
  v_result := public.merge_members_preview(5907, 921);
  RESET ROLE;
  PERFORM pg_temp.eq('member account loses access',
    (SELECT string_agg((a->>'email') || ' ' || (a->>'before') || '>' || (a->>'after')
                       || ' finds ' || (a->>'findsBefore') || '>' || (a->>'findsAfter'), ',')
     FROM jsonb_array_elements(v_result->'accounts') a),
    'lea.family@test.ch true>false finds true>false');
  PERFORM pg_temp.ok('warned with the count', v_result->'warnings' @> '[{"code": "ACCOUNT_LOSES_ACCESS", "accounts": 1}]');

  PERFORM pg_temp.as_admin();
  v_result := public.merge_members(5908, 922);
  RESET ROLE;
  PERFORM pg_temp.eq('trainer keeps access, no longer finds the record',
    (SELECT string_agg((a->>'email') || ' ' || (a->>'role') || ' ' || (a->>'before') || '>' || (a->>'after')
                       || ' finds ' || (a->>'findsBefore') || '>' || (a->>'findsAfter'), ',')
     FROM jsonb_array_elements(v_result->'accounts') a),
    'tim@test.ch trainer true>true finds true>false');
  PERFORM pg_temp.ok('a trainer is not reported as losing access',
    NOT v_result->'warnings' @> '[{"code": "ACCOUNT_LOSES_ACCESS"}]');
  PERFORM pg_temp.ok('nothing linked automatically',
    (SELECT member_id IS NULL FROM public.user_profiles WHERE user_id = v_coach));
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- 'Finds' is my_member_ids(): a parent who keeps access through one child
-- and loses the other, whose record that stays does not count, is
-- reported; so is an account that starts to find a record that counts
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_parent uuid := '20000000-0000-4000-8000-000000000031';
  v_other uuid := '20000000-0000-4000-8000-000000000032';
  v_report text;
  v_result jsonb;
BEGIN
  -- Child A (950) has the parent's e-mail; the account is linked to child
  -- B's app row 951, whose Webling record 5950 is no member
  INSERT INTO public.members (id, firstname, lastname, labels, email) VALUES
    (950, 'Ari', 'Eltern', '[]', 'eltern@test.ch'),
    (951, 'Bea', 'Eltern', '[]', NULL),
    (5950, 'Bea', 'Eltern', '["Nicht-Mitglieder"]', NULL);
  INSERT INTO public.member_links (connection, external_id, member_id, last_seen_at) VALUES ('webling', '5950', 5950, now());
  PERFORM pg_temp.sign_up(v_parent, 'eltern@test.ch');
  UPDATE public.user_profiles SET member_id = 951 WHERE user_id = v_parent;
  PERFORM pg_temp.act_as(v_parent);
  PERFORM pg_temp.eq('fixture: the parent finds both children',
    (SELECT string_agg(i::text, ',' ORDER BY i) FROM public.my_member_ids() i), '950,951');
  RESET ROLE;

  PERFORM pg_temp.as_admin();
  v_report := (SELECT string_agg((a->>'email') || ' ' || (a->>'role') || ' ' || (a->>'before') || '>' || (a->>'after')
                                 || ' finds ' || (a->>'findsBefore') || '>' || (a->>'findsAfter'), ',')
               FROM jsonb_array_elements(public.merge_members_preview(5950, 951)->'accounts') a);
  PERFORM public.merge_members(5950, 951);
  PERFORM pg_temp.act_as(v_parent);
  PERFORM pg_temp.eq('after the merge the parent finds only the child who counts',
    (SELECT string_agg(i::text, ',' ORDER BY i) FROM public.my_member_ids() i), '950');
  RESET ROLE;
  PERFORM pg_temp.eq('and the preview said so', v_report, 'eltern@test.ch member true>true finds true>false');

  -- The other way: an account linked to a trial row (it got in through
  -- another record) finds the Webling member it is merged into
  INSERT INTO public.members (id, firstname, lastname, labels, email) VALUES
    (952, 'Cleo', 'Eltern', '[]', 'cleo.family@test.ch'),
    (10000953, 'Dan', 'Eltern', '["probetraining"]', NULL),
    (5953, 'Dan', 'Eltern', '["Aktiv"]', NULL);
  INSERT INTO public.member_links (connection, external_id, member_id, last_seen_at) VALUES ('webling', '5953', 5953, now());
  PERFORM pg_temp.sign_up(v_other, 'cleo.family@test.ch');
  UPDATE public.user_profiles SET member_id = 10000953 WHERE user_id = v_other;
  PERFORM pg_temp.act_as(v_other);
  PERFORM pg_temp.eq('fixture: a trial row is not found',
    (SELECT string_agg(i::text, ',' ORDER BY i) FROM public.my_member_ids() i), '952');
  RESET ROLE;
  PERFORM pg_temp.as_admin();
  v_result := public.merge_members(5953, 10000953);
  PERFORM pg_temp.act_as(v_other);
  PERFORM pg_temp.eq('after the merge it finds the Webling member',
    (SELECT string_agg(i::text, ',' ORDER BY i) FROM public.my_member_ids() i), '952,5953');
  RESET ROLE;
  PERFORM pg_temp.eq('reported as finding it',
    (SELECT string_agg((a->>'email') || ' ' || (a->>'before') || '>' || (a->>'after')
                       || ' finds ' || (a->>'findsBefore') || '>' || (a->>'findsAfter'), ',')
     FROM jsonb_array_elements(v_result->'accounts') a),
    'cleo.family@test.ch true>true finds false>true');
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- A kept row with a status link of its own keeps it: the dropped row's
-- trial history does not overwrite it, and its link is reported as ending
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_keep_token uuid := gen_random_uuid();
  v_drop_token uuid;
  v_result jsonb;
BEGIN
  INSERT INTO public.members (id, firstname, lastname, labels, "trialToken") VALUES (930, 'Noa', 'Token', '[]', v_keep_token);
  INSERT INTO public.members (id, firstname, lastname, labels, "trialRegisteredAt")
  VALUES (10000930, 'Noa', 'Token', '["probetraining"]', now());
  v_drop_token := (SELECT "trialToken" FROM public.members WHERE id = 10000930);
  PERFORM pg_temp.ok('fixture: both have a status link', v_drop_token IS NOT NULL
    AND (SELECT "trialStatus" IS NULL AND "trialRegisteredAt" IS NULL FROM public.members WHERE id = 930));

  PERFORM pg_temp.as_admin();
  v_result := public.merge_members(930, 10000930);
  RESET ROLE;
  PERFORM pg_temp.ok('the kept row''s link stays', (SELECT "trialToken" = v_keep_token FROM public.members WHERE id = 930));
  PERFORM pg_temp.eq('trial history not taken over', v_result->'fields'->>'trial', 'keep');
  PERFORM pg_temp.ok('the dropped link is reported as ending', v_result->'warnings' ? 'TRIAL_LINK_ENDS');
  PERFORM pg_temp.ok('and it ends', public.get_trial_status(v_drop_token) IS NULL);
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- A chain of merges: the log follows the member that stays; differing
-- contact data stays the kept row's and is reported
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_result jsonb;
BEGIN
  INSERT INTO public.members (id, firstname, lastname, labels, birthday, mobile) VALUES
    (911, 'Ada', 'Chain', '[]', '2010-01-01', NULL),
    (912, 'Ada', 'Chain', '[]', '2010-01-02', '079 000 00 00'),
    (913, 'Ada', 'Chain', '[]', NULL, NULL);
  PERFORM pg_temp.as_admin();
  v_result := public.merge_members(911, 912);
  PERFORM pg_temp.eq('differing birthday kept, mobile filled',
    (v_result->'fields'->>'birthday') || ' ' || (v_result->'fields'->>'mobile'), 'kept_differs from_drop');
  v_result := public.merge_members(913, 911);
  RESET ROLE;
  PERFORM pg_temp.eq('earlier merge now names the member that stays',
    (SELECT string_agg(kept_id || '<' || dropped_id, ',' ORDER BY id) FROM public.member_merges), '913<912,913<911');
  PERFORM pg_temp.eq('reported', v_result->'moved'->>'member_merges.kept_id', '{"moved": 1, "merged": 0}');
  PERFORM pg_temp.eq('fields filled along the chain', (SELECT birthday || ' ' || mobile FROM public.members WHERE id = 913),
    '2010-01-01 079 000 00 00');
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- Exam days, accounts
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_result jsonb;
  v_conflict jsonb;
BEGIN
  INSERT INTO public.members (id, firstname, lastname, labels) VALUES
    (906, 'Eva', 'Exam', '[]'), (907, 'Eva', 'Exam', '[]'), (908, 'Udo', 'User', '[]'), (909, 'Udo', 'User', '[]'),
    (916, 'Ina', 'Exam', '[]'), (917, 'Ina', 'Exam', '[]'), (918, 'Ole', 'Exam', '[]'), (919, 'Ole', 'Exam', '[]');
  -- Both on exam 2, each with its own trainer and notes: 906 called up by
  -- the TK, 907's sheet started
  INSERT INTO public.exam_candidates (id, exam_id, member_id, section, grade, status, trainer, note, staff_note, belt_length_cm) VALUES
    (990002, 2, 906, 'Judo', '4. Kyu', 'invited', 'Eva', 'Brille', 'Mutter holt ab 18:00', 240),
    (990003, 2, 907, 'Judo', '4. Kyu', 'registered', 'Hans', 'Gürtel 220', 'Knie verletzt: nur Kata', NULL);
  UPDATE public.exam_candidates SET started_at = now() WHERE id = 990003;

  PERFORM pg_temp.as_admin();
  v_result := public.merge_members(906, 907);
  RESET ROLE;
  PERFORM pg_temp.eq('the started sheet stays, called up, with the notes of both and the empty fields filled',
    (SELECT string_agg(id || ' ' || member_id || ' ' || status || ' ' || trainer || ' | ' || note || ' | ' || staff_note
                       || ' | ' || belt_length_cm, ',')
     FROM public.exam_candidates WHERE exam_id = 2 AND member_id IN (906, 907)),
    '990003 906 invited Hans | Gürtel 220 / Brille | Knie verletzt: nur Kata / Mutter holt ab 18:00 | 240');
  v_conflict := (SELECT c FROM jsonb_array_elements(v_result->'conflicts') c WHERE c->>'ref' = 'exam_candidates.member_id');
  PERFORM pg_temp.eq('exam conflict: the removed registration as it was',
    (v_conflict->>'kept') || ' ' || (v_conflict->>'reason') || ' ' || (v_conflict->'removed')::text,
    'drop sheet ' || '{"status": "invited", "grade": "4. Kyu", "trainer": "Eva", "note": "Brille", "staffNote": "Mutter holt ab 18:00"}'::jsonb::text);
  PERFORM pg_temp.ok('and the log keeps it', (SELECT result->'conflicts' @> jsonb_build_array(v_conflict)
    FROM public.member_merges WHERE id = (v_result->>'mergeId')::bigint));

  -- No sheet: the further registration stays (another grade here) and
  -- takes the other's notes and trainer
  INSERT INTO public.exam_candidates (id, exam_id, member_id, section, grade, status, trainer, note, staff_note) VALUES
    (990005, 2, 916, 'Judo', '4. Kyu', 'withdrawn', 'Eva', 'Doppelt angemeldet', NULL),
    (990006, 2, 917, 'Judo', '3. Kyu', 'registered', NULL, 'Neu', 'Zahlt bar');
  PERFORM pg_temp.as_admin();
  v_result := public.merge_members(916, 917);
  RESET ROLE;
  PERFORM pg_temp.eq('no sheet: the further one stays with the other''s notes and trainer',
    (SELECT string_agg(id || ' ' || member_id || ' ' || status || ' ' || grade || ' ' || trainer || ' | ' || note || ' | ' || staff_note, ',')
     FROM public.exam_candidates WHERE exam_id = 2 AND member_id IN (916, 917)),
    '990006 916 registered 3. Kyu Eva | Neu / Doppelt angemeldet | Zahlt bar');
  v_conflict := (SELECT c FROM jsonb_array_elements(v_result->'conflicts') c WHERE c->>'ref' = 'exam_candidates.member_id');
  PERFORM pg_temp.eq('its conflict entry names the removed grade and status',
    concat_ws(' ', v_conflict->>'kept', v_conflict->>'reason', v_conflict->'removed'->>'status', v_conflict->'removed'->>'grade'),
    'drop status withdrawn 4. Kyu');

  -- The kept member's sheet, withdrawn after it started: it stays and is
  -- back with the other's status
  INSERT INTO public.exam_candidates (id, exam_id, member_id, section, grade, status, trainer, note) VALUES
    (990007, 2, 918, 'Judo', '4. Kyu', 'withdrawn', NULL, 'Verletzt'),
    (990008, 2, 919, 'Judo', '4. Kyu', 'registered', 'Hans', 'Wieder fit');
  UPDATE public.exam_candidates SET started_at = now() WHERE id = 990007;
  PERFORM pg_temp.as_admin();
  v_result := public.merge_members(918, 919);
  RESET ROLE;
  PERFORM pg_temp.eq('kept sheet: stays, further status, notes of both',
    (SELECT string_agg(id || ' ' || member_id || ' ' || status || ' ' || trainer || ' | ' || note, ',')
     FROM public.exam_candidates WHERE exam_id = 2 AND member_id IN (918, 919)),
    '990007 918 registered Hans | Verletzt / Wieder fit');
  PERFORM pg_temp.eq('reported as the kept sheet',
    (SELECT (c->>'kept') || ' ' || (c->>'reason') FROM jsonb_array_elements(v_result->'conflicts') c), 'keep sheet');

  -- Both examined on the same day: refused
  INSERT INTO public.members (id, firstname, lastname, labels) VALUES (910, 'Eva', 'Exam', '[]');
  INSERT INTO public.exam_candidates (id, exam_id, member_id, section, grade) VALUES (990004, 2, 910, 'Judo', '4. Kyu');
  UPDATE public.exam_candidates SET started_at = now() WHERE id = 990004;
  PERFORM pg_temp.as_admin();
  PERFORM pg_temp.eq('both examined the same day', pg_temp.refusal(906, 910), 'EXAM_CONFLICT P0001');

  -- Both linked to an account
  RESET ROLE;
  PERFORM pg_temp.sign_up('20000000-0000-4000-8000-000000000008', 'udo1@test.ch');
  PERFORM pg_temp.sign_up('20000000-0000-4000-8000-000000000009', 'udo2@test.ch');
  UPDATE public.user_profiles SET member_id = 908 WHERE user_id = '20000000-0000-4000-8000-000000000008';
  UPDATE public.user_profiles SET member_id = 909 WHERE user_id = '20000000-0000-4000-8000-000000000009';
  PERFORM pg_temp.as_admin();
  PERFORM pg_temp.eq('both linked to an account', pg_temp.refusal(908, 909), 'ACCOUNT_CONFLICT P0001');
  RESET ROLE;
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- A foreign key the merge does not know: refused before anything moves
-----------------

SAVEPOINT s;
DO $$
BEGIN
  CREATE TABLE public.merge_check_extra (member_id integer REFERENCES public.members (id) ON DELETE CASCADE);
  INSERT INTO public.merge_check_extra VALUES (10000901);
  PERFORM pg_temp.as_admin();
  PERFORM pg_temp.eq('unknown foreign key: refused', pg_temp.refusal(5901, 10000901), 'UNHANDLED_REFERENCE P0001');
  RESET ROLE;
  PERFORM pg_temp.ok('nothing moved', EXISTS (SELECT 1 FROM public.merge_check_extra WHERE member_id = 10000901)
    AND EXISTS (SELECT 1 FROM public.logs WHERE "memberId" = 10000901));
END $$;
ROLLBACK TO SAVEPOINT s;

ROLLBACK;

\o
\echo 'merge_members: all checks passed'
