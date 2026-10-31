-- Checks for editing grade ladders in the app
-- (20261109120000_editable_grade_ladders.sql, docs/GRADE_LADDERS.md).
--
-- Runs like member_access.sql: on a database with every migration and the
-- seed, as postgres, inside one transaction that is rolled back. A failed
-- check raises and stops:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/checks/grade_ladders.sql
--
--   A  only admins save a ladder; nobody writes grade_definitions directly
--   L  a new ladder for another sport, ranks 1..n, deleted again with []
--   R  a rename moves gradings, exam registrations and programs along;
--      two grades swap names; a reorder keeps ranks 1..n and the next grade
--   D  a grade still used is not deleted, an unused one is
--   V  bad input is refused and changes nothing
--   B  a grade that becomes a dan gives its holders the black belt badge

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

-- The SQLSTATE a statement raises, '' when it does not (rolled back then)
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

-- A section's ladder as the editor sends it back unchanged
CREATE FUNCTION pg_temp.ladder(p_section text) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'grade', grade, 'previous', grade, 'beltColor', "beltColor",
           'beltColor2', "beltColor2", 'isDan', "isDan") ORDER BY "gradeRank"), '[]')
  FROM public.grade_definitions WHERE section = p_section;
$$;

-- Grades of a section, lowest first: '6. Kyu,5.5 Kyu,…'
CREATE FUNCTION pg_temp.grades(p_section text) RETURNS text
LANGUAGE sql AS $$
  SELECT string_agg(grade, ',' ORDER BY "gradeRank") FROM public.grade_definitions WHERE section = p_section;
$$;

-- Ranks are exactly 1..n
CREATE FUNCTION pg_temp.ranks_ok(p_section text) RETURNS boolean
LANGUAGE sql AS $$
  SELECT coalesce(bool_and(r = n), true) FROM (
    SELECT "gradeRank" AS r, row_number() OVER (ORDER BY "gradeRank") AS n
    FROM public.grade_definitions WHERE section = p_section) x;
$$;

-- Save as an account; the SQLSTATE, '' when it worked
CREATE FUNCTION pg_temp.save_as(p_id uuid, p_section text, p_grades jsonb) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v text;
BEGIN
  PERFORM pg_temp.act_as(p_id);
  v := pg_temp.state(format('SELECT public.save_grade_ladder(%L, %L::jsonb)', p_section, p_grades));
  RESET ROLE;
  RETURN v;
END $$;

-----------------
-- Test data
-----------------

SELECT pg_temp.sign_up('30000000-0000-4000-8000-000000000001', 'leiter.admin@test.ch', 'approved', 'admin');
SELECT pg_temp.sign_up('30000000-0000-4000-8000-000000000002', 'leiter.trainer@test.ch', 'approved', 'trainer');
SELECT pg_temp.sign_up('30000000-0000-4000-8000-000000000003', 'leiter.viewer@test.ch', 'approved', 'viewer');
SELECT pg_temp.sign_up('30000000-0000-4000-8000-000000000004', 'leiter.member@test.ch', 'approved', 'member');
UPDATE public.user_profiles SET exam_role = 'manager'
 WHERE user_id = '30000000-0000-4000-8000-000000000002';

CREATE TEMP TABLE ids (k text PRIMARY KEY, v uuid);
INSERT INTO ids VALUES
  ('admin',   '30000000-0000-4000-8000-000000000001'),
  ('trainer', '30000000-0000-4000-8000-000000000002'),
  ('viewer',  '30000000-0000-4000-8000-000000000003'),
  ('member',  '30000000-0000-4000-8000-000000000004');
GRANT SELECT ON ids TO authenticated;

CREATE TEMP TABLE before AS
SELECT pg_temp.grades('Judo') AS judo, pg_temp.grades('Aikido') AS aikido;

-----------------
-- A  who saves
-----------------

SELECT pg_temp.ok('A seeded ladders have ranks 1..n', pg_temp.ranks_ok('Judo') AND pg_temp.ranks_ok('Aikido'));

SELECT pg_temp.eq('A an unchanged save works for admins',
  pg_temp.save_as((SELECT v FROM ids WHERE k = 'admin'), 'Judo', pg_temp.ladder('Judo')), '');
SELECT pg_temp.eq('A … and changes nothing', pg_temp.grades('Judo'), (SELECT judo FROM before));

SELECT pg_temp.eq('A trainers (also the TK) do not save',
  pg_temp.save_as((SELECT v FROM ids WHERE k = 'trainer'), 'Judo', '[]'), '42501');
SELECT pg_temp.eq('A viewers do not save',
  pg_temp.save_as((SELECT v FROM ids WHERE k = 'viewer'), 'Judo', '[]'), '42501');
SELECT pg_temp.eq('A member accounts do not save',
  pg_temp.save_as((SELECT v FROM ids WHERE k = 'member'), 'Judo', '[]'), '42501');
SELECT pg_temp.ok('A anon may not call it',
  NOT has_function_privilege('anon', 'public.save_grade_ladder(text, jsonb)', 'EXECUTE'));
SELECT pg_temp.eq('A … nothing changed', pg_temp.grades('Judo'), (SELECT judo FROM before));

-- No write policy: not even admins write the table directly
SELECT pg_temp.act_as((SELECT v FROM ids WHERE k = 'admin'));
SELECT pg_temp.eq('A admins do not insert directly', pg_temp.state(
  $$INSERT INTO public.grade_definitions (section, grade, "gradeRank", "beltColor", "isDan")
    VALUES ('Karate', 'x', 1, '#ffffff', false)$$), '42501');
SELECT pg_temp.eq('A admins do not update directly', pg_temp.state(
  $$UPDATE public.grade_definitions SET grade = 'x' WHERE section = 'Judo' AND grade = '6. Kyu' RETURNING 1 / ("gradeRank" - "gradeRank")$$), '');
RESET ROLE;
SELECT pg_temp.eq('A … the update touched nothing', pg_temp.grades('Judo'), (SELECT judo FROM before));

-----------------
-- L  a new ladder
-----------------

SELECT pg_temp.eq('L admins create a ladder for another section',
  pg_temp.save_as((SELECT v FROM ids WHERE k = 'admin'), ' Karate ', $$[
    {"grade": "9. Kyu", "previous": null, "beltColor": "#ffffff", "beltColor2": null, "isDan": false},
    {"grade": "8. Kyu", "previous": null, "beltColor": "#f4d03f", "beltColor2": "", "isDan": false},
    {"grade": "1. Dan", "previous": null, "beltColor": "#111111", "isDan": true}
  ]$$), '');
SELECT pg_temp.eq('L the section name is trimmed, the grades in order',
  pg_temp.grades('Karate'), '9. Kyu,8. Kyu,1. Dan');
SELECT pg_temp.ok('L ranks 1..n', pg_temp.ranks_ok('Karate'));
SELECT pg_temp.ok('L an empty second colour is none',
  (SELECT "beltColor2" IS NULL FROM public.grade_definitions WHERE section = 'Karate' AND grade = '8. Kyu'));

SELECT pg_temp.eq('L a grade added in the middle',
  pg_temp.save_as((SELECT v FROM ids WHERE k = 'admin'), 'Karate', $$[
    {"grade": "9. Kyu", "previous": "9. Kyu", "beltColor": "#ffffff", "isDan": false},
    {"grade": "8. Kyu", "previous": "8. Kyu", "beltColor": "#f4d03f", "isDan": false},
    {"grade": "7. Kyu", "previous": null, "beltColor": "#f0932b", "isDan": false},
    {"grade": "1. Dan", "previous": "1. Dan", "beltColor": "#111111", "isDan": true}
  ]$$), '');
SELECT pg_temp.eq('L … sits in the middle', pg_temp.grades('Karate'), '9. Kyu,8. Kyu,7. Kyu,1. Dan');
SELECT pg_temp.ok('L … ranks 1..n', pg_temp.ranks_ok('Karate'));

SELECT pg_temp.eq('L an empty list deletes an unused ladder',
  pg_temp.save_as((SELECT v FROM ids WHERE k = 'admin'), 'Karate', '[]'), '');
SELECT pg_temp.eq('L … gone', pg_temp.grades('Karate'), NULL);

-----------------
-- R  rename, swap, reorder
-----------------

-- A grading, an exam registration and a program on 1. Kyu
INSERT INTO public.member_grades ("memberId", section, grade, "examDate")
SELECT 103, 'Judo', '1. Kyu', '2026-01-10'
WHERE NOT EXISTS (SELECT 1 FROM public.member_grades WHERE "memberId" = 103 AND section = 'Judo' AND grade = '1. Kyu');
INSERT INTO public.exam_programs (section, grade, title, min_points)
SELECT 'Judo', '1. Kyu', 'Braungurt', 10
WHERE NOT EXISTS (SELECT 1 FROM public.exam_programs WHERE section = 'Judo' AND grade = '1. Kyu');

CREATE TEMP TABLE used AS
SELECT (SELECT count(*) FROM public.member_grades) AS total,
       (SELECT count(*) FROM public.member_grades WHERE section = 'Judo' AND grade = '1. Kyu') AS gradings,
       (SELECT count(*) FROM public.exam_candidates WHERE section = 'Judo' AND grade = '1. Kyu') AS candidates,
       (SELECT count(*) FROM public.exam_programs WHERE section = 'Judo' AND grade = '1. Kyu') AS programs;

SELECT pg_temp.eq('R rename 1. Kyu',
  pg_temp.save_as((SELECT v FROM ids WHERE k = 'admin'), 'Judo',
    (SELECT jsonb_agg(CASE WHEN e->>'grade' = '1. Kyu' THEN e || '{"grade": "1. Kyu (braun)"}' ELSE e END)
     FROM jsonb_array_elements(pg_temp.ladder('Judo')) e)), '');
SELECT pg_temp.eq('R … gradings moved along',
  (SELECT count(*) FROM public.member_grades WHERE section = 'Judo' AND grade = '1. Kyu (braun)')::text,
  (SELECT gradings FROM used)::text);
SELECT pg_temp.eq('R … exam registrations moved along',
  (SELECT count(*) FROM public.exam_candidates WHERE section = 'Judo' AND grade = '1. Kyu (braun)')::text,
  (SELECT candidates FROM used)::text);
SELECT pg_temp.eq('R … the program moved along',
  (SELECT count(*) FROM public.exam_programs WHERE section = 'Judo' AND grade = '1. Kyu (braun)')::text,
  (SELECT programs FROM used)::text);
SELECT pg_temp.eq('R … no grading lost', (SELECT count(*) FROM public.member_grades)::text,
  (SELECT total FROM used)::text);
SELECT pg_temp.ok('R … ranks unchanged', pg_temp.ranks_ok('Judo'));

-- Swap two names (no new grade, no delete) and back
SELECT pg_temp.eq('R two grades swap names',
  pg_temp.save_as((SELECT v FROM ids WHERE k = 'admin'), 'Aikido',
    (SELECT jsonb_agg(CASE e->>'grade' WHEN '4. Dan' THEN e || '{"grade": "5. Dan"}'
                                      WHEN '5. Dan' THEN e || '{"grade": "4. Dan"}' ELSE e END)
     FROM jsonb_array_elements(pg_temp.ladder('Aikido')) e)), '');
SELECT pg_temp.eq('R … swapped', (SELECT string_agg(grade, ',' ORDER BY "gradeRank") FROM public.grade_definitions
  WHERE section = 'Aikido' AND "isDan" AND grade IN ('4. Dan', '5. Dan')), '5. Dan,4. Dan');

-- Reorder Aikido back by sending the dan grades in the right order
SELECT pg_temp.eq('R a reorder',
  pg_temp.save_as((SELECT v FROM ids WHERE k = 'admin'), 'Aikido',
    (SELECT jsonb_agg(e ORDER BY CASE e->>'grade' WHEN '4. Dan' THEN 100 WHEN '5. Dan' THEN 101 ELSE n END)
     FROM jsonb_array_elements(pg_temp.ladder('Aikido')) WITH ORDINALITY AS x(e, n))), '');
SELECT pg_temp.eq('R … back to the seeded order', pg_temp.grades('Aikido'), (SELECT aikido FROM before));
SELECT pg_temp.ok('R … ranks 1..n', pg_temp.ranks_ok('Aikido'));

-- The next grade follows the ladder: member 103's current Judo grade
SELECT pg_temp.eq('R the next grade follows the edited ladder',
  (SELECT "nextGrade" FROM public.get_member_current_grades(103) WHERE section = 'Judo'),
  (SELECT g2.grade FROM public.grade_definitions g2
   WHERE g2.section = 'Judo' AND g2."gradeRank" = (
     SELECT max(g."gradeRank") + 1 FROM public.member_grades mg
     JOIN public.grade_definitions g ON g.section = mg.section AND g.grade = mg.grade
     WHERE mg."memberId" = 103 AND mg.section = 'Judo')));

-----------------
-- D  deletes
-----------------

SELECT pg_temp.eq('D a used grade is not deleted',
  pg_temp.save_as((SELECT v FROM ids WHERE k = 'admin'), 'Judo',
    (SELECT jsonb_agg(e) FROM jsonb_array_elements(pg_temp.ladder('Judo')) e
     WHERE e->>'grade' <> '1. Kyu (braun)')), '23503');
SELECT pg_temp.ok('D … still there',
  EXISTS (SELECT 1 FROM public.grade_definitions WHERE section = 'Judo' AND grade = '1. Kyu (braun)'));

SELECT pg_temp.eq('D an unused grade is deleted',
  pg_temp.save_as((SELECT v FROM ids WHERE k = 'admin'), 'Aikido',
    (SELECT jsonb_agg(e) FROM jsonb_array_elements(pg_temp.ladder('Aikido')) e
     WHERE e->>'grade' <> '5. Dan')), '');
SELECT pg_temp.ok('D … gone, ranks 1..n',
  NOT EXISTS (SELECT 1 FROM public.grade_definitions WHERE section = 'Aikido' AND grade = '5. Dan')
  AND pg_temp.ranks_ok('Aikido'));

-----------------
-- V  bad input
-----------------

CREATE TEMP TABLE bad (name text, section text, grades jsonb, state text);
INSERT INTO bad VALUES
  ('no section',        ' ',      '[]', '22023'),
  ('not an array',      'Karate', '{}', '22023'),
  ('not an object',     'Karate', '["x"]', '22023'),
  ('empty name',        'Karate', '[{"grade": " ", "beltColor": "#ffffff", "isDan": false}]', '22023'),
  ('no dan flag',       'Karate', '[{"grade": "x", "beltColor": "#ffffff"}]', '22023'),
  ('bad colour',        'Karate', '[{"grade": "x", "beltColor": "url(x)", "isDan": false}]', '22023'),
  ('no colour',         'Karate', '[{"grade": "x", "isDan": false}]', '22023'),
  ('bad second colour', 'Karate', '[{"grade": "x", "beltColor": "#fff", "beltColor2": "1;", "isDan": false}]', '22023'),
  ('duplicate name',    'Karate', '[{"grade": "A", "beltColor": "#fff", "isDan": false}, {"grade": "a", "beltColor": "#fff", "isDan": false}]', '23505'),
  ('unknown previous',  'Karate', '[{"grade": "A", "previous": "nope", "beltColor": "#fff", "isDan": false}]', '40001');

SELECT pg_temp.eq('V ' || name,
  pg_temp.save_as((SELECT v FROM ids WHERE k = 'admin'), section, grades), state)
FROM bad;
SELECT pg_temp.eq('V … nothing saved', pg_temp.grades('Karate'), NULL);

SELECT pg_temp.eq('V the same grade kept twice',
  pg_temp.save_as((SELECT v FROM ids WHERE k = 'admin'), 'Aikido',
    pg_temp.ladder('Aikido') || jsonb_build_array(pg_temp.ladder('Aikido')->0 || '{"grade": "copy"}')), '22023');

-----------------
-- B  badges
-----------------

-- Member 103 holds Aikido 6. Kyu; make it a dan grade and back
SELECT pg_temp.ok('B no black belt before',
  NOT EXISTS (SELECT 1 FROM public.member_badges WHERE "memberId" = 103 AND "badgeId" = 'black_belt')
  OR EXISTS (SELECT 1 FROM public.member_grades mg JOIN public.grade_definitions g
             ON g.section = mg.section AND g.grade = mg.grade WHERE mg."memberId" = 103 AND g."isDan"));
DELETE FROM public.member_grades mg USING public.grade_definitions g
 WHERE g.section = mg.section AND g.grade = mg.grade AND mg."memberId" = 103 AND g."isDan";
SELECT pg_temp.eq('B a grade becomes a dan',
  pg_temp.save_as((SELECT v FROM ids WHERE k = 'admin'), 'Aikido',
    (SELECT jsonb_agg(CASE WHEN e->>'grade' = '6. Kyu' THEN e || '{"isDan": true}' ELSE e END)
     FROM jsonb_array_elements(pg_temp.ladder('Aikido')) e)), '');
SELECT pg_temp.ok('B … its holders get the black belt',
  EXISTS (SELECT 1 FROM public.member_badges WHERE "memberId" = 103 AND "badgeId" = 'black_belt'));
SELECT pg_temp.eq('B and back',
  pg_temp.save_as((SELECT v FROM ids WHERE k = 'admin'), 'Aikido',
    (SELECT jsonb_agg(CASE WHEN e->>'grade' = '6. Kyu' THEN e || '{"isDan": false}' ELSE e END)
     FROM jsonb_array_elements(pg_temp.ladder('Aikido')) e)), '');
SELECT pg_temp.ok('B … the badge is gone again',
  NOT EXISTS (SELECT 1 FROM public.member_badges WHERE "memberId" = 103 AND "badgeId" = 'black_belt'));

ROLLBACK;

\o
\echo 'grade_ladders: all checks passed'
