-- Checks for what accounts see of other members' data
-- (20261028100000_member_data_only_for_club_members.sql, docs/MEMBER_SIGN_IN.md)
-- and for the guard of every function the API can call that bypasses RLS.
--
-- Runs like member_access.sql: on a database with every migration and the
-- seed, as postgres, inside one transaction that is rolled back. A failed
-- check raises and stops:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/checks/member_data.sql
--
-- A member account sees the badges, grades, medals and photo of
-- club_member_ids() (its own members and the directory), the badge progress
-- of its own members only, and nothing of anyone else; staff see everything.
-- The probes are generic, so a new table, view or RPC is probed without
-- being listed. The guards at the end fail for a new SECURITY DEFINER
-- function the API can call until it is listed here with its guard.

\set ON_ERROR_STOP 1
\o /dev/null
SET client_min_messages = notice;

BEGIN;

-----------------
-- Helpers (as in member_access.sql)
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

-- Act as this account until RESET ROLE (or the savepoint is rolled back)
CREATE FUNCTION pg_temp.act_as(p_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
END $$;

-- What the current role can read about members outside p_visible: rows of
-- every table and view with a member column, the avatars, every STABLE
-- zero-argument RPC returning member ids, and every STABLE RPC taking one
-- member id, called with each id of p_probe. Returns what leaked, '' when
-- nothing did.
CREATE FUNCTION pg_temp.club_leaks(p_visible integer[], p_probe integer[]) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  r record;
  v_id integer;
  n bigint;
  v_out text := '';
BEGIN
  FOR r IN
    SELECT c.relname, a.attname FROM pg_class c
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'v', 'm', 'p')
      AND c.relname <> 'user_profiles'  -- the account's own row
      AND has_table_privilege(current_user, c.oid, 'SELECT')
      AND (a.attname IN ('memberId', 'member_id')
           OR (a.attname = 'id' AND (c.relname = 'members' OR c.relname ~ '^view_\w*members$')))
    ORDER BY 1, 2
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I <> ALL ($1)', r.relname, r.attname)
      INTO n USING p_visible;
    IF n > 0 THEN v_out := v_out || r.relname || '.' || r.attname || '=' || n || ' '; END IF;
  END LOOP;

  SELECT count(*) INTO n FROM storage.objects
  WHERE bucket_id = 'avatars' AND split_part(name, '_', 1) <> ALL (p_visible::text[]);
  IF n > 0 THEN v_out := v_out || 'avatars=' || n || ' '; END IF;

  -- The column holding the member id: memberId / member_id, the value of
  -- an RPC returning integers, or id of an RPC about members
  FOR r IN
    SELECT p.proname, coalesce(
             (SELECT quote_ident(a) FROM unnest(p.proargnames) a
              WHERE a IN ('memberId', 'member_id') LIMIT 1),
             CASE WHEN p.prorettype = 'integer'::regtype THEN 'x' END,
             CASE WHEN p.proname ~ 'member' AND 'id' = ANY (p.proargnames) THEN 'id' END
           ) AS col
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.pronargs = 0 AND p.proretset AND p.provolatile <> 'v'
      AND has_function_privilege(current_user, p.oid, 'EXECUTE')
    ORDER BY 1
  LOOP
    CONTINUE WHEN r.col IS NULL;
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I() AS x WHERE %s <> ALL ($1)', r.proname, r.col)
        INTO n USING p_visible;
    EXCEPTION WHEN OTHERS THEN n := 0;  -- refusing is fine
    END;
    IF n > 0 THEN v_out := v_out || r.proname || '()=' || n || ' '; END IF;
  END LOOP;

  FOR r IN
    SELECT p.proname FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.pronargs = 1 AND p.proargtypes[0] = 'integer'::regtype AND p.proretset
      AND pg_get_function_identity_arguments(p.oid) ~* 'member'
      AND p.provolatile <> 'v'
      AND has_function_privilege(current_user, p.oid, 'EXECUTE')
    ORDER BY 1
  LOOP
    FOREACH v_id IN ARRAY p_probe LOOP
      BEGIN
        EXECUTE format('SELECT count(*) FROM public.%I($1)', r.proname) INTO n USING v_id;
      EXCEPTION WHEN OTHERS THEN n := 0;  -- refusing is fine
      END;
      IF n > 0 THEN v_out := v_out || r.proname || '(' || v_id || ')=' || n || ' '; END IF;
    END LOOP;
  END LOOP;
  RETURN v_out;
END $$;

-- What a profile shows of each of these members, as the current role reads
-- it: badges, current grades, grade history, medals and photos
CREATE FUNCTION pg_temp.profiles(p_ids integer[]) RETURNS text
LANGUAGE sql AS $$
  SELECT string_agg(i || ':' || (SELECT count(*) FROM public.get_member_badges(i))
    || '/' || (SELECT count(*) FROM public.get_member_current_grades(i))
    || '/' || (SELECT count(*) FROM public.member_grades WHERE "memberId" = i)
    || '/' || (SELECT count(*) FROM public.member_medals WHERE "memberId" = i)
    || '/' || (SELECT count(*) FROM storage.objects
               WHERE bucket_id = 'avatars' AND split_part(name, '_', 1) = i::text),
    ' ' ORDER BY i)
  FROM unnest(p_ids) i;
$$;

-- API functions bypassing RLS that take a member id but check neither the
-- member against the caller (can_see_member, my_member_ids) nor a staff role:
-- an admin tool such as merging two members needs no member guard
CREATE FUNCTION pg_temp.unguarded_member_functions() RETURNS text
LANGUAGE sql AS $$
  SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
    AND p.prorettype <> 'trigger'::regtype
    AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
         OR has_function_privilege('anon', p.oid, 'EXECUTE'))
    AND pg_get_function_identity_arguments(p.oid) ~* 'member'
    AND p.prosrc !~ '(can_see_member|my_member_ids|is_staff|is_writer|is_admin|is_exam_manager|is_examiner)\(';
$$;

-----------------
-- Test data: a photo of every member (as <member id>_<ms>.webp, like the
-- app) and one with another name; the bucket comes from config.toml, which
-- supabase db start does not apply
-----------------

DO $$
BEGIN
  INSERT INTO storage.buckets (id, name) VALUES ('avatars', 'avatars') ON CONFLICT DO NOTHING;
  INSERT INTO storage.objects (bucket_id, name)
  SELECT 'avatars', m.id || '_1700000000000.webp' FROM public.members m
  UNION ALL SELECT 'avatars', 'member-data-check.jpg';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'skip avatars objects: %', SQLERRM;
END $$;

-----------------
-- A member account (member@example.com, parent of 103 and 107) and a viewer
-----------------

SAVEPOINT s;
DO $$
DECLARE
  v_member uuid := 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
  v_viewer uuid := 'c3d4e5f6-a7b8-9012-cdef-123456789012';
  v_since text := (SELECT to_char(max(date)::date - 365, 'YYYY-MM-DD') FROM public.logs
                   WHERE date ~ '^\d{4}-\d{2}-\d{2}$');
  v_photos boolean := EXISTS (SELECT 1 FROM storage.objects
                              WHERE bucket_id = 'avatars' AND name = '103_1700000000000.webp');
  v_visible integer[];  -- own members and the directory, computed here on its own
  v_other integer;      -- in the directory, not the member's own
  v_outside integer;    -- membership counts, no training in the window
  v_gone integer;       -- trained, membership does not count
  v_listed integer[];
  v_club integer[];
  v_staff_sees text;
  v_n bigint;
  v_tables text;
  v_lists text;
  v_ok boolean;
BEGIN
  v_visible := ARRAY(
    SELECT 103 UNION SELECT 107
    UNION
    SELECT m.id FROM public.members m
    WHERE m.membership_status IN ('active', 'passive') AND m."archivedAt" IS NULL
      AND NOT public.has_trial_label(m.labels)
      AND EXISTS (SELECT 1 FROM public.logs l WHERE l."memberId" = m.id AND l.date >= v_since)
    ORDER BY 1);
  v_other := (SELECT min(b."memberId") FROM public.member_badges b
              WHERE b."memberId" = ANY (v_visible) AND b."memberId" NOT IN (103, 107));
  v_outside := (SELECT min(m.id) FROM public.members m
                WHERE m.membership_status = 'active' AND m."archivedAt" IS NULL
                  AND NOT (m.id = ANY (v_visible)));
  v_gone := (SELECT min(m.id) FROM public.members m
             WHERE m.membership_status IN ('non_member', 'left')
               AND EXISTS (SELECT 1 FROM public.member_badges b WHERE b."memberId" = m.id)
               AND EXISTS (SELECT 1 FROM public.logs l WHERE l."memberId" = m.id AND l.date >= v_since));
  PERFORM pg_temp.ok('data: seed has every kind of member',
    v_other IS NOT NULL AND v_outside IS NOT NULL AND v_gone IS NOT NULL);

  -- Grades and medals inside and outside the club, so there is something
  -- to show and to hide (the seed has none outside)
  INSERT INTO public.member_grades ("memberId", section, grade, "examDate", note)
  VALUES (v_other, 'Judo', '5. Kyu', '2024-01-01', 'member data check'),
         (v_outside, 'Judo', '5. Kyu', '2024-01-01', 'member data check'),
         (v_gone, 'Judo', '5. Kyu', '2024-01-01', 'member data check');
  INSERT INTO public.member_medals ("memberId", competition, date, section, medal)
  VALUES (v_other, 'member data check', '2024-01-01', 'Judo', 'gold'),
         (v_outside, 'member data check', '2024-01-01', 'Judo', 'gold'),
         (v_gone, 'member data check', '2024-01-01', 'Judo', 'gold');

  PERFORM pg_temp.act_as(v_member);
  v_club := ARRAY(SELECT x FROM public.club_member_ids() x ORDER BY x);
  v_listed := ARRAY(SELECT id FROM public.get_member_directory() ORDER BY id);
  RESET ROLE;
  PERFORM pg_temp.act_as(v_viewer);
  v_staff_sees := pg_temp.profiles(v_listed);
  RESET ROLE;

  PERFORM pg_temp.act_as(v_member);
  PERFORM pg_temp.ok('data: club_member_ids is the directory', v_club = v_listed);
  PERFORM pg_temp.ok('data: club_member_ids is own members plus those who count and trained',
    v_club = v_visible);
  PERFORM pg_temp.eq('data: member sees nothing of members outside the club',
    pg_temp.club_leaks(v_visible, ARRAY[v_outside, v_gone, 901]), '');
  -- Any profile the directory opens loads without an error and shows what
  -- staff see there
  PERFORM pg_temp.eq('data: every directory profile shows badges, grades, medals, photo',
    pg_temp.profiles(v_listed), v_staff_sees);
  PERFORM pg_temp.ok('data: a directory profile has all of them',
    pg_temp.profiles(ARRAY[v_other]) ~ ('^' || v_other || ':[1-9]\d*/[1-9]\d*/[1-9]\d*/[1-9]\d*/'
                                        || CASE WHEN v_photos THEN '1' ELSE '0' END || '$'));
  PERFORM pg_temp.ok('data: the club lists show the directory',
    EXISTS (SELECT 1 FROM public.get_members_top_badges() WHERE "memberId" = v_other)
    AND EXISTS (SELECT 1 FROM public.get_members_current_grades() WHERE "memberId" = v_other));
  PERFORM pg_temp.ok('data: member sees badge progress of its own members',
    (SELECT count(*) FROM public.get_member_badge_progress(103)) > 0
    AND (SELECT count(*) FROM public.get_member_badge_progress(107)) > 0);
  BEGIN
    PERFORM count(*) FROM public.get_member_badge_progress(v_other);
    v_ok := false;
  EXCEPTION WHEN OTHERS THEN v_ok := SQLERRM = 'NOT_ALLOWED';
  END;
  PERFORM pg_temp.ok('data: member is refused the badge progress (attendance) of others', v_ok);
  PERFORM pg_temp.eq('data: staff-only lists are empty for members',
    (SELECT count(*) FROM public.get_recent_achievements(100))
    || ' ' || (SELECT count(*) FROM public.get_badge_leaderboard())
    || ' ' || (SELECT count(*) FROM public.get_members_medal_counts()), '0 0 0');
  IF v_photos THEN
    PERFORM pg_temp.eq('data: member sees the photos of the club only',
      (SELECT string_agg(name, ',' ORDER BY name) FROM storage.objects WHERE bucket_id = 'avatars'),
      (SELECT string_agg(i || '_1700000000000.webp', ',' ORDER BY i || '_1700000000000.webp')
       FROM unnest(v_visible) i));
  END IF;
  BEGIN
    PERFORM public.can_see_member(103);
    v_ok := false;
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
  END;
  PERFORM pg_temp.ok('data: can_see_member is not an API function', v_ok);
  RESET ROLE;

  -- Staff keep everything: the same counts as postgres (no RLS) reads
  v_tables := (SELECT count(*) FROM public.member_badges)
    || ' ' || (SELECT count(*) FROM public.member_grades)
    || ' ' || (SELECT count(*) FROM public.member_medals)
    || ' ' || (SELECT count(*) FROM storage.objects WHERE bucket_id = 'avatars');
  v_lists := (SELECT count(DISTINCT b."memberId") FROM public.member_badges b
              JOIN public.badge_definitions d ON d.id = b."badgeId" WHERE d.category <> 'grade')
    || ' ' || (SELECT count(DISTINCT "memberId") FROM public.member_grades)
    || ' ' || (SELECT count(DISTINCT "memberId") FROM public.member_medals)
    || ' ' || least(20, (SELECT count(DISTINCT "memberId") FROM public.member_badges));
  v_n := (SELECT count(*) FROM public.member_badges);
  PERFORM pg_temp.act_as(v_viewer);
  PERFORM pg_temp.eq('data: viewer reads all badges, grades, medals, photos',
    (SELECT count(*) FROM public.member_badges)
    || ' ' || (SELECT count(*) FROM public.member_grades)
    || ' ' || (SELECT count(*) FROM public.member_medals)
    || ' ' || (SELECT count(*) FROM storage.objects WHERE bucket_id = 'avatars'),
    v_tables);
  PERFORM pg_temp.eq('data: viewer lists every member',
    (SELECT count(*) FROM public.get_members_top_badges())
    || ' ' || (SELECT count(DISTINCT "memberId") FROM public.get_members_current_grades())
    || ' ' || (SELECT count(*) FROM public.get_members_medal_counts())
    || ' ' || (SELECT count(*) FROM public.get_badge_leaderboard()),
    v_lists);
  -- The limit is an admin setting without a maximum (display.recentAchievementsLimit)
  PERFORM pg_temp.eq('data: recent achievements: default 10, NULL 10, -1 none, at most 100',
    (SELECT count(*) FROM public.get_recent_achievements())
    || ' ' || (SELECT count(*) FROM public.get_recent_achievements(NULL))
    || ' ' || (SELECT count(*) FROM public.get_recent_achievements(-1))
    || ' ' || (SELECT count(*) FROM public.get_recent_achievements(5))
    || ' ' || (SELECT count(*) FROM public.get_recent_achievements(100000)),
    least(10, v_n) || ' ' || least(10, v_n) || ' 0 ' || least(5, v_n) || ' ' || least(100, v_n));
  PERFORM pg_temp.ok('data: viewer sees any member, also one who left',
    (SELECT count(*) FROM public.get_member_badges(v_gone)) > 0
    AND (SELECT count(*) FROM public.get_member_current_grades(v_gone)) > 0
    AND (SELECT count(*) FROM public.get_member_badge_progress(v_gone)) > 0);
  RESET ROLE;

  -- Without access (both children left) the club is empty, own members too
  UPDATE public.members SET labels = '["03_Austritt"]' WHERE id IN (103, 107);
  PERFORM pg_temp.act_as(v_member);
  PERFORM pg_temp.eq('data: no club without access',
    (SELECT count(*) FROM public.club_member_ids())
    || ' ' || (SELECT count(*) FROM public.get_member_badges(v_other))
    || ' ' || (SELECT count(*) FROM public.member_badges)
    || ' ' || (SELECT count(*) FROM storage.objects WHERE bucket_id = 'avatars'),
    '0 0 0 0');
  RESET ROLE;
END $$;
ROLLBACK TO SAVEPOINT s;

-----------------
-- Privileges
-----------------

SELECT pg_temp.ok('club_member_ids only for signed-in accounts',
  has_function_privilege('authenticated', 'public.club_member_ids()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.club_member_ids()', 'EXECUTE'));
SELECT pg_temp.ok('can_see_member not callable through the API', NOT (
     has_function_privilege('authenticated', 'public.can_see_member(integer, boolean)', 'EXECUTE')
  OR has_function_privilege('anon', 'public.can_see_member(integer, boolean)', 'EXECUTE')));
SELECT pg_temp.ok('badge lists not callable by anon', NOT (
     has_function_privilege('anon', 'public.get_members_top_badges()', 'EXECUTE')
  OR has_function_privilege('anon', 'public.get_badge_leaderboard()', 'EXECUTE')
  OR has_function_privilege('anon', 'public.get_recent_achievements(integer)', 'EXECUTE')
  OR has_function_privilege('anon', 'public.get_members_medal_counts()', 'EXECUTE')
  OR has_function_privilege('anon', 'public.get_members_current_grades()', 'EXECUTE')));

-- Anonymous callers reach only the public trial form and the helpers the
-- policies TO public need; a function dropped and recreated gets EXECUTE
-- for anon again (get_members_top_badges did in 20260930150000)
SELECT pg_temp.eq('API functions bypassing RLS that anon may call',
  (SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
     AND p.prorettype <> 'trigger'::regtype
     AND has_function_privilege('anon', p.oid, 'EXECUTE')),
  'cancel_trial,complete_trial_email,get_trial_status,is_admin,is_approved_user,is_writer,register_trial');

-----------------
-- Guards for later changes
-----------------

-- A SECURITY DEFINER function skips RLS, so each one the API can call states
-- here who may see what, and its body must call that guard. A new one fails
-- until it is added with its guard: can_see_member (one member),
-- club_member_ids (lists the club area shows), my_member_ids (own members),
-- a staff role, or why it needs none.
CREATE TEMP TABLE api_guard (proname text PRIMARY KEY, guard text NOT NULL);
INSERT INTO api_guard VALUES
  -- one member: staff, or the club's members (progress: own members)
  ('get_member_badges',          'can_see_member\('),
  ('get_member_current_grades',  'can_see_member\('),
  ('get_member_badge_progress',  'can_see_member\(p_member_id, p_own_only => true\)'),
  -- lists the club area shows
  ('get_member_directory',       'club_member_ids\('),
  ('get_members_current_grades', 'club_member_ids\('),
  ('get_members_top_badges',     'club_member_ids\('),
  -- own members
  ('club_member_ids',            'my_member_ids\('),
  ('get_my_exam_registrations',  'my_member_ids\('),
  ('register_for_exam',          'my_member_ids\('),
  ('withdraw_exam_registration', 'my_member_ids\('),
  -- staff pages only
  ('get_badge_leaderboard',      'is_staff\('),
  ('get_members_medal_counts',   'is_staff\('),
  ('get_recent_achievements',    'is_staff\('),
  ('member_access_report',       'is_admin\('),
  ('merge_members',              'is_admin\('),
  ('merge_members_preview',      'is_admin\('),
  ('refresh_all_member_badges',  'is_writer\('),
  ('ai_import_begin',            'is_writer\('),
  ('ai_import_remaining',        'is_writer\('),
  -- the caller's own account, or no member data
  ('ai_import_finish',           'auth\.uid\('),
  ('my_access',                  'auth\.uid\('),
  ('get_exam_program_grades',    'is_approved_user\('),
  -- the role helpers read the caller's own profile
  ('is_admin',                   'auth\.uid\('),
  ('is_approved_user',           'auth\.uid\('),
  ('is_exam_manager',            'auth\.uid\('),
  ('is_examiner',                'auth\.uid\('),
  ('is_staff',                   'auth\.uid\('),
  ('is_writer',                  'auth\.uid\('),
  ('my_member_ids',              'auth\.uid\('),
  -- public trial form: a secret token, or rate limits for new candidates
  ('get_trial_status',           'p_token'),
  ('cancel_trial',               'p_token'),
  ('complete_trial_email',       'p_token'),
  ('register_trial',             'TRIAL_MAX_PER_EMAIL');

SELECT pg_temp.eq('API functions bypassing RLS without their guard',
  (SELECT string_agg(coalesce(p.proname, g.proname)
                     || CASE WHEN g.proname IS NULL THEN ' (not listed)'
                             WHEN p.proname IS NULL THEN ' (gone, drop from the list)'
                             ELSE ' (guard missing)' END, ', ' ORDER BY coalesce(p.proname, g.proname))
   FROM (SELECT p.proname, p.prosrc FROM pg_proc p
         WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
           AND p.prorettype <> 'trigger'::regtype
           AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
                OR has_function_privilege('anon', p.oid, 'EXECUTE'))) p
   FULL JOIN api_guard g ON g.proname = p.proname
   WHERE g.proname IS NULL OR p.proname IS NULL OR p.prosrc !~ g.guard),
  NULL);

-- Whatever the list above says: an API function bypassing RLS that takes a
-- member id must check it against the caller or require a staff role
SELECT pg_temp.eq('API functions taking a member id without a member or staff guard',
  pg_temp.unguarded_member_functions(), NULL);

-- The two guards above and the probe catch what they should: an admin tool
-- taking member ids passes, an RPC handing out any member's row does not
SAVEPOINT s;
CREATE FUNCTION public.zz_check_merge(p_keep_member_id integer, p_drop_member_id integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'NOT_ALLOWED';
  END IF;
END $$;
CREATE FUNCTION public.zz_check_peek(p_member_id integer)
RETURNS SETOF integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id FROM public.members m WHERE m.id = p_member_id;
$$;
SELECT pg_temp.eq('guard check: admin tools pass, an unguarded RPC fails',
  pg_temp.unguarded_member_functions(), 'zz_check_peek');
DO $$
DECLARE
  v_member uuid := 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
  v_club integer[];
  v_outside integer;
BEGIN
  PERFORM pg_temp.act_as(v_member);
  v_club := ARRAY(SELECT public.club_member_ids());
  RESET ROLE;
  v_outside := (SELECT min(id) FROM public.members WHERE id <> ALL (v_club));
  PERFORM pg_temp.act_as(v_member);
  PERFORM pg_temp.ok('guard check: the probe finds an unguarded RPC',
    pg_temp.club_leaks(v_club, ARRAY[v_outside]) ~ ('zz_check_peek\(' || v_outside || '\)=1'));
  RESET ROLE;
END $$;
ROLLBACK TO SAVEPOINT s;

-- Rows about one member: read policies need staff or the member guards;
-- is_approved_user() alone lets every member account read every member
SELECT pg_temp.eq('read policies on member rows without a member guard',
  (SELECT string_agg(pol.tablename || '.' || pol.policyname, ',' ORDER BY 1) FROM pg_policies pol
   WHERE pol.schemaname = 'public' AND pol.cmd IN ('SELECT', 'ALL')
     AND (pol.tablename = 'members' OR EXISTS (
           SELECT 1 FROM information_schema.columns c
           WHERE c.table_schema = 'public' AND c.table_name = pol.tablename
             AND c.column_name IN ('memberId', 'member_id')))
     AND (coalesce(pol.qual, '') ~ 'is_approved_user'
          OR coalesce(pol.qual, '') !~ '(is_staff|is_writer|is_admin|my_member_ids|club_member_ids|auth\.uid)\(')),
  NULL);

-- Photos: the policy, and a private bucket (a public one serves every file
-- by URL without asking the policy)
SELECT pg_temp.ok('photos: members read only the club''s',
  (SELECT qual ~ 'club_member_ids\(' AND qual !~ 'is_approved_user' FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'avatars_read'));
SELECT pg_temp.ok('photos: the avatars bucket is private',
  NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'avatars' AND public));

ROLLBACK;

\o
\echo 'member_data: all checks passed'
