-- Demo club for the public demo at demo.alleda.ch: "Budo-Club Musterwil".
--
-- A made-up club with a Judo and an Aikido section: ~125 members (trial
-- candidates, passive members and people who left included), 9 trainings,
-- two years of attendance, events, grades and medals, a finished and an
-- upcoming Q-Prüfung, a training plan, trial candidates and three one-click
-- demo logins. Nothing here comes from a real club; names, places and
-- trainings are invented.
--
-- Applied weekly (Monday ~04:00 Swiss time) by .github/workflows/demo-reset.yml
-- after `supabase db reset --db-url … --no-seed` (all migrations, empty
-- database, never supabase/seed.sql), in one transaction:
--   psql "$DEMO_DB_URL" -1 -v ON_ERROR_STOP=1 -q -f supabase/demo/seed.sql
--   psql "$DEMO_DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/checks/demo_seed.sql
-- Locally: `npx supabase db reset --no-seed`, then the same two commands
-- against postgresql://postgres:postgres@127.0.0.1:54322/postgres.
--
-- Every date is relative to current_date / now(), so each reset produces the
-- same club shifted in time; it must look right for the 7 days until the next
-- reset (upcoming exam deadline, events and plan reach far enough ahead).
-- Pseudo randomness is hash based (pg_temp.h), never random().
--
-- This file is PUBLIC, and so are the demo logins below: every demo account
-- has the password 'administra-demo' by design. The guards at the end keep a
-- visitor from locking everybody else out until the next reset.
--
-- Keep it in sync with supabase/migrations/: CI applies it after the
-- migrations and runs supabase/checks/demo_seed.sql, so a migration that
-- breaks it fails there. Content is German (the club's language), comments
-- are English.

-- ---------------------------------------------------------------------------
-- Session setup
-- ---------------------------------------------------------------------------

-- Badges are computed once at the end (refresh_all_member_badges), not per
-- inserted row. Transaction-local: the seed runs under psql -1.
-- (DO/PERFORM instead of SELECT keeps psql's output quiet)
DO $$
BEGIN
  PERFORM set_config('app.skip_badge_refresh', 'true', true);
  PERFORM set_config('statement_timeout', '0', true);
END $$;

-- Only on a database that holds nothing yet (right after the reset): run
-- against a real club by mistake, this file would add a public-password
-- admin and the marker that lets the reset workflow wipe the database.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users) OR EXISTS (SELECT 1 FROM public.members) THEN
    RAISE EXCEPTION 'The demo seed only runs on an empty database (after supabase db reset)'
      USING HINT = 'Check the connection string: this database already has users or members.';
  END IF;
END $$;

-- No bootstrap admin in the demo (the migration inserts the real club's)
DELETE FROM public.bootstrap_admins;

-- A hosted project has no avatars bucket unless config.toml created it
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', false, 5242880, ARRAY['image/webp', 'image/png', 'image/jpeg'])
ON CONFLICT (id) DO NOTHING;

-- Anyone may upload lesson plans in the demo (one-click trainer login), so
-- the bucket takes only what the app's upload offers (LessonPlan.svelte),
-- up to 10 MB: no free file hosting for strangers
UPDATE storage.buckets
SET file_size_limit = 10485760,
    allowed_mime_types = ARRAY[
      'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
WHERE id = 'lesson-plans';

-- ---------------------------------------------------------------------------
-- Helpers (pg_temp: gone when the session ends)
-- ---------------------------------------------------------------------------

-- Deterministic "random" number 0..99 for a key
CREATE FUNCTION pg_temp.h(p text) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT ((hashtext(p) % 100) + 100) % 100;
$$;

-- 'YYYY-MM-DD', the format of every date column the app stores as text
CREATE FUNCTION pg_temp.ds(p date) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(p, 'YYYY-MM-DD');
$$;

-- The Saturday on or before / on or after current_date + n
CREATE FUNCTION pg_temp.sat_before(n integer) RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT d - ((extract(isodow FROM d)::int + 1) % 7) FROM (SELECT current_date + n AS d) x;
$$;
CREATE FUNCTION pg_temp.sat_after(n integer) RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT d + ((13 - extract(isodow FROM d)::int) % 7) FROM (SELECT current_date + n AS d) x;
$$;

-- English weekday name as stored in trainings.weekday (locale independent)
CREATE FUNCTION pg_temp.wd(p date) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT (ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
                'Sunday'])[extract(isodow FROM p)::int];
$$;

-- Club holidays: no training from Dec 24 to Jan 4; in the summer holidays
-- only the adult trainings marked "summer" keep going
CREATE FUNCTION pg_temp.is_xmas(p date) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(p, 'MM-DD') >= '12-24' OR to_char(p, 'MM-DD') <= '01-04';
$$;
CREATE FUNCTION pg_temp.is_summer(p date) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(p, 'MM-DD') BETWEEN '07-11' AND '08-10';
$$;

-- The same weekday moved week by week (p_dir -1 back, +1 ahead) out of the
-- Christmas and summer breaks
CREATE FUNCTION pg_temp.off_break(p date, p_dir integer) RETURNS date
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  WHILE pg_temp.is_xmas(p) OR pg_temp.is_summer(p) LOOP
    p := p + 7 * p_dir;
  END LOOP;
  RETURN p;
END $$;

-- Exam days, events and competitions: a Saturday outside the breaks and not
-- already taken by another of them (moved away from today, so past stays
-- past and upcoming stays upcoming). Assigned once per key, read with dd().
CREATE TEMP TABLE demo_days (key text PRIMARY KEY, d date NOT NULL UNIQUE);
CREATE FUNCTION pg_temp.day(p_key text, p date) RETURNS date
LANGUAGE plpgsql AS $$
DECLARE
  v_dir integer := CASE WHEN p < current_date THEN -1 ELSE 1 END;
BEGIN
  LOOP
    p := pg_temp.off_break(p, v_dir);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM demo_days WHERE d = p);
    p := p + 7 * v_dir;
  END LOOP;
  INSERT INTO demo_days (key, d) VALUES (p_key, p);
  RETURN p;
END $$;
CREATE FUNCTION pg_temp.dd(p_key text) RETURNS date
LANGUAGE plpgsql STABLE STRICT AS $$
DECLARE
  v date;
BEGIN
  SELECT d INTO v FROM demo_days WHERE key = p_key;
  IF v IS NULL THEN
    RAISE EXCEPTION 'demo day % not assigned', p_key;
  END IF;
  RETURN v;
END $$;

-- E-mail local part: lower case ASCII letters only
CREATE FUNCTION pg_temp.slug(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
    translate(lower(p), 'äöüéèêëàâáçïîôóšćčžğışñãõú', 'aoueeeeaaaciiooscczgisnaou'),
    '[^a-z]', '', 'g');
$$;

-- Swiss mobile number, e.g. '079 412 33 08'
CREATE FUNCTION pg_temp.mobile(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT '07' || (6 + pg_temp.h(p || ':pre') % 4)::text || ' '
         || substr(n, 1, 3) || ' ' || substr(n, 4, 2) || ' ' || substr(n, 6, 2)
  FROM (SELECT lpad((((hashtext(p)::bigint % 10000000) + 10000000) % 10000000)::text, 7, '0')
        AS n) x;
$$;

-- Competition category from age, gender and a per-member seed, e.g.
-- 'U13 -38 kg' (mixed weights up to U13, then women's and men's classes;
-- 30 and older start as Masters)
CREATE FUNCTION pg_temp.medal_cat(p_age integer, p_female boolean, p_seed text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT c.cls || ' ' || c.w[1 + pg_temp.h(p_seed || c.cls) % array_length(c.w, 1)]
  FROM (SELECT
    CASE WHEN p_age < 9 THEN 'U9' WHEN p_age < 11 THEN 'U11' WHEN p_age < 13 THEN 'U13'
         WHEN p_age < 15 THEN 'U15' WHEN p_age < 18 THEN 'U18' WHEN p_age < 30 THEN 'Elite'
         ELSE 'Masters' END
      || CASE WHEN p_age >= 13 THEN CASE WHEN p_female THEN ' Frauen' ELSE ' Männer' END
              ELSE '' END AS cls,
    CASE WHEN p_age < 9 THEN ARRAY['-24 kg', '-27 kg', '-30 kg']
         WHEN p_age < 11 THEN ARRAY['-27 kg', '-30 kg', '-34 kg', '-38 kg']
         WHEN p_age < 13 THEN ARRAY['-34 kg', '-38 kg', '-42 kg', '-46 kg']
         WHEN p_age < 15 AND p_female THEN ARRAY['-40 kg', '-44 kg', '-48 kg', '-52 kg']
         WHEN p_age < 15 THEN ARRAY['-40 kg', '-45 kg', '-50 kg', '-55 kg']
         WHEN p_age < 18 AND p_female THEN ARRAY['-48 kg', '-52 kg', '-57 kg', '-63 kg']
         WHEN p_age < 18 THEN ARRAY['-55 kg', '-60 kg', '-66 kg', '-73 kg']
         WHEN p_female THEN ARRAY['-52 kg', '-57 kg', '-63 kg', '-70 kg', '-78 kg']
         ELSE ARRAY['-66 kg', '-73 kg', '-81 kg', '-90 kg'] END AS w) c;
$$;

-- ---------------------------------------------------------------------------
-- Club settings (shown on the public trial page; guarded at the end)
-- ---------------------------------------------------------------------------

INSERT INTO public.app_settings (key, value) VALUES
  ('club.name', '"Budo-Club Musterwil"'),
  ('club.url', '"https://alleda.ch"'),
  ('club.logo', '"/brand/logo/administra-logo.svg"'),
  ('club.contactEmail', '"demo@alleda.ch"'),
  ('club.sections', '["Judo", "Aikido"]'),
  ('locale.default', '"de"');

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------
-- The roster drives everything below: age (birthday relative to today),
-- section, attendance level (k = keen 85 %, r = regular 65 %, o = occasional
-- 35 %), the trainings attended, joined / stopped (days ago; stopped = left,
-- passive or archived since then), labels, the highest grade reached
-- (grade_definitions."gradeRank", a cap: grades are dated from the join date,
-- see Grades) and notes. Ids < 1000 and no member_links: app-owned members,
-- status from labels (none = active). Trial candidates follow separately.

CREATE TEMP TABLE demo_roster (
  id integer PRIMARY KEY,
  firstname text NOT NULL,
  lastname text NOT NULL,
  age integer NOT NULL,
  sec text NOT NULL,
  lvl text NOT NULL,
  trainings integer[] NOT NULL,
  joined integer NOT NULL,
  stopped integer,
  labels jsonb NOT NULL,
  grade integer NOT NULL,
  notes text,
  bday date,
  section text,
  kid_ladder boolean,
  female boolean
);

INSERT INTO demo_roster (id, firstname, lastname, age, sec, lvl, trainings, joined, stopped,
                         labels, grade, notes) VALUES
  -- Trainers and board
  (101, 'Sandra', 'Keller', 46, 'A', 'k', '{8,9}', 9500, NULL, '["Vorstand"]', 9,
   'Präsidentin, leitet Aikido Erwachsene'),
  (102, 'Marco', 'Rossi', 39, 'J', 'r', '{5}', 11000, NULL, '["J+S-Leiter"]', 11,
   'Hauptleiter Kinder und Jugend'),
  (103, 'Claudia', 'Steiner', 41, 'A', 'r', '{8}', 3300, NULL, '["Vorstand"]', 6, 'Kassierin'),
  (104, 'Beat', 'Zürcher', 52, 'J', 'k', '{3,6}', 12500, NULL, '["Erwachsenentrainer"]', 10,
   NULL),
  (105, 'Nicole', 'Favre', 34, 'J', 'k', '{5,3}', 9800, NULL,
   '["Erwachsenentrainer", "J+S-Leiter"]', 11, 'Wettkampfverantwortliche'),
  (106, 'Goran', 'Petrović', 47, 'J', 'r', '{3}', 12000, NULL, '["Erwachsenentrainer"]', 12,
   NULL),
  (107, 'Ayşe', 'Demir', 24, 'J', 'r', '{3}', 6000, NULL, '["J+S-Leiter"]', 9, NULL),
  (108, 'Thushanth', 'Sivarajah', 31, 'A', 'r', '{8}', 7000, NULL, '["J+S-Leiter"]', 7, NULL),
  (109, 'Pascal', 'Rochat', 58, 'A', 'k', '{8}', 13000, NULL, '["Erwachsenentrainer"]', 8,
   NULL),
  (110, 'João', 'Ferreira', 19, 'J', 'k', '{5,3}', 4400, NULL, '[]', 8, 'Hilfsleiter'),
  -- Judo Kinder (6–10)
  (120, 'Lena', 'Brunner', 9, 'J', 'k', '{1,4}', 900, NULL, '[]', 3, NULL),
  (121, 'Noah', 'Müller', 8, 'J', 'r', '{1}', 600, NULL, '[]', 2, NULL),
  (122, 'Mia', 'Schneider', 7, 'J', 'r', '{1}', 400, NULL, '[]', 1, NULL),
  (123, 'Elias', 'Gashi', 10, 'J', 'k', '{1,4}', 1300, NULL, '[]', 4, NULL),
  (124, 'Emma', 'Rossier', 6, 'J', 'o', '{1}', 150, NULL, '[]', 0, NULL),
  (125, 'Luca', 'Ferrari', 9, 'J', 'r', '{1,4}', 1000, NULL, '[]', 3, NULL),
  (126, 'Sofia', 'Pereira', 8, 'J', 'k', '{1}', 700, NULL, '[]', 2, NULL),
  (127, 'Leon', 'Yilmaz', 10, 'J', 'r', '{1,4}', 1200, NULL, '[]', 4, NULL),
  (128, 'Lea', 'Baumann', 7, 'J', 'r', '{1}', 300, NULL, '[]', 1, NULL),
  (129, 'Gabriel', 'Morina', 9, 'J', 'o', '{1}', 800, NULL, '[]', 2, NULL),
  (130, 'Alina', 'Krasniqi', 10, 'J', 'k', '{1,4}', 1400, NULL, '[]', 5, NULL),
  (131, 'Julian', 'Studer', 6, 'J', 'r', '{1}', 90, NULL, '[]', 0, NULL),
  (132, 'Nina', 'Vuković', 8, 'J', 'o', '{1}', 500, NULL, '[]', 1, NULL),
  (133, 'Matteo', 'Bianchi', 7, 'J', 'k', '{1}', 380, NULL, '[]', 1, NULL),
  (134, 'Lara', 'Huber', 9, 'J', 'r', '{1,4}', 950, NULL, '[]', 3, NULL),
  (135, 'Tim', 'Gerber', 10, 'J', 'o', '{1}', 700, NULL, '[]', 2, NULL),
  (136, 'Anika', 'Ravichandran', 8, 'J', 'r', '{1}', 550, NULL, '[]', 2, NULL),
  (137, 'Liam', 'Ammann', 6, 'J', 'k', '{1}', 150, NULL, '[]', 0, NULL),
  (138, 'Chloé', 'Dubois', 9, 'J', 'k', '{1,4}', 1000, NULL, '[]', 4, NULL),
  (139, 'Diego', 'Santos', 7, 'J', 'o', '{1}', 250, NULL, '[]', 0, NULL),
  (140, 'Selin', 'Aydın', 10, 'J', 'r', '{1,4}', 1300, NULL, '[]', 4, NULL),
  (141, 'Nico', 'Wyss', 8, 'J', 'r', '{1}', 480, NULL, '[]', 1, NULL),
  (142, 'Ella', 'Frei', 6, 'J', 'r', '{1}', 60, NULL, '[]', 0, NULL),
  (143, 'Arian', 'Berisha', 9, 'J', 'k', '{1,4}', 900, NULL, '[]', 3, NULL),
  -- Judo Jugend (11–15)
  (150, 'Jonas', 'Brunner', 13, 'J', 'r', '{2}', 1800, NULL, '[]', 5, NULL),
  (151, 'Sara', 'Haldimann', 12, 'J', 'k', '{2,4}', 1500, NULL, '[]', 5, NULL),
  (152, 'David', 'Kovačević', 14, 'J', 'k', '{2,5}', 2200, NULL, '[]', 7, NULL),
  (153, 'Lina', 'Meier', 11, 'J', 'r', '{2,4}', 1100, NULL, '[]', 4, NULL),
  (154, 'Ben', 'Tanner', 15, 'J', 'r', '{2,5}', 2500, NULL, '[]', 7, NULL),
  (155, 'Aurélie', 'Monnier', 13, 'J', 'o', '{2}', 900, NULL, '[]', 3, NULL),
  (156, 'Samuel', 'Oliveira', 14, 'J', 'r', '{2}', 1600, NULL, '[]', 5, NULL),
  (157, 'Elif', 'Kaya', 12, 'J', 'r', '{2,4}', 1400, NULL, '[]', 4, NULL),
  (158, 'Robin', 'Graf', 15, 'J', 'k', '{2,5}', 2800, NULL, '[]', 8, NULL),
  (159, 'Valentina', 'Russo', 11, 'J', 'o', '{2}', 400, NULL, '[]', 1, NULL),
  (160, 'Kevin', 'Thurnherr', 13, 'J', 'r', '{2}', 1300, NULL, '[]', 4, NULL),
  (161, 'Amra', 'Hodžić', 14, 'J', 'k', '{2,5}', 1900, NULL, '[]', 6, NULL),
  (162, 'Fabio', 'Galli', 12, 'J', 'o', '{2}', 600, NULL, '[]', 2, NULL),
  (163, 'Jana', 'Lüthi', 15, 'J', 'r', '{2}', 2100, NULL, '[]', 6, NULL),
  (164, 'Dario', 'Marti', 11, 'J', 'k', '{2,4}', 1000, NULL, '[]', 3, NULL),
  (165, 'Mira', 'Sutter', 13, 'J', 'o', '{2}', 700, NULL, '[]', 2, NULL),
  (166, 'Yannick', 'Perrin', 14, 'J', 'r', '{2,5}', 1200, NULL, '[]', 5, NULL),
  (167, 'Nadia', 'Zeqiri', 12, 'J', 'r', '{2}', 800, NULL, '[]', 3, NULL),
  -- Judo Erwachsene, Randori, Judofit
  (200, 'Stefan', 'Hofer', 44, 'J', 'k', '{3,6}', 4000, NULL, '[]', 9, NULL),
  (201, 'Melanie', 'Kunz', 36, 'J', 'r', '{3}', 1500, NULL, '[]', 5, NULL),
  (202, 'Reto', 'Aebischer', 51, 'J', 'o', '{3}', 6000, NULL, '[]', 10, NULL),
  (203, 'Fatima', 'Benali', 29, 'J', 'k', '{3,5}', 2200, NULL, '[]', 7,
   'Kam von einem anderen Club'),
  (204, 'Lukas', 'Brändli', 27, 'J', 'k', '{3,5}', 3000, NULL, '[]', 8, NULL),
  (205, 'Isabelle', 'Girard', 33, 'J', 'r', '{3}', 800, NULL, '[]', 3, NULL),
  (206, 'Mehmet', 'Öztürk', 41, 'J', 'r', '{3,6}', 1700, NULL, '[]', 5, NULL),
  (207, 'Patrick', 'Imhof', 38, 'J', 'o', '{3}', 2500, NULL, '[]', 7, NULL),
  (208, 'Tamara', 'Jovanović', 25, 'J', 'r', '{3,5}', 1400, NULL, '[]', 7, NULL),
  (209, 'Christian', 'Bühler', 57, 'J', 'r', '{3,6}', 7000, NULL, '[]', 10, NULL),
  (210, 'Sabrina', 'Odermatt', 31, 'J', 'o', '{3}', 500, NULL, '[]', 1, NULL),
  (211, 'Raphael', 'Moser', 22, 'J', 'k', '{3,5}', 4500, NULL, '["J+S-Leiter"]', 9, NULL),
  (212, 'Ana', 'Costa', 35, 'J', 'r', '{3}', 300, NULL, '[]', 0, 'Kam über ein Probetraining'),
  (213, 'Simon', 'Egli', 45, 'J', 'r', '{6}', 900, NULL, '[]', 0, 'Nur Judofit'),
  (214, 'Karin', 'Zimmermann', 49, 'J', 'k', '{6}', 1500, NULL, '[]', 0, NULL),
  (215, 'Vijay', 'Tharmalingam', 39, 'J', 'o', '{6}', 600, NULL, '[]', 0, NULL),
  (216, 'Petra', 'Lehmann', 53, 'J', 'r', '{6}', 2000, NULL, '[]', 1, NULL),
  (217, 'Marc', 'Rey', 30, 'J', 'o', '{3}', 200, NULL, '[]', 0, NULL),
  (218, 'Dominik', 'Wenger', 28, 'J', 'r', '{3,5}', 1000, NULL, '[]', 5, NULL),
  (219, 'Laura', 'Fässler', 26, 'J', 'r', '{3}', 650, NULL, '[]', 3, NULL),
  (220, 'Florian', 'Kälin', 34, 'J', 'o', '{6,3}', 1100, NULL, '[]', 3, NULL),
  (221, 'Sandro', 'Cattaneo', 42, 'J', 'k', '{3}', 5500, NULL, '[]', 9, NULL),
  -- Aikido Kinder (7–13)
  (250, 'Livia', 'Bachmann', 9, 'A', 'r', '{7}', 700, NULL, '[]', 1, NULL),
  (251, 'Jan', 'Kopp', 11, 'A', 'k', '{7}', 1300, NULL, '[]', 3, NULL),
  (252, 'Zoe', 'Martin', 8, 'A', 'r', '{7}', 400, NULL, '[]', 1, NULL),
  (253, 'Ilyas', 'Hamdi', 12, 'A', 'r', '{7}', 1500, NULL, '[]', 3, NULL),
  (254, 'Giulia', 'Conti', 10, 'A', 'o', '{7}', 600, NULL, '[]', 1, NULL),
  (255, 'Moritz', 'Arnold', 19, 'A', 'k', '{8}', 2700, NULL, '[]', 5, 'Hilft im Kindertraining'),
  (256, 'Hana', 'Begić', 7, 'A', 'r', '{7}', 200, NULL, '[]', 0, NULL),
  (257, 'Tobias', 'Roth', 10, 'A', 'o', '{7}', 800, NULL, '[]', 2, NULL),
  (258, 'Maya', 'Nair', 11, 'A', 'k', '{7}', 1100, NULL, '[]', 2, NULL),
  (259, 'Felix', 'Bosshard', 9, 'A', 'r', '{7}', 500, NULL, '[]', 1, NULL),
  -- Aikido Erwachsene and Waffen
  (270, 'Michael', 'Wälchli', 48, 'A', 'k', '{8,9}', 5000, NULL, '[]', 7, NULL),
  (271, 'Anne-Sophie', 'Morel', 37, 'A', 'r', '{8}', 1800, NULL, '[]', 4, NULL),
  (272, 'Urs', 'Wälti', 62, 'A', 'r', '{8,9}', 8000, NULL, '[]', 8, NULL),
  (273, 'Priya', 'Selvarajah', 33, 'A', 'r', '{8}', 900, NULL, '[]', 2, NULL),
  (274, 'Daniel', 'Furrer', 40, 'A', 'k', '{8,9}', 2600, NULL, '[]', 5, NULL),
  (275, 'Elena', 'Marino', 29, 'A', 'o', '{8}', 500, NULL, '[]', 1, NULL),
  (276, 'Thomas', 'Iseli', 55, 'A', 'o', '{8}', 3000, NULL, '[]', 4, NULL),
  (277, 'Jasmin', 'Ramadani', 27, 'A', 'k', '{8}', 1200, NULL, '[]', 3, NULL),
  (278, 'Philippe', 'Chappuis', 44, 'A', 'r', '{8,9}', 3600, NULL, '[]', 6, NULL),
  (279, 'Silvia', 'Pfister', 51, 'A', 'r', '{8}', 2200, NULL, '[]', 4, NULL),
  (280, 'Adrian', 'Hug', 35, 'A', 'o', '{8}', 300, NULL, '[]', 0, NULL),
  (281, 'Carla', 'Neves', 31, 'A', 'r', '{8}', 700, NULL, '[]', 2, NULL),
  (282, 'Martin', 'Bieri', 66, 'A', 'k', '{8,9}', 9000, NULL, '[]', 7, NULL),
  (283, 'Stefanie', 'Kaufmann', 42, 'A', 'r', '{8}', 1500, NULL, '[]', 3, NULL),
  (284, 'Ivan', 'Marković', 38, 'A', 'r', '{9,8}', 1300, NULL, '[]', 3, NULL),
  (285, 'Rahel', 'Gasser', 24, 'A', 'k', '{8}', 600, NULL, '[]', 1, NULL),
  (286, 'Kenan', 'Şahin', 33, 'A', 'o', '{8}', 450, NULL, '[]', 1, NULL),
  (287, 'Muriel', 'Jaquet', 46, 'A', 'r', '{8}', 2000, NULL, '[]', 5, NULL),
  -- Passive members (some never train, some stopped)
  (300, 'Hans-Peter', 'Gfeller', 68, 'J', 'o', '{3}', 15000, 600, '["Passiv"]', 10,
   'Gründungsmitglied'),
  (301, 'Ursula', 'Rüegg', 61, 'A', 'r', '{8}', 6000, 900, '["Passiv"]', 5, NULL),
  (302, 'Roman', 'Schärer', 39, 'J', 'r', '{3}', 3000, 200, '["Passiv"]', 7, 'Babypause'),
  (303, 'Monika', 'Allemann', 55, 'J', 'o', '{}', 4000, 3000, '["Passiv", "Gönner"]', 0, NULL),
  (304, 'Bruno', 'Kessler', 69, 'J', 'o', '{}', 14000, 2500, '["Passiv"]', 9, NULL),
  (305, 'Sabine', 'Zbinden', 44, 'J', 'r', '{6}', 1200, 120, '["Passiv"]', 0, 'Verletzt (Knie)'),
  (306, 'Fabienne', 'Clerc', 28, 'A', 'k', '{8}', 1500, 300, '["Passiv"]', 3,
   'Auslandsjahr, kommt nächsten Sommer zurück'),
  (307, 'Nils', 'Hürlimann', 17, 'J', 'r', '{2}', 3000, 250, '["Passiv"]', 6,
   'Pausiert während der Lehre'),
  -- Left the club
  (310, 'Janik', 'Brügger', 16, 'J', 'r', '{2}', 2400, 150, '["03_Austritt"]', 5, NULL),
  (311, 'Melina', 'Papadopoulos', 10, 'J', 'o', '{1}', 900, 200, '["03_Austritt"]', 2,
   'Umgezogen'),
  (312, 'Oliver', 'Hess', 34, 'J', 'o', '{3}', 1400, 330, '["03_Austritt"]', 3, NULL),
  (313, 'Leila', 'Mansouri', 30, 'A', 'r', '{8}', 1000, 100, '["03_Austritt"]', 2, NULL),
  (314, 'Tim', 'Rüttimann', 12, 'J', 'o', '{1}', 1100, 400, '["03_Austritt"]', 2, NULL),
  -- Left long ago and archived
  (320, 'Peter', 'Blaser', 63, 'J', 'r', '{3}', 9000, 700, '["03_Austritt"]', 8, NULL),
  (321, 'Dana', 'Mrkonjić', 19, 'J', 'o', '{3}', 2500, 640, '["03_Austritt"]', 4, NULL);

UPDATE demo_roster SET
  bday = current_date - (age * 365.25)::int - pg_temp.h(id || ':bday') * 365 / 100,
  section = CASE sec WHEN 'J' THEN 'Judo' ELSE 'Aikido' END;
-- Members who started as children take every half belt
UPDATE demo_roster SET kid_ladder = (age - joined / 365.25) < 12;
-- For the competition categories
UPDATE demo_roster SET female = firstname IN (
  'Sandra', 'Claudia', 'Nicole', 'Ayşe', 'Lena', 'Mia', 'Emma', 'Sofia', 'Lea', 'Alina', 'Nina',
  'Lara', 'Anika', 'Chloé', 'Selin', 'Ella', 'Sara', 'Lina', 'Aurélie', 'Elif', 'Valentina',
  'Amra', 'Jana', 'Mira', 'Nadia', 'Melanie', 'Fatima', 'Isabelle', 'Tamara', 'Sabrina', 'Ana',
  'Karin', 'Petra', 'Laura', 'Livia', 'Zoe', 'Giulia', 'Hana', 'Maya', 'Anne-Sophie', 'Priya',
  'Elena', 'Jasmin', 'Silvia', 'Carla', 'Stefanie', 'Rahel', 'Muriel', 'Ursula', 'Monika',
  'Sabine', 'Fabienne', 'Melina', 'Leila', 'Dana');

INSERT INTO public.members (id, labels, birthday, lastname, firstname, mobile, email, notes,
                            "archivedAt")
SELECT
  r.id, r.labels, pg_temp.ds(r.bday), r.lastname, r.firstname,
  CASE WHEN pg_temp.h(r.id || ':tel?') >= 15 THEN pg_temp.mobile(r.id || ':tel') END,
  CASE
    -- the demo member account "Familie Brunner" (both children)
    WHEN r.id IN (120, 150) THEN 'mitglied@demo.alleda.ch'
    WHEN pg_temp.h(r.id || ':mail?') < 12 THEN NULL
    WHEN r.age >= 18 THEN pg_temp.slug(r.firstname) || '.' || pg_temp.slug(r.lastname)
                          || '@example.com'
    ELSE 'familie.' || pg_temp.slug(r.lastname) || '@example.com'
  END,
  r.notes,
  CASE WHEN r.id IN (320, 321) THEN now() - make_interval(days => r.stopped - 50) END
FROM demo_roster r;

-- ---------------------------------------------------------------------------
-- Trainings and rosters
-- ---------------------------------------------------------------------------

INSERT INTO public.trainings (id, weekday, "dateFrom", "dateTo", title, section, "ageFrom",
                              "ageTo", "mainTrainerId") VALUES
  (1, 'Monday', '17:30', '18:30', 'Judo Kinder', 'Judo', 6, 10, 102),
  (2, 'Monday', '18:45', '20:00', 'Judo Jugend', 'Judo', 11, 15, 102),
  (3, 'Tuesday', '20:00', '21:30', 'Judo Erwachsene', 'Judo', 16, NULL, 104),
  (4, 'Thursday', '17:30', '18:45', 'Judo Kinder Fortgeschrittene', 'Judo', 8, 12, 107),
  (5, 'Thursday', '19:00', '20:30', 'Randori & Wettkampf', 'Judo', 13, NULL, 105),
  (6, 'Saturday', '09:30', '10:45', 'Judofit', 'Judo', 14, NULL, 106),
  (7, 'Wednesday', '17:00', '18:00', 'Aikido Kinder', 'Aikido', 7, 13, 108),
  (8, 'Wednesday', '19:30', '21:00', 'Aikido Erwachsene', 'Aikido', 16, NULL, 101),
  (9, 'Friday', '19:00', '20:30', 'Aikido Waffen (Bokken & Jo)', 'Aikido', 16, NULL, 109);
DO $$
BEGIN
  PERFORM setval(pg_get_serial_sequence('public.trainings', 'id'),
                 (SELECT max(id) FROM public.trainings));
END $$;

-- Who leads (rotating by calendar week where several; a substitute takes
-- over ~7 % of the sessions of an unplanned training), who assists and how
-- often, which trainings keep going in the summer holidays, plan topics.
-- The roster lists trainers only for the trainings they attend as students.
CREATE TEMP TABLE demo_rotation (
  training_id integer PRIMARY KEY,
  leaders integer[] NOT NULL,
  subs integer[] NOT NULL,
  assistants integer[] NOT NULL,
  assist_pct integer NOT NULL,
  summer boolean NOT NULL,
  planned boolean NOT NULL,
  topics text[]
);

INSERT INTO demo_rotation VALUES
  (1, '{102}', '{107,110}', '{107}', 45, false, false, NULL),
  (2, '{102}', '{105,110}', '{110}', 50, false, false, NULL),
  (3, '{104,104,106,105}', '{}', '{}', 0, true, true,
   ARRAY['Uchi-mata', 'O-soto-gari und Kombinationen', 'Ne-waza: Befreiungen',
         'Seoi-nage', 'Nage-no-kata (1. und 2. Gruppe)', 'Ko-uchi-gari / O-uchi-gari',
         'Haltegriffe und Übergänge', 'Tai-otoshi', 'Ashi-waza', 'Shime-waza (ab 2. Kyu)',
         'Katame-no-kata', 'Freies Randori']),
  (4, '{107}', '{102}', '{110}', 30, false, false, NULL),
  (5, '{105,105,102}', '{}', '{}', 0, false, true,
   ARRAY['Kumikata', 'Randori im Stand', 'Ne-waza-Randori', 'Wettkampftaktik',
         'Übergang Stand–Boden', 'Kondition und Randori', 'Kontertechniken',
         'Turniervorbereitung']),
  (6, '{106}', '{104}', '{}', 0, true, false, NULL),
  (7, '{108}', '{101}', '{255}', 25, false, false, NULL),
  (8, '{101,101,109,108}', '{}', '{}', 0, true, true,
   ARRAY['Ikkyo', 'Shiho-nage', 'Irimi-nage', 'Kote-gaeshi', 'Ukemi und Tai-sabaki',
         'Suwari-waza', 'Jiyu-waza', 'Ushiro-waza', 'Nikyo / Sankyo', 'Tanto-dori',
         'Kokyu-ho', 'Prüfungsprogramm 5. Kyu']),
  (9, '{109}', '{101,270}', '{}', 0, false, false, NULL);

-- Leader of a training on a date: rotation by calendar week (2001-01-01 is a
-- Monday), the same for the logs and the training plan, or a substitute
CREATE FUNCTION pg_temp.leader(p_training integer, p_date date) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN cardinality(r.subs) > 0
         AND pg_temp.h(p_training || ':sub:' || (current_date - p_date)) < 7
      THEN r.subs[1 + pg_temp.h(p_training || ':who:' || (current_date - p_date))
                      % cardinality(r.subs)]
    ELSE r.leaders[1 + ((p_date - date '2001-01-01') / 7) % cardinality(r.leaders)]
  END
  FROM demo_rotation r WHERE r.training_id = p_training;
$$;

-- Current rosters: active members (not passive, not left) and staff
INSERT INTO public.participants ("trainingId", "memberId")
SELECT DISTINCT t, m FROM (
  SELECT unnest(r.trainings) AS t, r.id AS m
  FROM demo_roster r
  WHERE r.stopped IS NULL
  UNION
  SELECT ro.training_id, unnest(ro.leaders || ro.assistants) FROM demo_rotation ro
) x;

-- ---------------------------------------------------------------------------
-- Attendance (logs)
-- ---------------------------------------------------------------------------
-- From January 1st of the year before last to yesterday (so last year's
-- season badges, "most improved" included, compare two full years). A
-- session takes place on the training's weekday unless it is the Christmas
-- break, the summer break (only the "summer" trainings continue, with fewer
-- people) or one of ~2 % random cancellations (not for planned trainings: the
-- plan says who led them).

CREATE TEMP TABLE demo_sessions AS
SELECT t.id AS training_id, d::date AS d, current_date - d::date AS k,
       pg_temp.is_summer(d::date) AS summer
FROM public.trainings t
JOIN demo_rotation ro ON ro.training_id = t.id
CROSS JOIN generate_series(make_date(extract(year FROM current_date)::int - 2, 1, 1),
                           current_date - 1, interval '1 day') AS d
WHERE pg_temp.wd(d::date) = t.weekday
  AND NOT pg_temp.is_xmas(d::date)
  AND (NOT pg_temp.is_summer(d::date) OR ro.summer)
  AND (ro.planned OR pg_temp.h(t.id || ':cancel:' || (current_date - d::date)) >= 2);

-- Leaders first, then assistants, then attendees: a trainer present as the
-- leader is not logged again as an attendee (ON CONFLICT)
INSERT INTO public.logs (date, "trainingId", "memberId", "trainerRole")
SELECT pg_temp.ds(s.d), s.training_id, pg_temp.leader(s.training_id, s.d), 'main_trainer'
FROM demo_sessions s
ON CONFLICT DO NOTHING;

INSERT INTO public.logs (date, "trainingId", "memberId", "trainerRole")
SELECT pg_temp.ds(s.d), s.training_id, a.m, 'assistant'
FROM demo_sessions s
JOIN demo_rotation ro ON ro.training_id = s.training_id
CROSS JOIN LATERAL unnest(ro.assistants) AS a(m)
WHERE pg_temp.h(a.m || ':' || s.training_id || ':' || s.k) < ro.assist_pct
ON CONFLICT DO NOTHING;

-- The rosters are today's; back then a child trained with its age group: a
-- training's attendees are at most a year outside its age range, younger
-- ones went to the next younger group (Fortgeschrittene and Jugend from
-- Kinder, Randori from Jugend) or did not come yet
CREATE TEMP TABLE demo_age_groups AS
SELECT t.id AS training_id, t."ageFrom" - 1 AS age_min, t."ageTo" + 1 AS age_max,
       CASE t.id WHEN 2 THEN 1 WHEN 4 THEN 1 WHEN 5 THEN 2 END AS younger
FROM public.trainings t;

INSERT INTO public.logs (date, "trainingId", "memberId", "trainerRole")
SELECT pg_temp.ds(s.d), s.training_id, r.id, 'attendee'
FROM demo_roster r
CROSS JOIN LATERAL unnest(r.trainings) AS rt(training_id)
JOIN demo_age_groups g ON g.training_id = rt.training_id
JOIN demo_sessions s ON s.training_id IN (g.training_id, g.younger)
JOIN demo_age_groups sg ON sg.training_id = s.training_id
CROSS JOIN LATERAL (SELECT extract(year FROM age(s.d, r.bday))::int AS a) aa
WHERE aa.a BETWEEN coalesce(sg.age_min, 0) AND coalesce(sg.age_max, 200)
  AND (s.training_id = g.training_id OR aa.a < g.age_min)
  AND s.k <= r.joined
  AND (r.stopped IS NULL OR s.k > r.stopped)
  AND pg_temp.h(r.id || ':' || s.training_id || ':' || s.k)
      < (CASE r.lvl WHEN 'k' THEN 85 WHEN 'r' THEN 65 ELSE 35 END)
        * (CASE WHEN s.summer THEN 0.6 ELSE 1 END)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Grades
-- ---------------------------------------------------------------------------
-- Every grade up to the roster's cap (half belts only for members who
-- started as children), each one step after the previous (children 200 days,
-- youth 260, adults 350, Dan grades 1100), not before a minimum age (3.5 Kyu
-- 10, 3. Kyu 11, 2. Kyu 13, 1. Kyu 15, Dan 16) and dated on the next club
-- exam day (Judo every 182 days before the Q-Prüfung below, Aikido three
-- weeks earlier, moved out of the holidays), one grade per exam day at most.
-- Grades that would fall after the last of those days are left out, so the
-- cap is a maximum.

INSERT INTO public.member_grades ("memberId", section, grade, "examDate")
SELECT y.id, y.section, y.grade,
       pg_temp.ds(pg_temp.off_break(pg_temp.sat_before(-(y.base + 182 * y.i)), -1))
FROM (
  SELECT x.*,
         -- at least one exam day after the previous grade
         (min(x.i0 + x.k) OVER (PARTITION BY x.id ORDER BY x.k) - x.k)::int AS i
  FROM (
    SELECT l.*,
           row_number() OVER (PARTITION BY l.id ORDER BY l.rank) AS k,
           -- index of the first exam day on or after join + cum and the
           -- minimum age (days ago)
           floor((least(l.joined - l.cum, l.age_days - l.min_age * 365.25) - l.base)
                 / 182.0)::int AS i0
    FROM (
      SELECT r.id, r.section, r.joined, g.grade, g."gradeRank" AS rank,
             current_date - r.bday AS age_days,
             CASE WHEN g."isDan" THEN 16 WHEN g.grade = '1. Kyu' THEN 15
                  WHEN g.grade = '2. Kyu' THEN 13 WHEN g.grade = '3. Kyu' THEN 11
                  WHEN g.grade = '3.5 Kyu' THEN 10 ELSE 0 END AS min_age,
             CASE r.sec WHEN 'J' THEN 40 ELSE 61 END AS base,
             sum(CASE WHEN g."isDan" THEN 1100
                      WHEN r.age - r.joined / 365.25 < 12 THEN 200
                      WHEN r.age - r.joined / 365.25 < 18 THEN 260
                      ELSE 350 END)
               OVER (PARTITION BY r.id ORDER BY g."gradeRank") AS cum
      FROM demo_roster r
      JOIN public.grade_definitions g
        ON g.section = r.section
       AND g."gradeRank" <= r.grade
       AND (r.kid_ladder OR g.grade NOT LIKE '%.5 Kyu')
    ) l
  ) x
) y
WHERE y.i >= 1;

-- ---------------------------------------------------------------------------
-- Events, registrations, attendance, medals
-- ---------------------------------------------------------------------------

-- The Saturdays of the exam days, events and outside competitions (see
-- pg_temp.day: none in the holidays, no two on the same day; the exam days
-- pick first)
DO $$
DECLARE
  r record;
BEGIN
  PERFORM pg_temp.day('exam_next', pg_temp.sat_after(24));
  PERFORM pg_temp.day('exam_past', pg_temp.sat_before(-40));
  -- events evN and outside competitions, nearest first
  FOR r IN
    SELECT * FROM (VALUES ('ev5', 19), ('ev6', 33), ('ev7', 47), ('ev8', 84), ('ev1', -52),
                          ('ev4', -95), ('ev2', -150), ('ev3', -200), ('ev9', -417),
                          ('ev10', -515), ('ev11', -565), ('comp1', -620), ('comp2', -480),
                          ('comp3', -300), ('comp4', -230), ('comp5', -120)) AS v(key, n)
    ORDER BY abs(v.n), v.key
  LOOP
    PERFORM pg_temp.day(r.key, CASE WHEN r.n < 0 THEN pg_temp.sat_before(r.n)
                                    ELSE pg_temp.sat_after(r.n) END);
  END LOOP;
END $$;

CREATE TEMP TABLE demo_events (
  id integer PRIMARY KEY,
  title text, description text, d date, time_from text, time_to text, location text,
  section text, max_participants integer, deadline_days integer,
  pool text, pct integer, coaches integer[], medals text
);

INSERT INTO demo_events VALUES
  (1, 'Vereinsturnier Judo',
   'Internes Turnier für Kinder und Jugendliche, anschliessend Rangverkündigung und Apéro.',
   pg_temp.dd('ev1'), '09:00', '15:00', 'Sporthalle Musterwil', 'Judo', 60, 10,
   'judo_young', 55, '{102,105,107}', 'club'),
  (2, 'Kids Cup Beispielstadt', 'Regionales Nachwuchsturnier U9 bis U15.',
   pg_temp.dd('ev2'), '08:30', '16:00', 'Mehrzweckhalle Beispielstadt', 'Judo', NULL,
   14, 'judo_kids', 30, '{102}', 'cup'),
  (3, 'Trainingstag',
   'Ein Tag Training, Spiele und Grillplausch für Jugendliche und Erwachsene beider Sektionen.',
   pg_temp.dd('ev3'), '10:00', '17:00', 'Lagerhaus Sonnenberg, Musterberg', NULL, 40,
   21, 'youth_adults', 25, '{104,101,105}', NULL),
  (4, 'Aikido-Seminar mit Gastlehrer',
   'Seminar mit einem Gastlehrer aus der Romandie, alle Grade willkommen.',
   pg_temp.dd('ev4'), '10:00', '16:00', 'Dojo Musterwil', 'Aikido', 35, 7,
   'aikido', 50, '{}', NULL),
  (5, 'Regionalturnier Beispielstadt',
   'Einzelturnier U13 bis Elite. Anmeldung über den Club, das Startgeld wird verrechnet.',
   pg_temp.dd('ev5'), '08:00', '17:00', 'Mehrzweckhalle Beispielstadt', 'Judo', NULL, 6,
   'judo_comp', 45, '{}', NULL),
  (6, 'Clubabend',
   'Gemütlicher Abend für Mitglieder, Eltern und Freunde des Clubs mit Rückblick und Ehrungen.',
   pg_temp.dd('ev6'), '18:30', '23:00', 'Dojo Musterwil', NULL, 80, 10,
   'adults', 18, '{}', NULL),
  (7, 'Elterntraining', 'Eltern trainieren mit ihren Kindern – kein Judogi nötig.',
   pg_temp.dd('ev7'), '10:00', '11:30', 'Dojo Musterwil', 'Judo', 30, 5,
   'judo_kids', 15, '{}', NULL),
  (8, 'Aikido-Lehrgang Waffen', 'Lehrgang Bokken und Jo, auch für Einsteigerinnen und Einsteiger.',
   pg_temp.dd('ev8'), '09:30', '16:00', 'Dojo Musterwil', 'Aikido', 30, 14,
   'aikido', 20, '{}', NULL),
  (9, 'Vereinsturnier Judo',
   'Internes Turnier für Kinder und Jugendliche, anschliessend Rangverkündigung und Apéro.',
   pg_temp.dd('ev9'), '09:00', '15:00', 'Sporthalle Musterwil', 'Judo', 60, 10,
   'judo_young', 50, '{102,105}', 'club'),
  (10, 'Kids Cup Beispielstadt', 'Regionales Nachwuchsturnier U9 bis U15.',
   pg_temp.dd('ev10'), '08:30', '16:00', 'Mehrzweckhalle Beispielstadt', 'Judo', NULL,
   14, 'judo_kids', 25, '{102,107}', 'cup'),
  (11, 'Trainingstag',
   'Ein Tag Training, Spiele und Grillplausch für Jugendliche und Erwachsene beider Sektionen.',
   pg_temp.dd('ev11'), '10:00', '17:00', 'Lagerhaus Sonnenberg, Musterberg', NULL, 40,
   21, 'youth_adults', 22, '{104,109}', NULL);

INSERT INTO public.events (id, title, description, date, "timeFrom", "timeTo", location,
                           section, "maxParticipants", "registrationDeadline", "createdAt",
                           "updatedAt")
SELECT e.id, e.title, e.description, pg_temp.ds(e.d), e.time_from, e.time_to, e.location,
       e.section, e.max_participants, pg_temp.ds(e.d - e.deadline_days),
       least(now(), e.d - 75), least(now(), e.d - 75)
FROM demo_events e;

-- Who takes part: the event's pool (section, age at the event, member at the
-- time), coaches separately
CREATE TEMP TABLE demo_event_people AS
SELECT e.id AS event_id, r.id AS member_id, false AS coach,
       extract(year FROM age(e.d, r.bday))::int AS age_then
FROM demo_events e
JOIN demo_roster r
  ON (current_date - e.d) <= r.joined
 AND (r.stopped IS NULL OR (current_date - e.d) > r.stopped OR e.d > current_date)
 AND (e.d <= current_date OR r.stopped IS NULL)
WHERE NOT r.id = ANY (e.coaches)
  AND pg_temp.h(r.id || ':event:' || e.id) < e.pct
  AND CASE e.pool
        WHEN 'judo_young' THEN r.sec = 'J' AND age(e.d, r.bday) < interval '16 years'
        WHEN 'judo_kids' THEN r.sec = 'J' AND age(e.d, r.bday) < interval '13 years'
        WHEN 'judo_comp' THEN r.sec = 'J' AND age(e.d, r.bday) >= interval '12 years'
                              AND (5 = ANY (r.trainings) OR r.id IN (163, 156))
        WHEN 'aikido' THEN r.sec = 'A' AND age(e.d, r.bday) >= interval '13 years'
        WHEN 'youth_adults' THEN age(e.d, r.bday) >= interval '12 years'
        WHEN 'adults' THEN age(e.d, r.bday) >= interval '18 years'
        ELSE false
      END
UNION ALL
SELECT e.id, c.m, true, NULL
FROM demo_events e CROSS JOIN LATERAL unnest(e.coaches) AS c(m);

INSERT INTO public.event_participants ("eventId", "memberId", "registeredAt",
                                       "attendanceStatus")
SELECT p.event_id, p.member_id,
       least(now() - make_interval(hours => 2 + pg_temp.h(p.member_id || ':regh:' || e.id)),
             (e.d - e.deadline_days - pg_temp.h(p.member_id || ':reg:' || e.id) % 20)
               + time '19:00'),
       CASE
         WHEN p.coach THEN CASE WHEN e.d <= current_date THEN 'attended' ELSE 'registered' END
         WHEN e.d > current_date THEN
           CASE WHEN pg_temp.h(p.member_id || ':st:' || e.id) < 7 THEN 'cancelled'
                ELSE 'registered' END
         WHEN pg_temp.h(p.member_id || ':st:' || e.id) < 85 THEN 'attended'
         WHEN pg_temp.h(p.member_id || ':st:' || e.id) < 94 THEN 'absent'
         ELSE 'cancelled'
       END
FROM demo_event_people p
JOIN demo_events e ON e.id = p.event_id;

INSERT INTO public.event_logs ("eventId", "memberId", "isCoach", "attendedAt")
SELECT ep."eventId", ep."memberId", p.coach,
       (e.d + e.time_from::time) AT TIME ZONE 'Europe/Zurich'
FROM public.event_participants ep
JOIN demo_event_people p ON p.event_id = ep."eventId" AND p.member_id = ep."memberId"
JOIN demo_events e ON e.id = ep."eventId"
WHERE ep."attendanceStatus" = 'attended';

-- Medals at the seeded tournaments (one per member and event) ...
INSERT INTO public.member_medals ("memberId", "eventId", competition, date, section, medal,
                                  category)
SELECT x.member_id, x.event_id, x.title, pg_temp.ds(x.d), 'Judo', x.medal,
       pg_temp.medal_cat(x.age_then, x.female, x.member_id::text)
FROM (
  SELECT p.member_id, p.event_id, p.age_then, e.title, e.d, r.female,
         CASE
           WHEN e.medals = 'club' THEN
             CASE WHEN pg_temp.h(p.member_id || ':medal:' || e.id) < 25 THEN 'gold'
                  WHEN pg_temp.h(p.member_id || ':medal:' || e.id) < 50 THEN 'silver'
                  WHEN pg_temp.h(p.member_id || ':medal:' || e.id) < 85 THEN 'bronze' END
           ELSE
             CASE WHEN pg_temp.h(p.member_id || ':medal:' || e.id) < 22 THEN 'gold'
                  WHEN pg_temp.h(p.member_id || ':medal:' || e.id) < 45 THEN 'silver'
                  WHEN pg_temp.h(p.member_id || ':medal:' || e.id) < 70 THEN 'bronze' END
         END AS medal
  FROM demo_event_people p
  JOIN demo_events e ON e.id = p.event_id AND e.medals IS NOT NULL
  JOIN demo_roster r ON r.id = p.member_id
  JOIN public.event_participants ep
    ON ep."eventId" = p.event_id AND ep."memberId" = p.member_id
   AND ep."attendanceStatus" = 'attended'
  WHERE NOT p.coach
) x
WHERE x.medal IS NOT NULL;

-- ... and at outside competitions (no event) for the Randori group
INSERT INTO public.member_medals ("memberId", "eventId", competition, date, section, medal,
                                  category)
SELECT x.id, NULL, x.competition, pg_temp.ds(x.d), 'Judo', x.medal,
       pg_temp.medal_cat(extract(year FROM age(x.d, x.bday))::int, x.female, x.id::text)
FROM (
  SELECT r.id, r.bday, r.female, c.competition, c.d,
         CASE WHEN pg_temp.h(r.id || ':ext:' || c.competition) < 18 THEN 'gold'
              WHEN pg_temp.h(r.id || ':ext:' || c.competition) < 40 THEN 'silver'
              WHEN pg_temp.h(r.id || ':ext:' || c.competition) < 68 THEN 'bronze' END AS medal
  FROM demo_roster r
  CROSS JOIN (VALUES
    ('Beispielwil Open', pg_temp.dd('comp1')),
    ('Musterberg Trophy', pg_temp.dd('comp2')),
    ('Ranglistenturnier Beispielstadt', pg_temp.dd('comp3')),
    ('Regionalmeisterschaft', pg_temp.dd('comp4')),
    ('Kantonales Einzelturnier', pg_temp.dd('comp5'))
  ) AS c(competition, d)
  WHERE 5 = ANY (r.trainings)
    AND r.stopped IS NULL
    AND (current_date - c.d) <= r.joined
) x
WHERE x.medal IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Demo accounts
-- ---------------------------------------------------------------------------
-- The one-click demo login maps the role to the e-mail; the e-mails and the
-- password are public by design. Fixed ids so the guards can name them.
--   vorstand@…  Sandra Keller   admin, her member record 101
--   trainer@…   Marco Rossi     trainer + examiner, member record 102
--   mitglied@…  Familie Brunner member account, approved automatically: the
--                               e-mail is on Lena (120) and Jonas (150)
--   neu@…       Luca Bernasconi waits for approval (random password)

CREATE FUNCTION pg_temp.demo_user(p_id uuid, p_email text, p_name text, p_password text,
                                  p_created timestamptz, p_last_sign_in timestamptz)
RETURNS void
LANGUAGE sql AS $$
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, last_sign_in_at,
    confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current,
    phone, phone_change, phone_change_token,
    reauthentication_token,
    raw_app_meta_data, raw_user_meta_data,
    is_sso_user, is_anonymous
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    p_created, p_created, p_created, p_last_sign_in,
    '', '',
    '', '', '',
    NULL, '', '',
    '',
    '{"provider": "email", "providers": ["email"]}',
    jsonb_build_object('full_name', p_name),
    false, false
  );
  INSERT INTO auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) VALUES (
    p_id, p_id, p_email,
    jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true),
    'email', p_last_sign_in, p_created, p_created
  );
$$;

DO $$
BEGIN
  PERFORM pg_temp.demo_user('d3e40000-0000-4000-8000-000000000001',
                            'vorstand@demo.alleda.ch',
                            'Sandra Keller', 'administra-demo', now() - interval '420 days',
                            now() - interval '3 days');
  PERFORM pg_temp.demo_user('d3e40000-0000-4000-8000-000000000002',
                            'trainer@demo.alleda.ch',
                            'Marco Rossi', 'administra-demo', now() - interval '400 days',
                            now() - interval '6 days');
  PERFORM pg_temp.demo_user('d3e40000-0000-4000-8000-000000000003',
                            'mitglied@demo.alleda.ch',
                            'Familie Brunner', 'administra-demo', now() - interval '210 days',
                            now() - interval '9 days');
  PERFORM pg_temp.demo_user('d3e40000-0000-4000-8000-000000000004',
                            'neu@demo.alleda.ch',
                            'Luca Bernasconi', gen_random_uuid()::text, now() - interval '1 day',
                            now() - interval '1 day');
END $$;

UPDATE public.user_profiles
SET status = 'approved', role = 'admin', member_id = 101,
    approved_at = now() - interval '419 days', created_at = now() - interval '420 days'
WHERE user_id = 'd3e40000-0000-4000-8000-000000000001';

UPDATE public.user_profiles
SET status = 'approved', role = 'trainer', exam_role = 'examiner', member_id = 102,
    approved_at = now() - interval '399 days',
    approved_by = 'd3e40000-0000-4000-8000-000000000001',
    created_at = now() - interval '400 days'
WHERE user_id = 'd3e40000-0000-4000-8000-000000000002';

-- Approved by the trigger already (e-mail on two active members); backdate
UPDATE public.user_profiles
SET approved_at = now() - interval '210 days', created_at = now() - interval '210 days'
WHERE user_id = 'd3e40000-0000-4000-8000-000000000003';

UPDATE public.user_profiles
SET created_at = now() - interval '1 day'
WHERE user_id = 'd3e40000-0000-4000-8000-000000000004';

-- ---------------------------------------------------------------------------
-- Q-Prüfungen
-- ---------------------------------------------------------------------------
-- (a) A finished Judo exam day ~40 days ago: sheets snapshotted from
--     exam_programs, scored, then closed through the result trigger, which
--     writes member_grades. (b) An upcoming exam day open for registration;
--     Lena Brunner (120) is eligible and left unregistered for the demo.

INSERT INTO public.exams (id, section, title, date, location, registration_deadline, notes,
                          created_at, created_by) VALUES
  (1, 'Judo', 'Q-Prüfung Judo Kinder & Jugend', pg_temp.ds(pg_temp.dd('exam_past')),
   'Dojo Musterwil', pg_temp.ds(pg_temp.dd('exam_past') - 14),
   'Prüfungsgebühr CHF 20.–, bitte bar mitbringen.',
   now() - interval '100 days', 'd3e40000-0000-4000-8000-000000000001'),
  (2, 'Judo', 'Q-Prüfung Judo', pg_temp.ds(pg_temp.dd('exam_next')), 'Dojo Musterwil',
   pg_temp.ds(pg_temp.dd('exam_next') - 13),
   'Prüfungsgebühr CHF 20.–, bitte bar mitbringen. Sauberer Judogi, kurze Finger- und '
   || 'Fussnägel. Gruppe und Zeit stehen im Aufgebot, die letzten folgen nach dem '
   || 'Anmeldeschluss.',
   now() - interval '30 days', 'd3e40000-0000-4000-8000-000000000001');
DO $$
BEGIN
  PERFORM setval(pg_get_serial_sequence('public.exams', 'id'), (SELECT max(id) FROM public.exams));
END $$;

-- Next kyu grade above the member's current one (half belts only for those
-- who started as children)
CREATE FUNCTION pg_temp.next_grade(p_member integer, p_section text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT g.grade
  FROM public.grade_definitions g
  WHERE g.section = p_section
    AND NOT g."isDan"
    AND g."gradeRank" > coalesce((
      SELECT max(gd."gradeRank")
      FROM public.member_grades mg
      JOIN public.grade_definitions gd ON gd.section = mg.section AND gd.grade = mg.grade
      WHERE mg."memberId" = p_member AND mg.section = p_section), 0)
    AND ((SELECT kid_ladder FROM demo_roster WHERE id = p_member)
         OR g.grade NOT LIKE '%.5 Kyu')
  ORDER BY g."gradeRank"
  LIMIT 1;
$$;

-- (a) the finished exam day
INSERT INTO public.exam_candidates (exam_id, member_id, section, grade, belt_length_cm, trainer,
                                    status, group_name, call_time, program, min_points,
                                    started_at, registered_at)
SELECT 1, v.member_id, 'Judo', p.grade, v.belt, 'Marco Rossi', 'invited', v.grp, v.call_time,
       p.parts, p.min_points,
       (pg_temp.dd('exam_past') + v.call_time::time) AT TIME ZONE 'Europe/Zurich'
         + make_interval(mins => v.offset_min),
       (pg_temp.dd('exam_past') - 20 - v.member_id % 9) + time '20:15'
FROM (VALUES
  (125, 230, 'Gruppe A', '09:00', 5),
  (134, 230, 'Gruppe A', '09:00', 5),
  (123, 240, 'Gruppe A', '09:00', 50),
  (153, 250, 'Gruppe B', '10:30', 5),
  (160, 260, 'Gruppe B', '10:30', 5),
  (130, 240, 'Gruppe B', '10:30', 50),
  (156, 270, 'Gruppe C', '13:30', 5),
  (163, 270, 'Gruppe C', '13:30', 5)
) AS v(member_id, belt, grp, call_time, offset_min)
JOIN public.exam_programs p
  ON p.section = 'Judo' AND p.grade = pg_temp.next_grade(v.member_id, 'Judo');

-- Scores: everyone mostly 2 points; Kevin (160) clearly below the minimum
INSERT INTO public.exam_scores (candidate_id, item_key, left_points, right_points, points, note)
SELECT c.id, i.item->>'key',
       CASE WHEN (i.item->>'sides')::int = 2 THEN
         CASE WHEN c.member_id = 160 THEN 1
              WHEN pg_temp.h(c.member_id || ':L:' || (i.item->>'key')) < 8 THEN 1 ELSE 2 END
       END,
       CASE WHEN (i.item->>'sides')::int = 2 THEN
         CASE WHEN c.member_id = 160 THEN
                CASE WHEN pg_temp.h(c.member_id || ':R:' || (i.item->>'key')) < 40 THEN 1
                     ELSE 0 END
              WHEN pg_temp.h(c.member_id || ':R:' || (i.item->>'key')) < 20 THEN 1 ELSE 2 END
       END,
       CASE WHEN (i.item->>'sides')::int = 1 THEN
         CASE WHEN c.member_id = 160 THEN 1
              WHEN pg_temp.h(c.member_id || ':P:' || (i.item->>'key')) < 15 THEN 1 ELSE 2 END
       END,
       CASE WHEN pg_temp.h(c.member_id || ':N:' || (i.item->>'key')) < 5 THEN
         (ARRAY['Gleichgewicht brechen (Kuzushi) noch üben', 'Schöne Ausführung!',
                'Links deutlich unsicherer', 'Uke besser kontrollieren',
                'Abstand zu gross'])[1 + pg_temp.h(c.member_id || ':NT:' || (i.item->>'key')) % 5]
       END
FROM public.exam_candidates c
CROSS JOIN LATERAL (
  SELECT it.item
  FROM jsonb_array_elements(c.program) AS part(value)
  CROSS JOIN LATERAL jsonb_array_elements(part.value->'items') AS it(item)
) i
WHERE c.exam_id = 1;

INSERT INTO public.exam_scores (candidate_id, item_key, note)
SELECT c.id, '_feedback',
       CASE WHEN c.member_id = 160
         THEN 'Fallschule und Würfe noch zu unsicher, vor allem links. Wir üben das im '
              || 'Training und du probierst es an der nächsten Prüfung wieder!'
         ELSE (ARRAY['Saubere Fallschule und gute Haltung. Weiter so!',
                     'Sehr schöne Würfe, bei den Haltegriffen mehr Druck auf Uke.',
                     'Gute Prüfung! Bei O-uchi-gari mehr Kuzushi.',
                     'Konzentriert und sicher, nur die Bodenübergänge noch flüssiger.',
                     'Super Leistung, besonders die Kombinationen.'])
              [1 + pg_temp.h(c.member_id || ':fb') % 5]
       END
FROM public.exam_candidates c
WHERE c.exam_id = 1;

-- Examiner: Marco (the only Judo account with the examiner role)
INSERT INTO public.exam_examiners (candidate_id, user_id, name, created_at)
SELECT c.id, 'd3e40000-0000-4000-8000-000000000002'::uuid, 'Marco Rossi', c.started_at
FROM public.exam_candidates c WHERE c.exam_id = 1;

-- Close the sheets: the trigger computes the points and writes member_grades
UPDATE public.exam_candidates
SET result = CASE WHEN member_id = 160 THEN 'failed' ELSE 'passed' END
WHERE exam_id = 1;
UPDATE public.exam_candidates
SET completed_at = started_at + interval '35 minutes',
    completed_by = 'd3e40000-0000-4000-8000-000000000002'
WHERE exam_id = 1;
UPDATE public.member_grades g
SET "createdAt" = c.completed_at
FROM public.exam_candidates c
WHERE c.member_grade_id = g.id;

-- (b) the upcoming exam day: called up (group and time) and new registrations
INSERT INTO public.exam_candidates (exam_id, member_id, section, grade, belt_length_cm, trainer,
                                    status, group_name, call_time, note, registered_at)
SELECT 2, v.member_id, 'Judo', pg_temp.next_grade(v.member_id, 'Judo'), v.belt, v.trainer,
       v.status, v.grp, v.call_time, v.note, now() - make_interval(days => v.ago, hours => 5)
FROM (VALUES
  (121, 220, 'Marco Rossi', 'invited', 'Gruppe A', '09:00', NULL, 20),
  (126, 220, 'Marco Rossi', 'invited', 'Gruppe A', '09:00', NULL, 19),
  (127, 240, 'Ayşe Demir', 'invited', 'Gruppe A', '09:00', NULL, 18),
  (151, 250, 'Ayşe Demir', 'invited', 'Gruppe B', '10:30', 'Freut sich schon sehr!', 17),
  (150, 260, NULL, 'registered', NULL, NULL, 'Gurtlänge vom Trainer gemessen.', 4),
  (152, 270, NULL, 'registered', NULL, NULL, NULL, 3),
  (157, 250, NULL, 'registered', NULL, NULL, NULL, 2),
  (143, 230, NULL, 'registered', NULL, NULL, 'Wenn möglich bitte in eine Gruppe am Nachmittag.', 1)
) AS v(member_id, belt, trainer, status, grp, call_time, note, ago);

-- ---------------------------------------------------------------------------
-- Trainingsplanung
-- ---------------------------------------------------------------------------
-- The TK plans the three adult trainings from five weeks back to four months
-- ahead: rotating trainers (the same as in the logs), topics, a few
-- cancellations. Holidays come from the calendar: school holidays shown only,
-- the Christmas break closes the dojo, plus one closed day.

INSERT INTO public.training_plan_trainings (training_id, created_at)
SELECT training_id, now() - interval '60 days' FROM demo_rotation WHERE planned;

INSERT INTO public.training_plan_breaks (title, date_from, date_to, cancels_training,
                                         created_at)
SELECT b.title, pg_temp.ds(b.f), pg_temp.ds(b.t), b.closed, now() - interval '60 days'
FROM generate_series(extract(year FROM current_date - 40)::int,
                     extract(year FROM current_date + 125)::int) AS y
CROSS JOIN LATERAL (VALUES
  ('Sportferien', make_date(y, 2, 7), make_date(y, 2, 22), false),
  ('Frühlingsferien', make_date(y, 4, 11), make_date(y, 4, 26), false),
  ('Sommerferien', make_date(y, 7, 11), make_date(y, 8, 10), false),
  ('Herbstferien', make_date(y, 10, 3), make_date(y, 10, 18), false),
  ('Weihnachtsferien – Dojo geschlossen', make_date(y, 12, 24), make_date(y + 1, 1, 4), true)
) AS b(title, f, t, closed)
WHERE b.t >= current_date - 35 AND b.f <= current_date + 120;

-- One closed day: the first Thursday (Randori) at least 30 days ahead,
-- outside the Christmas break
INSERT INTO public.training_plan_breaks (title, date_from, date_to, cancels_training,
                                         created_at)
SELECT 'Dojo geschlossen (Hallenreinigung)', pg_temp.ds(d), pg_temp.ds(d), true,
       now() - interval '20 days'
FROM (
  SELECT CASE WHEN pg_temp.is_xmas(d0) THEN d0 + 14 ELSE d0 END AS d
  FROM (SELECT current_date + 30 + ((11 - extract(isodow FROM current_date + 30)::int) % 7)
        AS d0) x
) y;

INSERT INTO public.training_plan_sessions (training_id, date, trainer_id, topic, notes,
                                           cancelled, updated_at)
SELECT s.training_id, pg_temp.ds(s.d),
       CASE WHEN NOT s.summer_off THEN pg_temp.leader(s.training_id, s.d) END,
       CASE WHEN NOT s.summer_off THEN
         s.topics[1 + ((s.d - date '2001-01-01') / 7) % array_length(s.topics, 1)] END,
       CASE
         WHEN s.summer_off THEN 'Sommerpause'
         WHEN s.cancel THEN (ARRAY['Fällt aus: Schulanlass in der Halle',
                                   'Fällt aus: Halle durch die Gemeinde belegt',
                                   'Fällt aus: Leiterkurs'])[1 + (s.n / 9 + s.training_id / 2) % 3]
         WHEN pg_temp.h(s.training_id || ':note:' || s.n) < 8 THEN 'Gürtelprüfung vorbereiten'
       END,
       CASE WHEN s.summer_off OR s.cancel THEN true END,
       now() - interval '20 days'
FROM (
  SELECT ro.training_id, ro.topics, d::date AS d,
         (d::date - date '2001-01-01') / 7 AS n,
         -- Randori pauses in the summer holidays like in the logs
         (NOT ro.summer AND pg_temp.is_summer(d::date)) AS summer_off,
         -- every 9th week per training, from the second week on
         (d::date > current_date + 7
          AND ((d::date - date '2001-01-01') / 7 + 3 * ro.training_id) % 9 = 0) AS cancel
  FROM demo_rotation ro
  JOIN public.trainings t ON t.id = ro.training_id
  CROSS JOIN generate_series(current_date - 35, current_date + 120, interval '1 day') AS d
  WHERE ro.planned
    AND pg_temp.wd(d::date) = t.weekday
    AND NOT EXISTS (
      SELECT 1 FROM public.training_plan_breaks b
      WHERE b.cancels_training AND pg_temp.ds(d::date) BETWEEN b.date_from AND b.date_to)
) s;

-- ---------------------------------------------------------------------------
-- Trial candidates
-- ---------------------------------------------------------------------------
-- Inserting forces status 'new' (trigger); other statuses by UPDATE, a
-- participants row makes 'assigned', then the change time is backdated in a
-- separate UPDATE (not a trigger column). Fewer than 20 registrations in the
-- last hour, so the public form's rate limit stays clear.

INSERT INTO public.members (id, labels, birthday, lastname, firstname, email, mobile,
                            "trialSection", "trialLocale", notes, "trialRegisteredAt")
SELECT v.id, '["probetraining"]',
       pg_temp.ds(current_date - (v.age * 365.25)::int - pg_temp.h(v.id || ':bday') * 3),
       v.lastname, v.firstname, v.email, pg_temp.mobile(v.id || ':tel'), v.section, 'de',
       v.notes, now() - v.ago
FROM (VALUES
  (380, 'Noemi', 'Albrecht', 8, 'familie.albrecht@example.com', 'Judo',
   'Möchte gerne mit einer Freundin zusammen kommen.', interval '26 hours'),
  (381, 'Rui', 'Carvalho', 34, 'rui.carvalho@example.com', 'Aikido',
   'Habe früher Judo gemacht und möchte Aikido ausprobieren.', interval '5 days'),
  (382, 'Abinaya', 'Kandiah', 7, 'familie.kandiah@example.com', 'Judo', NULL,
   interval '20 days'),
  (383, 'Sven', 'Ritter', 29, 'sven.ritter@example.com', 'Judo',
   'Arbeitet Schicht, am Dienstag passt es am besten.',
   interval '12 days'),
  (384, 'Mélanie', 'Bovet', 41, 'melanie.bovet@example.com', 'Aikido', NULL,
   interval '45 days'),
  (385, 'Luan', 'Shala', 9, 'familie.shala@example.com', 'Judo',
   'Ist sehr bewegungsfreudig und hat schon etwas Erfahrung vom Schulsport.', interval '9 days'),
  (386, 'Matilda', 'Schürch', 13, 'familie.schuerch@example.com', 'Judo', NULL,
   interval '30 days'),
  (387, 'Cedric', 'Vogt', 36, 'cedric.vogt@example.com', 'Judo', NULL, interval '150 days')
) AS v(id, firstname, lastname, age, email, section, notes, ago);

UPDATE public.members SET "trialStatus" = 'waitlist' WHERE id IN (382, 387);

-- Assigned: Sven from the next Tuesday, Luan from the next Monday that takes
-- place (holidays and cancelled sessions skipped), Mélanie has been coming to
-- Aikido Erwachsene for the last four sessions (the app suggests making her a
-- member)
-- The first session of a training after today that takes place: not in the
-- Christmas break, not in the summer break unless the training keeps going,
-- not on a day the plan cancels
CREATE FUNCTION pg_temp.trial_start(p_training integer) RETURNS date
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v date := current_date + 1;
  v_summer boolean;
BEGIN
  SELECT summer INTO v_summer FROM demo_rotation WHERE training_id = p_training;
  WHILE pg_temp.wd(v) <> (SELECT weekday FROM public.trainings WHERE id = p_training) LOOP
    v := v + 1;
  END LOOP;
  WHILE pg_temp.is_xmas(v) OR (pg_temp.is_summer(v) AND NOT v_summer)
        OR EXISTS (SELECT 1 FROM public.training_plan_sessions s
                   WHERE s.training_id = p_training AND s.date = pg_temp.ds(v) AND s.cancelled)
        OR EXISTS (SELECT 1 FROM public.training_plan_breaks b
                   WHERE b.cancels_training AND pg_temp.ds(v) BETWEEN b.date_from AND b.date_to)
  LOOP
    v := v + 7;
  END LOOP;
  RETURN v;
END $$;

INSERT INTO public.participants ("trainingId", "memberId", "trialStartDate")
VALUES
  (3, 383, pg_temp.trial_start(3)),
  (1, 385, pg_temp.trial_start(1)),
  (8, 384, (SELECT min(d) FROM (SELECT d FROM demo_sessions WHERE training_id = 8
                                ORDER BY d DESC LIMIT 4) x));

INSERT INTO public.logs (date, "trainingId", "memberId", "trainerRole")
SELECT pg_temp.ds(d), 8, 384, 'attendee'
FROM (SELECT d FROM demo_sessions WHERE training_id = 8 ORDER BY d DESC LIMIT 4) x
ON CONFLICT DO NOTHING;

UPDATE public.members SET "trialStatus" = 'cancelled' WHERE id = 386;
UPDATE public.members SET "trialSelfCancelled" = true WHERE id = 386;

UPDATE public.members m
SET "trialStatusChangedAt" = m."trialRegisteredAt" + v.after
FROM (VALUES
  (380, interval '0'), (381, interval '0'), (382, interval '2 days'),
  (383, interval '3 days'), (384, interval '3 days'), (385, interval '2 days'),
  (386, interval '9 days'), (387, interval '3 days')
) AS v(id, after)
WHERE m.id = v.id;

UPDATE public.members SET "archivedAt" = now() - interval '60 days' WHERE id = 387;

-- The mails the app sent (no SMTP in the demo, so new ones end as 'skipped')
INSERT INTO public.trial_emails (member_id, kind, to_email, subject, body, status, created_at,
                                 sent_at)
SELECT m.id, k.kind, m.email,
       CASE k.kind
         WHEN 'welcome' THEN 'Danke für deine Anmeldung zum Probetraining – Budo-Club Musterwil'
         WHEN 'waitlist' THEN 'Du bist auf der Warteliste – Budo-Club Musterwil'
         ELSE 'Dein Probetraining beim Budo-Club Musterwil'
       END,
       'Hallo ' || m.firstname || E'\n\n'
       || CASE k.kind
            WHEN 'welcome' THEN 'Vielen Dank für deine Anmeldung zum Probetraining beim '
              || 'Budo-Club Musterwil! Wir haben sie erhalten und melden uns bald bei dir.'
            WHEN 'waitlist' THEN 'Danke für dein Interesse am Probetraining beim Budo-Club '
              || 'Musterwil. Im Moment sind unsere Trainings leider voll, deshalb haben wir '
              || 'dich auf die Warteliste gesetzt.'
            ELSE 'Wir freuen uns, dich im Probetraining begrüssen zu dürfen! Du kannst in '
              || 'folgendem Training vorbeikommen:' || E'\n\n' || coalesce((
                SELECT string_agg('- ' || (ARRAY['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag',
                                                 'Freitag', 'Samstag', 'Sonntag'])
                                          [extract(isodow FROM p."trialStartDate")::int]
                                  || ', ' || t."dateFrom" || '–' || t."dateTo" || ': '
                                  || t.title || ' – erstes Training am '
                                  || to_char(p."trialStartDate", 'DD.MM.YYYY'), E'\n')
                FROM public.participants p JOIN public.trainings t ON t.id = p."trainingId"
                WHERE p."memberId" = m.id), '')
          END
       || E'\n\nDen Stand deiner Anmeldung siehst du jederzeit hier:\n'
       || 'https://demo.alleda.ch/probetraining/status/' || m."trialToken"
       || E'\n\nBei Fragen erreichst du uns unter demo@alleda.ch.\n\n'
       || E'Sportliche Grüsse\nBudo-Club Musterwil',
       CASE WHEN k.kind = 'welcome' AND m.id = 381 THEN 'skipped' ELSE 'sent' END,
       k.at,
       CASE WHEN k.kind = 'welcome' AND m.id = 381 THEN NULL ELSE k.at + interval '4 seconds' END
FROM public.members m
CROSS JOIN LATERAL (VALUES
  ('welcome', m."trialRegisteredAt" + interval '2 seconds'),
  ('waitlist', m."trialStatusChangedAt"),
  ('assigned', m."trialStatusChangedAt")
) AS k(kind, at)
WHERE m.id BETWEEN 380 AND 389
  AND (k.kind = 'welcome'
       OR (k.kind = 'waitlist' AND m.id IN (382, 387))
       OR (k.kind = 'assigned' AND m.id IN (383, 384, 385)));

-- ---------------------------------------------------------------------------
-- Badges
-- ---------------------------------------------------------------------------
-- Computed once, then "earnedAt" is backdated to the moment that earned each
-- badge (the Nth log, the streak's Nth session, the medal, the Dan grade, the
-- season's last session), so "recent achievements" looks natural and nobody
-- gets a badge celebration right after a reset.

DO $$
BEGIN
  PERFORM set_config('app.skip_badge_refresh', 'false', true);
  PERFORM public.refresh_all_member_badges();
END $$;

-- Fallback for anything without a milestone: spread over the last 90 days
UPDATE public.member_badges
SET "earnedAt" = now()
  - make_interval(days => pg_temp.h("memberId" || ':' || "badgeId") * 9 / 10 + 1);

WITH
att AS (
  SELECT "memberId" AS m, date::date AS d,
         row_number() OVER (PARTITION BY "memberId" ORDER BY date, "trainingId") AS n
  FROM public.logs
),
led AS (
  SELECT "memberId" AS m, date::date AS d,
         row_number() OVER (PARTITION BY "memberId" ORDER BY date, "trainingId") AS n
  FROM public.logs WHERE "trainerRole" = 'main_trainer'
),
ev AS (
  SELECT "memberId" AS m, "attendedAt"::date AS d,
         row_number() OVER (PARTITION BY "memberId" ORDER BY "attendedAt", id) AS n
  FROM public.event_logs
),
-- Streaks as refresh_member_badges counts them: runs of consecutive dates on
-- which the training ran; n = position within the run
ran AS (
  SELECT "trainingId" AS t, date, row_number() OVER (PARTITION BY "trainingId" ORDER BY date) AS dr
  FROM (SELECT DISTINCT "trainingId", date FROM public.logs) x
),
runs AS (
  SELECT l."memberId" AS m, l."trainingId" AS t, l.date::date AS d,
         r.dr - row_number() OVER (PARTITION BY l."memberId", l."trainingId" ORDER BY r.dr)
           AS grp
  FROM public.logs l JOIN ran r ON r.t = l."trainingId" AND r.date = l.date
),
streak AS (
  SELECT m, d, row_number() OVER (PARTITION BY m, t, grp ORDER BY d) AS n FROM runs
),
med AS (
  SELECT "memberId" AS m, date::date AS d, medal,
         row_number() OVER (PARTITION BY "memberId" ORDER BY date, id) AS n
  FROM public.member_medals
),
yearly AS (
  SELECT "memberId" AS m, left(date, 4)::int AS y, date::date AS d,
         row_number() OVER (PARTITION BY "memberId", left(date, 4) ORDER BY date) AS n
  FROM public.logs
),
section_last AS (
  SELECT l."memberId" AS m, left(l.date, 4)::int AS y, t.section,
         max(l.date)::date AS d_any,
         max(l.date) FILTER (WHERE l."trainerRole" = 'main_trainer')::date AS d_led
  FROM public.logs l JOIN public.trainings t ON t.id = l."trainingId"
  GROUP BY 1, 2, 3
),
milestones AS (
  SELECT a.m, bd.id AS badge, 0 AS season, '' AS context, a.d
  FROM att a JOIN public.badge_definitions bd ON bd.category = 'attendance' AND bd.threshold = a.n
  UNION ALL
  SELECT a.m, bd.id, 0, '', a.d
  FROM led a JOIN public.badge_definitions bd ON bd.category = 'trainer' AND bd.threshold = a.n
  UNION ALL
  SELECT a.m, bd.id, 0, '', a.d
  FROM ev a JOIN public.badge_definitions bd ON bd.category = 'event' AND bd.threshold = a.n
  UNION ALL
  SELECT s.m, bd.id, 0, '', min(s.d)
  FROM streak s JOIN public.badge_definitions bd ON bd.category = 'streak' AND bd.threshold = s.n
  GROUP BY s.m, bd.id
  UNION ALL
  SELECT mg."memberId", 'black_belt', 0, '', min(mg."examDate")::date
  FROM public.member_grades mg
  JOIN public.grade_definitions g ON g.section = mg.section AND g.grade = mg.grade AND g."isDan"
  GROUP BY mg."memberId"
  UNION ALL
  SELECT m, 'medalist', 0, '', d FROM med WHERE n = 1
  UNION ALL
  SELECT m, 'podium_5', 0, '', d FROM med WHERE n = 5
  UNION ALL
  SELECT m, 'first_gold', 0, '', min(d) FROM med WHERE medal = 'gold' GROUP BY m
  UNION ALL
  SELECT m, 'season_regular', y, '', d FROM yearly WHERE n = 40
  UNION ALL
  SELECT m, b.badge, y, section,
         CASE WHEN y < extract(year FROM current_date) THEN make_date(y, 12, 31)
              WHEN b.badge = 'coach_of_year' THEN d_led ELSE d_any END
  FROM section_last
  CROSS JOIN (VALUES ('top_3'), ('most_improved'), ('coach_of_year')) AS b(badge)
)
UPDATE public.member_badges mb
SET "earnedAt" = least(now() - interval '1 hour',
                       (ms.d + time '19:30') AT TIME ZONE 'Europe/Zurich')
FROM (
  SELECT m, badge, season, context, min(d) AS d FROM milestones GROUP BY 1, 2, 3, 4
) ms
WHERE ms.m = mb."memberId" AND ms.badge = mb."badgeId" AND ms.season = mb.season
  AND ms.context = mb.context;

-- ---------------------------------------------------------------------------
-- Demo marker: the reset workflow refuses to wipe a database without it
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  EXECUTE format('COMMENT ON DATABASE %I IS %L', current_database(), 'administra-demo');
END $$;

-- ---------------------------------------------------------------------------
-- Guards (demo only, installed last so the seed itself is not affected)
-- ---------------------------------------------------------------------------
-- One visitor must not break the demo for everyone until the next reset:
-- the three login accounts keep their password, e-mail, role and member
-- records, the club identity on the public trial page stays, the exam days
-- stay and the member can withdraw and register again, the showcase rows
-- (events, exam programs, planned trainings, trial candidates, the pending
-- request) stay and nothing is deleted in bulk. Everything else may be
-- changed freely; the next reset rebuilds it. The reset drops the
-- public schema, and with it these functions and (CASCADE) their triggers.

-- a. auth.users: GoTrue may update the demo logins (last_sign_in_at etc.),
--    but password, e-mail, phone and display name keep their old values; no
--    deleting
CREATE OR REPLACE FUNCTION public.demo_guard_auth_users()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF OLD.id NOT IN ('d3e40000-0000-4000-8000-000000000001',
                    'd3e40000-0000-4000-8000-000000000002',
                    'd3e40000-0000-4000-8000-000000000003') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'In der Demo können die Demo-Konten nicht gelöscht werden.'
      USING ERRCODE = '42501';
  END IF;
  NEW.encrypted_password := OLD.encrypted_password;
  NEW.email := OLD.email;
  NEW.email_change := OLD.email_change;
  NEW.email_change_token_new := OLD.email_change_token_new;
  NEW.email_change_token_current := OLD.email_change_token_current;
  NEW.phone := OLD.phone;
  NEW.phone_change := OLD.phone_change;
  -- the display name (user_profiles.full_name follows it): no vandalism
  NEW.raw_user_meta_data := OLD.raw_user_meta_data;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER demo_guard_auth_users
  BEFORE UPDATE OR DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.demo_guard_auth_users();

-- b. user_profiles: role, status, exam role and member link of the demo
--    logins are fixed; e-mail, name and avatar silently keep their values
--    (the sign-in trigger writes the same ones, auth.users is pinned above),
--    so nobody plants an image or locks the member account out. The pending
--    example request (neu@) stays pending, so every admin visitor sees one.
CREATE OR REPLACE FUNCTION public.demo_guard_user_profiles()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF OLD.user_id = 'd3e40000-0000-4000-8000-000000000004'
     AND (TG_OP = 'DELETE'
          OR NEW.user_id IS DISTINCT FROM OLD.user_id
          OR NEW.role IS DISTINCT FROM OLD.role
          OR NEW.status IS DISTINCT FROM OLD.status
          OR NEW.exam_role IS DISTINCT FROM OLD.exam_role
          OR NEW.member_id IS DISTINCT FROM OLD.member_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE =
      'In der Demo bleibt diese Beispiel-Anfrage offen, damit alle Besucher sie sehen.';
  END IF;
  IF OLD.user_id NOT IN ('d3e40000-0000-4000-8000-000000000001',
                         'd3e40000-0000-4000-8000-000000000002',
                         'd3e40000-0000-4000-8000-000000000003') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE'
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.exam_role IS DISTINCT FROM OLD.exam_role
     OR NEW.member_id IS DISTINCT FROM OLD.member_id THEN
    RAISE EXCEPTION 'In der Demo können die Demo-Konten nicht geändert werden.'
      USING ERRCODE = '42501';
  END IF;
  NEW.email := OLD.email;
  NEW.full_name := OLD.full_name;
  NEW.avatar_url := OLD.avatar_url;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER demo_guard_user_profiles
  BEFORE UPDATE OR DELETE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.demo_guard_user_profiles();

-- c. members the demo logins depend on (Sandra, Marco, Lena and Jonas
--    Brunner): no deleting, e-mail, labels and archive date fixed
CREATE OR REPLACE FUNCTION public.demo_guard_members()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF OLD.id NOT IN (101, 102, 120, 150) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE =
      'In der Demo kann dieses Mitglied nicht gelöscht werden, ein Demo-Konto hängt daran.';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.labels IS DISTINCT FROM OLD.labels
     OR NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt" THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE =
      'In der Demo können E-Mail, Labels und Archivierung dieses Mitglieds nicht geändert '
      || 'werden, ein Demo-Konto hängt daran.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER demo_guard_members
  BEFORE UPDATE OR DELETE ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.demo_guard_members();

--    The demo login e-mails stay where they are: on another member record
--    mitglied@ would add a stranger to the Brunner family (my_member_ids()
--    matches by e-mail), and the other ones would hand a demo login to it
CREATE OR REPLACE FUNCTION public.demo_guard_member_emails()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF lower(btrim(NEW.email)) IN ('vorstand@demo.alleda.ch',
                                 'trainer@demo.alleda.ch',
                                 'mitglied@demo.alleda.ch',
                                 'neu@demo.alleda.ch')
     AND NOT (NEW.id IN (120, 150)
              AND lower(btrim(NEW.email)) = 'mitglied@demo.alleda.ch')
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE =
      'In der Demo kann die E-Mail-Adresse eines Demo-Kontos keinem weiteren Mitglied '
      || 'zugewiesen werden.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER demo_guard_member_emails
  BEFORE INSERT OR UPDATE OF email, id ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.demo_guard_member_emails();

-- d. app_settings: the club identity shown on the public trial page, the
--    sections and the default language. Writing the same value again is
--    allowed (the settings page upserts).
CREATE OR REPLACE FUNCTION public.demo_guard_app_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_keys text[] := ARRAY['club.name', 'club.url', 'club.logo', 'club.contactEmail',
                         'club.sections', 'locale.default'];
  v_msg text := 'In der Demo können Vereinsname, Website, Logo, Kontakt-E-Mail, Sektionen und '
                || 'Standardsprache nicht geändert werden.';
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.key = ANY (v_keys) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = v_msg;
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.key = ANY (v_keys)
     AND (NEW.key IS DISTINCT FROM OLD.key OR NEW.value IS DISTINCT FROM OLD.value) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = v_msg;
  END IF;
  -- An insert of a guarded key only passes when it repeats the stored value
  -- (an upsert that ends in the UPDATE above)
  IF NEW.key = ANY (v_keys)
     AND (TG_OP = 'INSERT' OR NEW.key IS DISTINCT FROM OLD.key)
     AND NOT EXISTS (SELECT 1 FROM public.app_settings s
                     WHERE s.key = NEW.key AND s.value = NEW.value) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = v_msg;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER demo_guard_app_settings
  BEFORE INSERT OR UPDATE OR DELETE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.demo_guard_app_settings();

-- e. exams: the two exam days stay (no deleting, date, deadline and section
--    fixed), so the member's registration always has an exam to go to
CREATE OR REPLACE FUNCTION public.demo_guard_exams()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF OLD.id NOT IN (1, 2) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE'
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.section IS DISTINCT FROM OLD.section
     OR NEW.date IS DISTINCT FROM OLD.date
     OR NEW.registration_deadline IS DISTINCT FROM OLD.registration_deadline THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE =
      'In der Demo können die Prüfungstage nicht gelöscht und Datum, Anmeldeschluss und '
      || 'Sektion nicht geändert werden.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER demo_guard_exams
  BEFORE UPDATE OR DELETE ON public.exams
  FOR EACH ROW EXECUTE FUNCTION public.demo_guard_exams();

-- f. exam_candidates: a withdrawn registration of a Brunner child (before
--    the exam) is removed, so the next visitor can register again
--    (register_for_exam does not reopen a withdrawn one)
CREATE OR REPLACE FUNCTION public.demo_reopen_exam_registration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.member_id IN (120, 150) AND NEW.status = 'withdrawn'
     AND NEW.started_at IS NULL AND NEW.result IS NULL THEN
    DELETE FROM public.exam_candidates WHERE id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER demo_reopen_exam_registration
  AFTER UPDATE OF status ON public.exam_candidates
  FOR EACH ROW EXECUTE FUNCTION public.demo_reopen_exam_registration();

--    Staff may invite, regroup or remove the Brunner children on the upcoming
--    exam day, but not start or close their sheets: withdraw_exam_registration
--    refuses a started sheet, and the member could no longer try it
CREATE OR REPLACE FUNCTION public.demo_guard_exam_candidates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF (OLD.exam_id = 2 AND OLD.member_id IN (120, 150)
      AND (NEW.started_at IS DISTINCT FROM OLD.started_at
           OR NEW.result IS DISTINCT FROM OLD.result
           OR NEW.completed_at IS DISTINCT FROM OLD.completed_at))
     OR ((NEW.exam_id, NEW.member_id) IS DISTINCT FROM (OLD.exam_id, OLD.member_id)
         AND (OLD.exam_id = 2 AND OLD.member_id IN (120, 150)
              OR NEW.exam_id = 2 AND NEW.member_id IN (120, 150))) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE =
      'In der Demo bleibt die Prüfungsanmeldung der Familie Brunner offen, damit das '
      || 'Demo-Mitgliederkonto sie zurückziehen und neu anmelden kann.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER demo_guard_exam_candidates
  BEFORE UPDATE ON public.exam_candidates
  FOR EACH ROW EXECUTE FUNCTION public.demo_guard_exam_candidates();

-- g. The showcase rows cannot be deleted: the seeded events, exam programs,
--    planned trainings and trial candidates (visitors' own rows can). The
--    trigger arguments name the key column and the seeded keys.
CREATE OR REPLACE FUNCTION public.demo_guard_seeded_rows()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF (to_jsonb(OLD) ->> TG_ARGV[0]) = ANY (string_to_array(TG_ARGV[1], ',')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE =
      'In der Demo können die vorbereiteten Beispieldaten nicht gelöscht werden, '
      || 'selbst erfasste schon.';
  END IF;
  RETURN OLD;
END;
$$;

-- h. No bulk deletes (one API call with a wide filter wiping the attendance,
--    rosters, registrations or the plan): a statement may delete at most
--    TG_ARGV[0] rows. Only rows whose column TG_ARGV[1] is one of the seeded
--    keys TG_ARGV[2] count (when given), and not those whose member
--    (column TG_ARGV[3]) is gone: deleting one member cascades to its
--    grades, registrations etc. (foreign key cascades fire their AFTER
--    triggers with the outer statement, so pg_trigger_depth() does not tell).
--    Deletes run by another trigger (depth > 1) are left to the guard of the
--    row that caused them. The app deletes one row at a time (the training
--    plan up to the sessions picked in its dialog).
CREATE OR REPLACE FUNCTION public.demo_guard_bulk_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_count bigint;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;
  SELECT count(*) INTO v_count
  FROM old_rows o
  CROSS JOIN LATERAL (SELECT to_jsonb(o) AS j) x
  WHERE (coalesce(TG_ARGV[1], '') = ''
         OR (x.j ->> TG_ARGV[1]) = ANY (string_to_array(TG_ARGV[2], ',')))
    AND (coalesce(TG_ARGV[3], '') = ''
         OR EXISTS (SELECT 1 FROM public.members m WHERE m.id = (x.j ->> TG_ARGV[3])::integer));
  IF v_count > TG_ARGV[0]::bigint THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE =
      'In der Demo können nicht so viele vorbereitete Einträge auf einmal gelöscht werden.';
  END IF;
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  v_trainings text := (SELECT string_agg(id::text, ',') FROM public.trainings);
  v_events text := (SELECT string_agg(id::text, ',') FROM public.events);
  v_exams text := (SELECT string_agg(id::text, ',') FROM public.exams);
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('events', 'id', v_events),
      ('exam_programs', 'id', (SELECT string_agg(id::text, ',') FROM public.exam_programs)),
      ('training_plan_trainings', 'training_id',
       (SELECT string_agg(training_id::text, ',') FROM public.training_plan_trainings)),
      ('members', 'id',
       (SELECT string_agg(id::text, ',') FROM public.members WHERE "trialStatus" IS NOT NULL))
    ) AS v(tbl, col, ids)
  LOOP
    EXECUTE format('CREATE OR REPLACE TRIGGER demo_guard_seeded_rows BEFORE DELETE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.demo_guard_seeded_rows(%L, %L)',
                   r.tbl, r.col, r.ids);
  END LOOP;
  FOR r IN
    SELECT * FROM (VALUES
      ('members', 1, '', '', ''),
      ('logs', 1, 'trainingId', v_trainings, 'memberId'),
      ('participants', 1, 'trainingId', v_trainings, 'memberId'),
      ('event_participants', 1, 'eventId', v_events, 'memberId'),
      ('event_logs', 1, 'eventId', v_events, 'memberId'),
      ('member_grades', 1, '', '', 'memberId'),
      ('member_medals', 1, '', '', 'memberId'),
      ('exam_candidates', 1, 'exam_id', v_exams, 'member_id'),
      ('training_plan_sessions', 10, '', '', ''),
      ('training_plan_breaks', 1, '', '', '')
    ) AS v(tbl, max_rows, col, ids, member_col)
  LOOP
    EXECUTE format('CREATE OR REPLACE TRIGGER demo_guard_bulk_delete AFTER DELETE ON public.%I '
                   'REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT '
                   'EXECUTE FUNCTION public.demo_guard_bulk_delete(%L, %L, %L, %L)',
                   r.tbl, r.max_rows, r.col, r.ids, r.member_col);
  END LOOP;
END $$;

-- i. No MFA factor on a shared login (a visitor's TOTP would lock the others
--    out wherever the project enforces it). Hosted projects may refuse
--    triggers on auth tables other than auth.users; then the setting in
--    docs/DEMO.md (MFA off) is the guard.
CREATE OR REPLACE FUNCTION public.demo_guard_mfa_factors()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.user_id IN ('d3e40000-0000-4000-8000-000000000001',
                     'd3e40000-0000-4000-8000-000000000002',
                     'd3e40000-0000-4000-8000-000000000003') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE =
      'In der Demo kann für die Demo-Konten keine Zwei-Faktor-Anmeldung eingerichtet werden.';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  CREATE OR REPLACE TRIGGER demo_guard_mfa_factors
    BEFORE INSERT OR UPDATE ON auth.mfa_factors
    FOR EACH ROW EXECUTE FUNCTION public.demo_guard_mfa_factors();
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'demo_guard_mfa_factors not installed: %', SQLERRM;
END $$;

-- Trigger functions only (Supabase grants EXECUTE on new functions to the API
-- roles, see 20260913140000_relock_security_definer_functions.sql)
REVOKE EXECUTE ON FUNCTION public.demo_guard_auth_users() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.demo_guard_user_profiles() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.demo_guard_members() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.demo_guard_app_settings() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.demo_guard_exams() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.demo_reopen_exam_registration()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.demo_guard_member_emails() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.demo_guard_exam_candidates() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.demo_guard_seeded_rows() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.demo_guard_bulk_delete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.demo_guard_mfa_factors() FROM PUBLIC, anon, authenticated;
