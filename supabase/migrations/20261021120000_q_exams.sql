-- Q-Prüfungen (kyu gradings), digitally: registration, the exam day on the
-- examiners' phones, and the result on the member's profile. See
-- docs/Q_EXAMS.md for the process this models.
--
--   exam_programs      what a candidate has to show for a grade (the TK's
--                      exam sheets): parts (Nage-waza, Ukemi, …) with items,
--                      scored 0–2 per side, optional part minimum, overall
--                      minimum. Seeded below with the Judo sheets.
--   exams              an exam day (usually linked to the event from Webling)
--   exam_candidates    one row per member and exam day: the registration
--                      (target grade, belt length), the call-up (group, time)
--                      and, once graded, a snapshot of the program, the
--                      result and the feedback.
--   exam_examiners     who graded a candidate (examiners assign themselves)
--   exam_scores        one row per candidate and item: left/right or single
--                      points and the examiner's note
--
-- Passing an exam records the grade in member_grades (trigger below), so the
-- belt shows up everywhere grades are shown; reopening the sheet takes it
-- back out again.
--
-- Access
--   * Staff read everything; trainers and admins (is_writer) manage exam
--     days, candidates and programs and grade.
--   * Members see exam days and programs (to prepare for the next belt),
--     register their own members through register_for_exam(), withdraw
--     through withdraw_exam_registration(), and read their own sheets once
--     the result is in.

-- ---------------------------------------------------------------------------
-- 1. Half belts
-- The kids' program has intermediate belts between white and green. They
-- become rungs of the Judo ladder so a passed exam can be recorded like any
-- other grade. "beltColor2" is the second colour of a two-coloured belt.
-- ---------------------------------------------------------------------------
ALTER TABLE public.grade_definitions ADD COLUMN IF NOT EXISTS "beltColor2" text;

UPDATE public.grade_definitions
SET "gradeRank" = CASE grade
    WHEN '5. Kyu' THEN 3
    WHEN '4. Kyu' THEN 5
    WHEN '3. Kyu' THEN 7
    ELSE "gradeRank" + 3
  END
WHERE section = 'Judo'
  AND "gradeRank" > 1
  AND NOT EXISTS (
    SELECT 1 FROM public.grade_definitions WHERE section = 'Judo' AND grade = '5.5 Kyu'
  );

INSERT INTO public.grade_definitions (section, grade, "gradeRank", "beltColor", "beltColor2", "isDan") VALUES
    ('Judo', '5.5 Kyu', 2, '#f5f5f5', '#f4d03f', false),
    ('Judo', '4.5 Kyu', 4, '#f4d03f', '#f0932b', false),
    ('Judo', '3.5 Kyu', 6, '#f0932b', '#27ae60', false)
ON CONFLICT (section, grade) DO NOTHING;

-- The current-grade functions return the second colour as well (appended
-- column; the return type changes, hence drop and create).
DROP FUNCTION IF EXISTS public.get_member_current_grades(int);
CREATE FUNCTION public.get_member_current_grades(p_member_id int)
RETURNS TABLE (
    section text,
    grade text,
    "gradeRank" int,
    "beltColor" text,
    "isDan" boolean,
    "examDate" text,
    "nextGrade" text,
    "beltColor2" text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT DISTINCT ON (mg.section)
        mg.section,
        mg.grade,
        gd."gradeRank",
        gd."beltColor",
        gd."isDan",
        mg."examDate",
        (
            SELECT g2.grade FROM public.grade_definitions g2
            WHERE g2.section = mg.section AND g2."gradeRank" = gd."gradeRank" + 1
        ) AS "nextGrade",
        gd."beltColor2"
    FROM public.member_grades mg
    JOIN public.grade_definitions gd ON gd.section = mg.section AND gd.grade = mg.grade
    WHERE mg."memberId" = p_member_id
      AND public.is_approved_user()
    ORDER BY mg.section, gd."gradeRank" DESC, mg."examDate" DESC;
$$;

DROP FUNCTION IF EXISTS public.get_members_current_grades();
CREATE FUNCTION public.get_members_current_grades()
RETURNS TABLE (
    "memberId" int,
    section text,
    grade text,
    "gradeRank" int,
    "beltColor" text,
    "isDan" boolean,
    "beltColor2" text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT DISTINCT ON (mg."memberId", mg.section)
        mg."memberId",
        mg.section,
        mg.grade,
        gd."gradeRank",
        gd."beltColor",
        gd."isDan",
        gd."beltColor2"
    FROM public.member_grades mg
    JOIN public.grade_definitions gd ON gd.section = mg.section AND gd.grade = mg.grade
    WHERE public.is_approved_user()
    ORDER BY mg."memberId", mg.section, gd."gradeRank" DESC, mg."examDate" DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_member_current_grades(int) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_members_current_grades()   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_member_current_grades(int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_members_current_grades()   TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

-- parts: [{ key, title, subtitle?, minPoints?, items: [{ key, name,
-- description?, sides }] }] — sides 2: left and right are scored separately,
-- 1: one score. Every scored side is worth 0, 1 or 2 points. Item keys stay
-- stable when the program is edited; sheets keep their own snapshot anyway.
CREATE TABLE public.exam_programs (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  section text NOT NULL,
  grade text NOT NULL,
  title text NOT NULL,
  min_points integer NOT NULL CHECK (min_points >= 0),
  parts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(parts) = 'array'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE SET NULL,
  CONSTRAINT exam_programs_grade_fkey FOREIGN KEY (section, grade)
    REFERENCES public.grade_definitions (section, grade) ON UPDATE CASCADE,
  CONSTRAINT exam_programs_unique UNIQUE (section, grade)
);

CREATE TABLE public.exams (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  section text NOT NULL,
  title text NOT NULL,
  date text NOT NULL CHECK (date ~ '^\d{4}-\d{2}-\d{2}$'), -- YYYY-MM-DD like every date in the app
  location text,
  -- Members may register until this day (inclusive); staff any time.
  registration_deadline text CHECK (registration_deadline ~ '^\d{4}-\d{2}-\d{2}$'),
  -- Shown to members with the registration, e.g. fee and what to bring
  notes text,
  event_id integer REFERENCES public.events (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE SET NULL
);

CREATE INDEX exams_date_idx ON public.exams (date);

CREATE TABLE public.exam_candidates (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  exam_id bigint NOT NULL REFERENCES public.exams (id) ON DELETE CASCADE,
  member_id integer NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  -- The grade the candidate is examined for
  section text NOT NULL,
  grade text NOT NULL,
  -- Registration, as on the sheet in the dojo
  belt_length_cm smallint CHECK (belt_length_cm BETWEEN 100 AND 400),
  trainer text,
  note text,
  -- registered → invited (called up by the TK); withdrawn keeps the history
  status text NOT NULL DEFAULT 'registered'
    CHECK (status IN ('registered', 'invited', 'withdrawn')),
  group_name text,
  call_time text CHECK (call_time ~ '^\d{2}:\d{2}$'),
  -- Grading: the program as it was when grading started
  program jsonb CHECK (program IS NULL OR jsonb_typeof(program) = 'array'),
  min_points integer,
  started_at timestamptz,
  -- Result
  result text CHECK (result IN ('passed', 'failed')),
  total_points integer,
  max_points integer,
  feedback text,
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  -- The member_grades row this exam created (null when the grade was on file already)
  member_grade_id bigint REFERENCES public.member_grades (id) ON DELETE SET NULL,
  registered_at timestamptz NOT NULL DEFAULT now(),
  registered_by uuid DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE SET NULL,
  CONSTRAINT exam_candidates_grade_fkey FOREIGN KEY (section, grade)
    REFERENCES public.grade_definitions (section, grade) ON UPDATE CASCADE,
  CONSTRAINT exam_candidates_unique UNIQUE (exam_id, member_id)
);

CREATE INDEX exam_candidates_member_idx ON public.exam_candidates (member_id);

CREATE TABLE public.exam_examiners (
  candidate_id bigint NOT NULL REFERENCES public.exam_candidates (id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  -- Display name at the time, so members can read it without user_profiles access
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (candidate_id, user_id)
);

CREATE INDEX exam_examiners_user_idx ON public.exam_examiners (user_id);

-- One row per candidate and item; left/right for two-sided items, points
-- for single ones. Upserts only touch the columns they send, so two
-- examiners scoring different sides do not overwrite each other.
CREATE TABLE public.exam_scores (
  candidate_id bigint NOT NULL REFERENCES public.exam_candidates (id) ON DELETE CASCADE,
  item_key text NOT NULL,
  left_points smallint CHECK (left_points BETWEEN 0 AND 2),
  right_points smallint CHECK (right_points BETWEEN 0 AND 2),
  points smallint CHECK (points BETWEEN 0 AND 2),
  note text CHECK (length(note) <= 2000),
  PRIMARY KEY (candidate_id, item_key)
);

-- ---------------------------------------------------------------------------
-- 3. Passing records the grade
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_exam_candidate_result()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_date text;
  v_grade_id bigint;
BEGIN
  IF NEW.result IS NOT DISTINCT FROM OLD.result THEN
    RETURN NEW;
  END IF;

  -- Reopened or changed: the grade this exam recorded is deleted after the
  -- update (remove_exam_candidate_grade), deleting it here would trip the
  -- foreign key on this very row.
  NEW.member_grade_id := NULL;

  IF NEW.result = 'passed' THEN
    SELECT date INTO v_date FROM public.exams WHERE id = NEW.exam_id;
    INSERT INTO public.member_grades ("memberId", section, grade, "examDate", note)
    VALUES (
      NEW.member_id, NEW.section, NEW.grade, v_date,
      CASE WHEN NEW.total_points IS NOT NULL AND NEW.max_points IS NOT NULL
        THEN 'Q-Prüfung: ' || NEW.total_points || '/' || NEW.max_points || ' Punkte'
        ELSE 'Q-Prüfung'
      END
    )
    ON CONFLICT ("memberId", section, grade) DO NOTHING
    RETURNING id INTO v_grade_id;
    NEW.member_grade_id := v_grade_id;
  END IF;

  IF NEW.result IS NULL THEN
    NEW.completed_at := NULL;
    NEW.completed_by := NULL;
  ELSE
    NEW.completed_at := now();
    NEW.completed_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER exam_candidates_sync_result
  BEFORE UPDATE OF result ON public.exam_candidates
  FOR EACH ROW EXECUTE FUNCTION public.sync_exam_candidate_result();

CREATE OR REPLACE FUNCTION public.remove_exam_candidate_grade()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.member_grades WHERE id = OLD.member_grade_id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER exam_candidates_remove_grade
  AFTER UPDATE OF result ON public.exam_candidates
  FOR EACH ROW
  WHEN (OLD.member_grade_id IS NOT NULL AND NEW.member_grade_id IS DISTINCT FROM OLD.member_grade_id)
  EXECUTE FUNCTION public.remove_exam_candidate_grade();

-- ---------------------------------------------------------------------------
-- 4. Registration by members
-- ---------------------------------------------------------------------------

-- Register one of the caller's own members (or change the registration while
-- it is still open). Returns the candidate id.
CREATE OR REPLACE FUNCTION public.register_for_exam(
  p_exam_id bigint,
  p_member_id integer,
  p_grade text,
  p_belt_length_cm integer DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exam public.exams;
  v_today text := to_char((now() AT TIME ZONE 'Europe/Zurich')::date, 'YYYY-MM-DD');
  v_id bigint;
BEGIN
  IF p_member_id IS NULL OR p_member_id NOT IN (SELECT public.my_member_ids()) THEN
    RAISE EXCEPTION 'not one of your members' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_exam FROM public.exams WHERE id = p_exam_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'exam not found' USING ERRCODE = 'P0002';
  END IF;
  IF coalesce(v_exam.registration_deadline, v_exam.date) < v_today OR v_exam.date < v_today THEN
    RAISE EXCEPTION 'registration closed' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.grade_definitions
    WHERE section = v_exam.section AND grade = p_grade AND NOT "isDan"
  ) THEN
    RAISE EXCEPTION 'invalid grade' USING ERRCODE = '22023';
  END IF;
  IF p_belt_length_cm IS NOT NULL AND p_belt_length_cm NOT BETWEEN 100 AND 400 THEN
    RAISE EXCEPTION 'invalid belt length' USING ERRCODE = '22023';
  END IF;
  IF length(coalesce(p_note, '')) > 500 THEN
    RAISE EXCEPTION 'input too long' USING ERRCODE = '22001';
  END IF;

  INSERT INTO public.exam_candidates (exam_id, member_id, section, grade, belt_length_cm, note, registered_by)
  VALUES (p_exam_id, p_member_id, v_exam.section, p_grade, p_belt_length_cm,
          nullif(btrim(p_note), ''), auth.uid())
  ON CONFLICT (exam_id, member_id) DO UPDATE SET
    grade = EXCLUDED.grade,
    belt_length_cm = EXCLUDED.belt_length_cm,
    note = EXCLUDED.note,
    status = 'registered',
    registered_at = now(),
    registered_by = EXCLUDED.registered_by
  -- Once the TK has called the candidate up, changes go through the trainers
  WHERE public.exam_candidates.status IN ('registered', 'withdrawn')
    AND public.exam_candidates.started_at IS NULL
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'registration can no longer be changed' USING ERRCODE = '22023';
  END IF;
  RETURN v_id;
END;
$$;

-- Withdraw one of the caller's own registrations, up to the exam day.
CREATE OR REPLACE FUNCTION public.withdraw_exam_registration(p_candidate_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today text := to_char((now() AT TIME ZONE 'Europe/Zurich')::date, 'YYYY-MM-DD');
BEGIN
  UPDATE public.exam_candidates c
  SET status = 'withdrawn'
  FROM public.exams e
  WHERE c.id = p_candidate_id
    AND e.id = c.exam_id
    AND c.member_id IN (SELECT public.my_member_ids())
    AND c.started_at IS NULL
    AND c.result IS NULL
    AND e.date >= v_today;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'registration can no longer be withdrawn' USING ERRCODE = '22023';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Row level security
-- Role checks in scalar subselects run once per statement (see
-- 20260913150000_perf_rls_initplan_and_indexes.sql).
-- ---------------------------------------------------------------------------
ALTER TABLE public.exam_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_examiners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_scores ENABLE ROW LEVEL SECURITY;

-- Programs and exam days: every approved account reads, writers maintain
CREATE POLICY exam_programs_read ON public.exam_programs FOR SELECT TO authenticated
  USING ((SELECT public.is_approved_user()));
CREATE POLICY exam_programs_insert ON public.exam_programs FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_writer()));
CREATE POLICY exam_programs_update ON public.exam_programs FOR UPDATE TO authenticated
  USING ((SELECT public.is_writer())) WITH CHECK ((SELECT public.is_writer()));
CREATE POLICY exam_programs_delete ON public.exam_programs FOR DELETE TO authenticated
  USING ((SELECT public.is_writer()));

CREATE POLICY exams_read ON public.exams FOR SELECT TO authenticated
  USING ((SELECT public.is_approved_user()));
CREATE POLICY exams_insert ON public.exams FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_writer()));
CREATE POLICY exams_update ON public.exams FOR UPDATE TO authenticated
  USING ((SELECT public.is_writer())) WITH CHECK ((SELECT public.is_writer()));
CREATE POLICY exams_delete ON public.exams FOR DELETE TO authenticated
  USING ((SELECT public.is_writer()));

-- Candidates: staff read all, members their own; writers maintain
CREATE POLICY exam_candidates_read ON public.exam_candidates FOR SELECT TO authenticated
  USING ((SELECT public.is_staff()));
CREATE POLICY exam_candidates_read_own ON public.exam_candidates FOR SELECT TO authenticated
  USING (member_id IN (SELECT public.my_member_ids()));
CREATE POLICY exam_candidates_insert ON public.exam_candidates FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_writer()));
CREATE POLICY exam_candidates_update ON public.exam_candidates FOR UPDATE TO authenticated
  USING ((SELECT public.is_writer())) WITH CHECK ((SELECT public.is_writer()));
CREATE POLICY exam_candidates_delete ON public.exam_candidates FOR DELETE TO authenticated
  USING ((SELECT public.is_writer()));

-- Examiners: writers take a candidate on or hand it back; admins may remove anyone
CREATE POLICY exam_examiners_read ON public.exam_examiners FOR SELECT TO authenticated
  USING ((SELECT public.is_staff()));
CREATE POLICY exam_examiners_read_own ON public.exam_examiners FOR SELECT TO authenticated
  USING (candidate_id IN (
    SELECT c.id FROM public.exam_candidates c
    WHERE c.member_id IN (SELECT public.my_member_ids()) AND c.result IS NOT NULL
  ));
CREATE POLICY exam_examiners_insert ON public.exam_examiners FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_writer()) AND user_id = (SELECT auth.uid()));
CREATE POLICY exam_examiners_delete ON public.exam_examiners FOR DELETE TO authenticated
  USING (
    (SELECT public.is_writer())
    AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
  );

-- Scores: members see their own sheet once the result is in; a finished
-- sheet is locked until a writer reopens it (result back to null)
CREATE POLICY exam_scores_read ON public.exam_scores FOR SELECT TO authenticated
  USING ((SELECT public.is_staff()));
CREATE POLICY exam_scores_read_own ON public.exam_scores FOR SELECT TO authenticated
  USING (candidate_id IN (
    SELECT c.id FROM public.exam_candidates c
    WHERE c.member_id IN (SELECT public.my_member_ids()) AND c.result IS NOT NULL
  ));
CREATE POLICY exam_scores_insert ON public.exam_scores FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_writer())
    AND EXISTS (SELECT 1 FROM public.exam_candidates c WHERE c.id = candidate_id AND c.result IS NULL)
  );
CREATE POLICY exam_scores_update ON public.exam_scores FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_writer())
    AND EXISTS (SELECT 1 FROM public.exam_candidates c WHERE c.id = candidate_id AND c.result IS NULL)
  )
  WITH CHECK ((SELECT public.is_writer()));
CREATE POLICY exam_scores_delete ON public.exam_scores FOR DELETE TO authenticated
  USING (
    (SELECT public.is_writer())
    AND EXISTS (SELECT 1 FROM public.exam_candidates c WHERE c.id = candidate_id AND c.result IS NULL)
  );

-- ---------------------------------------------------------------------------
-- 6. Privileges
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.exam_programs, public.exams, public.exam_candidates,
  public.exam_examiners, public.exam_scores FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_programs, public.exams,
  public.exam_candidates, public.exam_examiners, public.exam_scores TO authenticated;
GRANT ALL ON public.exam_programs, public.exams, public.exam_candidates,
  public.exam_examiners, public.exam_scores TO service_role;

REVOKE EXECUTE ON FUNCTION public.sync_exam_candidate_result() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.remove_exam_candidate_grade() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.register_for_exam(bigint, integer, text, integer, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.withdraw_exam_registration(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_for_exam(bigint, integer, text, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.withdraw_exam_registration(bigint) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Judo programs, transcribed from the TK's exam sheets (Halbgelb to Braun)
-- ---------------------------------------------------------------------------
INSERT INTO public.exam_programs (section, grade, title, min_points, parts) VALUES
  ('Judo', '5.5 Kyu', 'Halbgelbgurt', 31,
   '[
    {"key": "nage", "title": "Nage-waza", "subtitle": "Wurftechniken", "minPoints": 9, "items": [
      {"key": "nage-1", "name": "O-soto-gari", "sides": 2, "description": "Grosse Aussensichel"},
      {"key": "nage-2", "name": "Hiza-guruma", "sides": 2, "description": "Knie Rad"},
      {"key": "nage-3", "name": "Uki-goshi", "sides": 2, "description": "Flatternde Hüfte / Hüftschwung"}
    ]},
    {"key": "ukemi", "title": "Ukemi", "subtitle": "Fallschule", "items": [
      {"key": "ukemi-1", "name": "Ushiro-ukemi", "sides": 2, "description": "Fall rückwärts"},
      {"key": "ukemi-2", "name": "Yoko-ukemi", "sides": 2, "description": "Fall seitwärts"},
      {"key": "ukemi-3", "name": "Mae-mawari-ukemi", "sides": 2, "description": "Fall vorwärts (mit Liegenbleiben)"}
    ]},
    {"key": "katame", "title": "Katame-waza", "subtitle": "Kontrolltechniken", "minPoints": 3, "items": [
      {"key": "katame-1", "name": "Kuzure-kesa-gatame", "sides": 1, "description": "Variante des Schärpen-Haltegriffs"},
      {"key": "katame-2", "name": "Yoko-shiho-gatame", "sides": 1, "description": "Seitvierer"}
    ]},
    {"key": "boden", "title": "Bewegungsaufgaben Boden", "items": [
      {"key": "boden-1", "name": "Befreiung aus Kuzure-kesa-gatame", "sides": 1},
      {"key": "boden-2", "name": "Befreiung aus Yoko-shiho-gatame", "sides": 1},
      {"key": "boden-3", "name": "Randoristart auf den Knien", "sides": 1, "description": "Wie beginnst du den Bodenkampf?"},
      {"key": "boden-4", "name": "Drehung aus Bankposition", "sides": 1},
      {"key": "boden-5", "name": "Drehung aus Bauchlage", "sides": 1}
    ]},
    {"key": "stand", "title": "Bewegungsaufgaben Stand", "items": [
      {"key": "stand-1", "name": "Thema Tokui-waza", "sides": 1, "description": "Lieblingstechnik zeigen"}
    ]},
    {"key": "theorie", "title": "Theorie", "items": [
      {"key": "theorie-1", "name": "Thema Ippon", "sides": 1}
    ]}
  ]'::jsonb),
  ('Judo', '5. Kyu', 'Gelbgurt', 49,
   '[
    {"key": "nage", "title": "Nage-waza", "subtitle": "Wurftechniken", "minPoints": 19, "items": [
      {"key": "nage-1", "name": "O-soto-gari", "sides": 2, "description": "Grosse Aussensichel"},
      {"key": "nage-2", "name": "Hiza-guruma", "sides": 2, "description": "Knie Rad"},
      {"key": "nage-3", "name": "Uki-goshi", "sides": 2, "description": "Flatternde Hüfte / Hüftschwung"},
      {"key": "nage-4", "name": "O-uchi-gari", "sides": 2, "description": "Grosse Innensichel"},
      {"key": "nage-5", "name": "Ko-uchi-gari", "sides": 2, "description": "Kleine Innensichel"},
      {"key": "nage-6", "name": "Tai-otoshi", "sides": 2, "description": "Körpersturz"}
    ]},
    {"key": "ukemi", "title": "Ukemi", "subtitle": "Fallschule", "items": [
      {"key": "ukemi-1", "name": "Ushiro-ukemi", "sides": 2, "description": "Fall rückwärts"},
      {"key": "ukemi-2", "name": "Yoko-ukemi", "sides": 2, "description": "Fall seitwärts"},
      {"key": "ukemi-3", "name": "Mae-mawari-ukemi", "sides": 2, "description": "Fall vorwärts (mit Liegenbleiben)"}
    ]},
    {"key": "katame", "title": "Katame-waza", "subtitle": "Kontrolltechniken", "minPoints": 6, "items": [
      {"key": "katame-1", "name": "Kuzure-kesa-gatame", "sides": 1, "description": "Variante des Schärpen-Haltegriffs"},
      {"key": "katame-2", "name": "Yoko-shiho-gatame", "sides": 1, "description": "Seitvierer"},
      {"key": "katame-3", "name": "Tate-shiho-gatame", "sides": 1, "description": "Reitvierer"},
      {"key": "katame-4", "name": "Kami-shiho-gatame", "sides": 1, "description": "Kopfvierer / vom Kopf her festhalten"}
    ]},
    {"key": "boden", "title": "Bewegungsaufgaben Boden", "items": [
      {"key": "boden-1", "name": "Befreiung aus Kuzure-kesa-gatame", "sides": 1},
      {"key": "boden-2", "name": "Befreiung aus Yoko-shiho-gatame", "sides": 1},
      {"key": "boden-3", "name": "Befreiung aus Tate-shiho-gatame", "sides": 1},
      {"key": "boden-4", "name": "Befreiung aus Kami-shiho-gatame", "sides": 1},
      {"key": "boden-5", "name": "Befreiung aus Zangenlage", "sides": 1, "description": "Tori zwischen den Beinen von Uke"},
      {"key": "boden-6", "name": "Randoristart auf den Knien", "sides": 1, "description": "Wie beginnst du den Bodenkampf?"},
      {"key": "boden-7", "name": "Drehung aus Bankposition", "sides": 1},
      {"key": "boden-8", "name": "Drehung aus Bauchlage", "sides": 1}
    ]},
    {"key": "stand", "title": "Bewegungsaufgaben Stand", "items": [
      {"key": "stand-1", "name": "Zeigen von Yakusoku-geiko (Stand)", "sides": 1},
      {"key": "stand-2", "name": "Thema Tokui-waza", "sides": 1, "description": "Lieblingstechnik zeigen"}
    ]},
    {"key": "theorie", "title": "Theorie", "items": [
      {"key": "theorie-1", "name": "Thema Ippon", "sides": 1}
    ]}
  ]'::jsonb),
  ('Judo', '4.5 Kyu', 'Halborangegurt', 43,
   '[
    {"key": "nage", "title": "Nage-waza", "subtitle": "Wurftechniken", "minPoints": 9, "items": [
      {"key": "nage-1", "name": "Ko-soto-gari", "sides": 2, "description": "Kleine Aussensichel"},
      {"key": "nage-2", "name": "O-goshi", "sides": 2, "description": "Grosse Hüfte"},
      {"key": "nage-3", "name": "Ippon-seoi-nage", "sides": 2, "description": "Punkt-Schulterwurf"}
    ]},
    {"key": "ukemi", "title": "Ukemi", "subtitle": "Fallschule", "items": [
      {"key": "ukemi-1", "name": "Ushiro-ukemi", "sides": 2, "description": "Fall rückwärts (über ein Hindernis)"},
      {"key": "ukemi-2", "name": "Yoko-ukemi", "sides": 2, "description": "Fall seitwärts (an Uke)"},
      {"key": "ukemi-3", "name": "Mae-mawari-ukemi", "sides": 2, "description": "Fall vorwärts (über ein Hindernis mit Liegenbleiben)"}
    ]},
    {"key": "katame", "title": "Katame-waza", "subtitle": "Kontrolltechniken", "minPoints": 3, "items": [
      {"key": "katame-1", "name": "Kuzure-kami-shiho-gatame", "sides": 1, "description": "Varianten des Kopfvierers / vom Kopf her festhalten"},
      {"key": "katame-2", "name": "Hon-kesa-gatame", "sides": 1, "description": "Grundform des Schärpen-Haltegriffs"}
    ]},
    {"key": "boden", "title": "Bewegungsaufgaben Boden", "items": [
      {"key": "boden-1", "name": "Befreiung aus Kuzure-kami-shiho-gatame", "sides": 1, "description": "1 Variante"},
      {"key": "boden-2", "name": "Haltegriffwechsel", "sides": 1, "description": "Kombination der Festhaltegriffe"},
      {"key": "boden-3", "name": "Befreiung aus Kami-shiho-gatame", "sides": 1},
      {"key": "boden-4", "name": "Befreiung aus Zangenlage", "sides": 1, "description": "Tori zwischen den Beinen von Uke"},
      {"key": "boden-5", "name": "Drehung aus Bauchlage oder Bankposition", "sides": 1}
    ]},
    {"key": "stand", "title": "Bewegungsaufgaben Stand", "items": [
      {"key": "stand-1", "name": "Renraku-waza (Kombinationstechnik)", "sides": 1, "description": "Bei Ausweichen des Uke"},
      {"key": "stand-2", "name": "Übergang in die Bodenlage", "sides": 1, "description": "Mit Wurf aus dem Halborangegurt-Programm"},
      {"key": "stand-3", "name": "Zeigen von Yakusoku-geiko (Stand)", "sides": 1, "description": "ca. 1 Minute"}
    ]},
    {"key": "stichproben", "title": "Stichproben", "items": [
      {"key": "stichproben-1", "name": "Uki-goshi", "sides": 1, "description": "Hüftschwung"},
      {"key": "stichproben-2", "name": "Hiza-guruma", "sides": 1, "description": "Knierad"},
      {"key": "stichproben-3", "name": "Ko-uchi-gari", "sides": 1, "description": "Kleine Innensichel"},
      {"key": "stichproben-4", "name": "Tai-otoshi", "sides": 1, "description": "Körpersturz"}
    ]},
    {"key": "theorie", "title": "Theorie", "items": [
      {"key": "theorie-1", "name": "Thema Kampf- / Turnierwesen", "sides": 1, "description": "Waza-ari, Ippon, Mate, Osae-komi, Toketa, Hajime, Shido, Hansoku-make"},
      {"key": "theorie-2", "name": "Was bedeutet «Kuzure»?", "sides": 1},
      {"key": "theorie-3", "name": "Sinn und Zweck der Fallschule", "sides": 1, "description": "Was ist bei der Fallschule zu beachten (Grundsätzliches)?"}
    ]}
  ]'::jsonb),
  ('Judo', '4. Kyu', 'Orangegurt', 69,
   '[
    {"key": "nage", "title": "Nage-waza", "subtitle": "Wurftechniken", "minPoints": 25, "items": [
      {"key": "nage-1", "name": "Ko-soto-gari", "sides": 2, "description": "Kleine Aussensichel"},
      {"key": "nage-2", "name": "Ko-soto-gake", "sides": 2, "description": "Kleines äusseres Hacken"},
      {"key": "nage-3", "name": "O-goshi", "sides": 2, "description": "Grosse Hüfte / Grosser Hüftwurf"},
      {"key": "nage-4", "name": "Ippon-seoi-nage", "sides": 2, "description": "Punkt-Schulterwurf"},
      {"key": "nage-5", "name": "De-ashi-barai", "sides": 2, "description": "Fussfegen, den vorkommenden Fuss fegen / wischen"},
      {"key": "nage-6", "name": "Okuri-ashi-barai", "sides": 2, "description": "Beide Beine fegen, Fussnachfegen"},
      {"key": "nage-7", "name": "Tsuri-komi-goshi", "sides": 2, "description": "Hebezughüftwurf"},
      {"key": "nage-8", "name": "Harai-goshi", "sides": 2, "description": "Hüftfegen"}
    ]},
    {"key": "ukemi", "title": "Ukemi", "subtitle": "Fallschule", "items": [
      {"key": "ukemi-1", "name": "Ushiro-ukemi", "sides": 2, "description": "Fall rückwärts (über ein Hindernis)"},
      {"key": "ukemi-2", "name": "Yoko-ukemi", "sides": 2, "description": "Fall seitwärts (an Uke)"},
      {"key": "ukemi-3", "name": "Mae-mawari-ukemi", "sides": 2, "description": "Fall vorwärts (über ein Hindernis mit Liegenbleiben)"}
    ]},
    {"key": "katame", "title": "Katame-waza", "subtitle": "Kontrolltechniken", "minPoints": 6, "items": [
      {"key": "katame-1", "name": "Kuzure-kami-shiho-gatame", "sides": 1, "description": "Varianten des Kopfvierers / vom Kopf her festhalten"},
      {"key": "katame-2", "name": "Hon-kesa-gatame", "sides": 1, "description": "Grundform des Schärpen-Haltegriffs"},
      {"key": "katame-3", "name": "Kata-gatame", "sides": 1, "description": "Schulterhaltegriff"},
      {"key": "katame-4", "name": "Kuzure-kesa-gatame", "sides": 1, "description": "Variante des Schärpen-Haltegriffs (3 Varianten)"}
    ]},
    {"key": "boden", "title": "Bewegungsaufgaben Boden", "items": [
      {"key": "boden-1", "name": "Befreiung aus Kuzure-kami-shiho-gatame", "sides": 1, "description": "2 Varianten"},
      {"key": "boden-2", "name": "Befreiung aus Hon-kesa-gatame", "sides": 1},
      {"key": "boden-3", "name": "Befreiung aus Kata-gatame", "sides": 1},
      {"key": "boden-4", "name": "Befreiung aus Kuzure-kesa-gatame", "sides": 1},
      {"key": "boden-5", "name": "Befreiung aus Zangenlage", "sides": 1, "description": "Tori zwischen den Beinen von Uke"},
      {"key": "boden-6", "name": "Drehung aus Bankposition", "sides": 1},
      {"key": "boden-7", "name": "Drehung aus Bauchlage", "sides": 1}
    ]},
    {"key": "stand", "title": "Bewegungsaufgaben Stand", "items": [
      {"key": "stand-1", "name": "Übergang Stand-Boden", "sides": 1},
      {"key": "stand-2", "name": "Zeigen von Yakusoku-geiko (Stand)", "sides": 1},
      {"key": "stand-3", "name": "Kakari-geiko", "sides": 1, "description": "Uke weicht mehrmals aus → Kombination"},
      {"key": "stand-4", "name": "Renraku-waza zur Tokui-waza", "sides": 1, "description": "Kombination zur Lieblings- / Spezialtechnik"}
    ]},
    {"key": "stichproben", "title": "Stichproben", "subtitle": "aus dem 5. Kyu", "items": [
      {"key": "stichproben-1", "name": "O-soto-gari", "sides": 1, "description": "Grosse Aussensichel"},
      {"key": "stichproben-2", "name": "Uki-goshi", "sides": 1, "description": "Flatternde Hüfte"},
      {"key": "stichproben-3", "name": "Tai-otoshi", "sides": 1, "description": "Körper fallen lassen, Körpersturz"},
      {"key": "stichproben-4", "name": "Yoko-shiho-gatame", "sides": 1, "description": "Seitlicher Haltegriff, Seitvierer"},
      {"key": "stichproben-5", "name": "Tate-shiho-gatame", "sides": 1, "description": "Reitvierer"}
    ]},
    {"key": "theorie", "title": "Theorie", "items": [
      {"key": "theorie-1", "name": "Thema Kampf- / Turnierwesen", "sides": 1, "description": "Waza-ari, Ippon, Mate, Osae-komi, Toketa, Hajime, Shido, Hansoku-make"},
      {"key": "theorie-2", "name": "Was bedeutet «Kuzure»?", "sides": 1},
      {"key": "theorie-3", "name": "Unterschiede zwischen Uki-goshi und O-goshi?", "sides": 1},
      {"key": "theorie-4", "name": "Sinn und Zweck der Fallschule", "sides": 1, "description": "Was ist bei der Fallschule zu beachten (Grundsätzliches)?"}
    ]}
  ]'::jsonb),
  ('Judo', '3.5 Kyu', 'Halbgrüngurt', 78,
   '[
    {"key": "nage", "title": "Nage-waza", "subtitle": "Wurftechniken", "minPoints": 12, "items": [
      {"key": "nage-1", "name": "Sasae-tsuri-komi-ashi", "sides": 2, "description": "Fussstoppwurf"},
      {"key": "nage-2", "name": "Morote-seoi-nage", "sides": 2, "description": "Beidhändiger Schulterwurf"},
      {"key": "nage-3", "name": "Uchi-mata", "sides": 2, "description": "Innerer Schenkelwurf"},
      {"key": "nage-4", "name": "Ko-uchi-makikomi", "sides": 2, "description": "Kleines inneres Mitfallen"}
    ]},
    {"key": "ukemi", "title": "Ukemi", "subtitle": "Fallschule", "items": [
      {"key": "ukemi-1", "name": "Ushiro-ukemi", "sides": 2, "description": "Fall rückwärts (über ein Hindernis)"},
      {"key": "ukemi-2", "name": "Yoko-ukemi", "sides": 2, "description": "Fall seitwärts (an Uke)"},
      {"key": "ukemi-3", "name": "Mae-mawari-ukemi", "sides": 2, "description": "Fall vorwärts (über ein Hindernis mit Aufstehen)"},
      {"key": "ukemi-4", "name": "Mae-mawari-ukemi", "sides": 2, "description": "Fall vorwärts an Uke"}
    ]},
    {"key": "katame", "title": "Katame-waza", "subtitle": "Kontrolltechniken", "minPoints": 9, "items": [
      {"key": "katame-1", "name": "Yoko-shiho-gatame, Var. 1", "sides": 1, "description": "Seitliche 4-Punkt-Kontrolle"},
      {"key": "katame-2", "name": "Yoko-shiho-gatame, Var. 2", "sides": 1, "description": "Seitliche 4-Punkt-Kontrolle"},
      {"key": "katame-3", "name": "Yoko-shiho-gatame, Var. 3", "sides": 1, "description": "Seitliche 4-Punkt-Kontrolle"},
      {"key": "katame-4", "name": "Kuzure-kami-shiho-gatame, Var. 1", "sides": 1, "description": "Obere 4-Punkt-Kontrolle"},
      {"key": "katame-5", "name": "Kuzure-kami-shiho-gatame, Var. 2", "sides": 1, "description": "Obere 4-Punkt-Kontrolle"},
      {"key": "katame-6", "name": "Kuzure-kami-shiho-gatame, Var. 3", "sides": 1, "description": "Obere 4-Punkt-Kontrolle"}
    ]},
    {"key": "boden", "title": "Bewegungsaufgaben Boden", "items": [
      {"key": "boden-1", "name": "Befreiung aus Kuzure-kami-shiho-gatame", "sides": 1},
      {"key": "boden-2", "name": "Befreiung aus Hon-kesa-gatame", "sides": 1},
      {"key": "boden-3", "name": "Befreiung aus Kuzure-kesa-gatame", "sides": 1},
      {"key": "boden-4", "name": "Befreiung aus Yoko-shiho-gatame", "sides": 1, "description": "2 Varianten"},
      {"key": "boden-5", "name": "Befreiung aus Tate-shiho-gatame", "sides": 1, "description": "2 Varianten"},
      {"key": "boden-6", "name": "Befreiung aus Zangenlage", "sides": 1, "description": "Tori zwischen den Beinen von Uke"},
      {"key": "boden-7", "name": "Drehung aus Bankposition", "sides": 1, "description": "2 Varianten"},
      {"key": "boden-8", "name": "Drehung aus Bauchlage", "sides": 1, "description": "2 Varianten"},
      {"key": "boden-9", "name": "Zeigen eines Randoris im Boden", "sides": 1}
    ]},
    {"key": "stand", "title": "Bewegungsaufgaben Stand", "items": [
      {"key": "stand-1", "name": "Shiai", "sides": 1, "description": "Internes Turnier, z.B. Chlausturnier"},
      {"key": "stand-2", "name": "Zeigen von Yakusoku-geiko (Stand)", "sides": 1},
      {"key": "stand-3", "name": "Übergang Stand-Boden", "sides": 1, "description": "2 Varianten"},
      {"key": "stand-4", "name": "Thema Tokui-waza", "sides": 1, "description": "Renraku-waza, Gegentechnik"},
      {"key": "stand-5", "name": "Zeigen eines Randoris im Stand", "sides": 1}
    ]},
    {"key": "stichproben", "title": "Stichproben", "items": [
      {"key": "stichproben-1", "name": "O-soto-gari", "sides": 1, "description": "Grosse Aussensichel"},
      {"key": "stichproben-2", "name": "Uki-goshi", "sides": 1, "description": "Flatternde Hüfte"},
      {"key": "stichproben-3", "name": "Ko-soto-gari", "sides": 1, "description": "Kleines äusseres Sicheln / Kleine Aussensichel"},
      {"key": "stichproben-4", "name": "Ippon-seoi-nage", "sides": 1, "description": "Punkt-Schulterwurf"},
      {"key": "stichproben-5", "name": "Harai-goshi", "sides": 1, "description": "Hüfte fegen"},
      {"key": "stichproben-6", "name": "De-ashi-barai", "sides": 1, "description": "Wegwischen des nachgezogenen Fusses"},
      {"key": "stichproben-7", "name": "Tai-otoshi", "sides": 1, "description": "Körper fallen lassen"},
      {"key": "stichproben-8", "name": "Tate-shiho-gatame", "sides": 1, "description": "Längsweise 4-Punkt-Kontrolle"},
      {"key": "stichproben-9", "name": "Kami-shiho-gatame", "sides": 1, "description": "Obere 4-Punkt-Kontrolle"}
    ]},
    {"key": "theorie", "title": "Theorie", "items": [
      {"key": "theorie-1", "name": "Thema Kampf- / Turnierwesen", "sides": 1, "description": "Waza-ari, Ippon, Mate, Osae-komi, Toketa, Hajime, Shido, Hansoku-make"},
      {"key": "theorie-2", "name": "Unterschied zwischen Gake und Gari", "sides": 1},
      {"key": "theorie-3", "name": "Was weisst du über Kansetsu-waza?", "sides": 1},
      {"key": "theorie-4", "name": "Wie wird «aufgegeben» bei einer Hebeltechnik?", "sides": 1},
      {"key": "theorie-5", "name": "Unterschied zwischen Randori und Shiai", "sides": 1},
      {"key": "theorie-6", "name": "Erkläre …", "sides": 1, "description": "Was Judo ist · einem Newcomer Ushiro-ukemi · einem Newcomer die Dojoregeln · den Unterschied zwischen Randori und Shiai · wie Ippon erzielt werden kann"},
      {"key": "theorie-7", "name": "Erkläre, wie am Turnier gewonnen wird", "sides": 1}
    ]}
  ]'::jsonb),
  ('Judo', '3. Kyu', 'Grüngurt', 88,
   '[
    {"key": "nage", "title": "Nage-waza", "subtitle": "Wurftechniken", "minPoints": 25, "items": [
      {"key": "nage-1", "name": "Sasae-tsuri-komi-ashi", "sides": 2, "description": "Fussstoppwurf"},
      {"key": "nage-2", "name": "Morote-seoi-nage", "sides": 2, "description": "Beidhändiger Schulterwurf"},
      {"key": "nage-3", "name": "Uchi-mata", "sides": 2, "description": "Innerer Schenkelwurf"},
      {"key": "nage-4", "name": "Ko-uchi-makikomi", "sides": 2, "description": "Kleines inneres Mitfallen"},
      {"key": "nage-5", "name": "Tomoe-nage", "sides": 2, "description": "Kreisumwurf"},
      {"key": "nage-6", "name": "Yoko-otoshi", "sides": 2, "description": "Seitliches Fallenlassen"},
      {"key": "nage-7", "name": "Tani-otoshi", "sides": 2, "description": "Talfallzug"},
      {"key": "nage-8", "name": "Seoi-otoshi", "sides": 2, "description": "Schulter-Fallenlassen"}
    ]},
    {"key": "ukemi", "title": "Ukemi", "subtitle": "Fallschule", "items": [
      {"key": "ukemi-1", "name": "Ushiro-ukemi", "sides": 2, "description": "Fall rückwärts (über ein Hindernis)"},
      {"key": "ukemi-2", "name": "Yoko-ukemi", "sides": 2, "description": "Fall seitwärts (an Uke)"},
      {"key": "ukemi-3", "name": "Mae-mawari-ukemi", "sides": 2, "description": "Fall vorwärts (über ein Hindernis mit Aufstehen)"},
      {"key": "ukemi-4", "name": "Mae-mawari-ukemi", "sides": 2, "description": "Fall vorwärts an Uke"}
    ]},
    {"key": "katame", "title": "Katame-waza", "subtitle": "Kontrolltechniken", "minPoints": 9, "items": [
      {"key": "katame-1", "name": "Yoko-shiho-gatame, Var. 1", "sides": 1, "description": "Seitliche 4-Punkt-Kontrolle"},
      {"key": "katame-2", "name": "Yoko-shiho-gatame, Var. 2", "sides": 1, "description": "Seitliche 4-Punkt-Kontrolle"},
      {"key": "katame-3", "name": "Kuzure-kami-shiho-gatame, Var. 1", "sides": 1, "description": "Obere 4-Punkt-Kontrolle"},
      {"key": "katame-4", "name": "Kuzure-kami-shiho-gatame, Var. 2", "sides": 1, "description": "Obere 4-Punkt-Kontrolle"},
      {"key": "katame-5", "name": "Tate-shiho-gatame, Var. 1", "sides": 1, "description": "Längsweise 4-Punkt-Kontrolle"},
      {"key": "katame-6", "name": "Tate-shiho-gatame, Var. 2", "sides": 1, "description": "Längsweise 4-Punkt-Kontrolle"}
    ]},
    {"key": "kansetsu", "title": "Kansetsu-waza", "subtitle": "Hebeltechniken", "items": [
      {"key": "kansetsu-1", "name": "Ude-hishigi-juji-gatame", "sides": 1, "description": "Armdrücken durch Kreuzhebel"}
    ]},
    {"key": "boden", "title": "Bewegungsaufgaben Boden", "items": [
      {"key": "boden-1", "name": "Befreiung aus Kuzure-kami-shiho-gatame", "sides": 1},
      {"key": "boden-2", "name": "Befreiung aus Hon-kesa-gatame", "sides": 1},
      {"key": "boden-3", "name": "Befreiung aus Kuzure-kesa-gatame", "sides": 1},
      {"key": "boden-4", "name": "Befreiung aus Yoko-shiho-gatame", "sides": 1},
      {"key": "boden-5", "name": "Befreiung aus Tate-shiho-gatame", "sides": 1},
      {"key": "boden-6", "name": "Befreiung aus Zangenlage", "sides": 1, "description": "Tori zwischen den Beinen von Uke"},
      {"key": "boden-7", "name": "Drehung aus Bankposition", "sides": 1, "description": "2 Varianten"},
      {"key": "boden-8", "name": "Drehung aus Bauchlage", "sides": 1, "description": "2 Varianten"},
      {"key": "boden-9", "name": "Zeigen eines Randoris im Boden", "sides": 1}
    ]},
    {"key": "stand", "title": "Bewegungsaufgaben Stand", "items": [
      {"key": "stand-1", "name": "Zeigen von Yakusoku-geiko (Stand)", "sides": 1},
      {"key": "stand-2", "name": "Übergang Stand-Boden", "sides": 1, "description": "2 Varianten"},
      {"key": "stand-3", "name": "Thema Tokui-waza", "sides": 1, "description": "Renraku-waza, Gegentechnik"},
      {"key": "stand-4", "name": "Grifflösen am Ärmel", "sides": 1, "description": "Mit Wurfabschluss"},
      {"key": "stand-5", "name": "Grifflösen am Nacken", "sides": 1, "description": "Mit Wurfabschluss"}
    ]},
    {"key": "stichproben", "title": "Stichproben", "items": [
      {"key": "stichproben-1", "name": "Hiza-guruma", "sides": 1, "description": "Knierad"},
      {"key": "stichproben-2", "name": "O-uchi-gari", "sides": 1, "description": "Grosses inneres Wegfegen"},
      {"key": "stichproben-3", "name": "O-goshi", "sides": 1, "description": "Grosse Hüfte"},
      {"key": "stichproben-4", "name": "Tsuri-komi-goshi", "sides": 1, "description": "Angehobene Hüfte mit Ziehen"},
      {"key": "stichproben-5", "name": "Okuri-ashi-barai", "sides": 1, "description": "Wegwischen beider Füsse"},
      {"key": "stichproben-6", "name": "Kata-gatame", "sides": 1, "description": "Schulterkontrolle"},
      {"key": "stichproben-7", "name": "Kami-shiho-gatame", "sides": 1, "description": "Obere 4-Punkt-Kontrolle"}
    ]},
    {"key": "theorie", "title": "Theorie", "items": [
      {"key": "theorie-1", "name": "Thema Kampf- / Turnierwesen", "sides": 1, "description": "Waza-ari, Ippon, Mate, Osae-komi, Toketa, Hajime, Shido, Hansoku-make"},
      {"key": "theorie-2", "name": "Unterschied zwischen Gake und Gari", "sides": 1},
      {"key": "theorie-3", "name": "Was weisst du über Kansetsu-waza?", "sides": 1},
      {"key": "theorie-4", "name": "Wie wird «aufgegeben» bei einer Hebeltechnik?", "sides": 1},
      {"key": "theorie-5", "name": "Unterschied zwischen Randori und Shiai", "sides": 1},
      {"key": "theorie-6", "name": "Erkläre …", "sides": 1, "description": "Was Judo ist · einem Newcomer Ushiro-ukemi · einem Newcomer die Dojoregeln · den Unterschied zwischen Randori und Shiai · wie Ippon erzielt werden kann"},
      {"key": "theorie-7", "name": "Erkläre, wie am Turnier gewonnen wird", "sides": 1}
    ]}
  ]'::jsonb),
  ('Judo', '2. Kyu', 'Blaugurt', 105,
   '[
    {"key": "nage", "title": "Nage-waza", "subtitle": "Wurftechniken", "minPoints": 28, "items": [
      {"key": "nage-1", "name": "Hane-goshi", "sides": 2, "description": "Hüftspringwurf / Angesprungene Hüfte"},
      {"key": "nage-2", "name": "Ashi-guruma", "sides": 2, "description": "Fussrad"},
      {"key": "nage-3", "name": "O-guruma", "sides": 2, "description": "Grosses Rad"},
      {"key": "nage-4", "name": "Sukui-nage", "sides": 2, "description": "Schaufelwurf"},
      {"key": "nage-5", "name": "Te-guruma", "sides": 2, "description": "Handrad"},
      {"key": "nage-6", "name": "Ushiro-goshi", "sides": 2, "description": "Hüftgegenwurf"},
      {"key": "nage-7", "name": "Utsuri-goshi", "sides": 2, "description": "Wechselhüftwurf"},
      {"key": "nage-8", "name": "Morote-gari", "sides": 2, "description": "Beidhändiges Sicheln"},
      {"key": "nage-9", "name": "Kuchiki-daoshi", "sides": 2, "description": "Einen morschen Baum umdrücken"}
    ]},
    {"key": "ukemi", "title": "Ukemi", "subtitle": "Fallschule", "items": [
      {"key": "ukemi-1", "name": "Ushiro-ukemi", "sides": 2, "description": "Fall rückwärts (über ein Hindernis)"},
      {"key": "ukemi-2", "name": "Yoko-ukemi", "sides": 2, "description": "Fall seitwärts (an Uke)"},
      {"key": "ukemi-3", "name": "Mae-mawari-ukemi", "sides": 2, "description": "Fall vorwärts (über ein Hindernis mit Aufstehen)"},
      {"key": "ukemi-4", "name": "Freier Fall auf eine Seite", "sides": 1}
    ]},
    {"key": "katame", "title": "Katame-waza", "subtitle": "Kontrolltechniken", "minPoints": 6, "items": [
      {"key": "katame-1", "name": "Ude-garami", "sides": 1, "description": "Armbeugehebel"},
      {"key": "katame-2", "name": "Ude-hishigi-waki-gatame", "sides": 1, "description": "Hebeln mit der Körperseite"},
      {"key": "katame-3", "name": "Juji-jime (Nami-, Kata- und Gyaku-)", "sides": 1, "description": "Kreuzwürger"},
      {"key": "katame-4", "name": "Okuri-eri-jime", "sides": 1, "description": "Beidhändiges Kragenwürgen"}
    ]},
    {"key": "boden", "title": "Bewegungsaufgaben Boden", "items": [
      {"key": "boden-1", "name": "Befreiung aus Kuzure-kami-shiho-gatame", "sides": 1},
      {"key": "boden-2", "name": "Befreiung aus Hon-kesa-gatame", "sides": 1},
      {"key": "boden-3", "name": "Befreiung aus Kuzure-kesa-gatame", "sides": 1},
      {"key": "boden-4", "name": "Befreiung aus Yoko-shiho-gatame", "sides": 1},
      {"key": "boden-5", "name": "Befreiung aus Tate-shiho-gatame", "sides": 1},
      {"key": "boden-6", "name": "Befreiung aus Zangenlage", "sides": 1, "description": "Tori zwischen den Beinen von Uke"},
      {"key": "boden-7", "name": "Drehung aus Bankposition", "sides": 1, "description": "2 Varianten"},
      {"key": "boden-8", "name": "Drehung aus Bauchlage", "sides": 1, "description": "2 Varianten"},
      {"key": "boden-9", "name": "Haltegriffwechsel", "sides": 1, "description": "Kombination der Festhaltegriffe"},
      {"key": "boden-10", "name": "Zeigen eines Randoris im Boden", "sides": 1}
    ]},
    {"key": "stand", "title": "Bewegungsaufgaben Stand", "items": [
      {"key": "stand-1", "name": "Tokui-waza", "sides": 1, "description": "Vorwärts, rückwärts, seitlich rechts, seitlich links"},
      {"key": "stand-2", "name": "Tokui-waza gegen einen Rechtskämpfer", "sides": 1},
      {"key": "stand-3", "name": "Tokui-waza gegen einen Linkskämpfer", "sides": 1},
      {"key": "stand-4", "name": "Tokui-waza gegen einen sperrenden Kämpfer", "sides": 1},
      {"key": "stand-5", "name": "Tokui-waza gegen einen gebeugten Kämpfer", "sides": 1},
      {"key": "stand-6", "name": "Renraku-waza einmal Start mit der Tokui-waza", "sides": 1},
      {"key": "stand-7", "name": "Renraku-waza einmal mit Ende der Tokui-waza", "sides": 1},
      {"key": "stand-8", "name": "Übergang in die Bodenlage mit der Tokui-waza", "sides": 1},
      {"key": "stand-9", "name": "Nage-no-kata: Wurf 1", "sides": 1, "description": "Eine Gruppe, Tori und Uke"},
      {"key": "stand-10", "name": "Nage-no-kata: Wurf 2", "sides": 1, "description": "Eine Gruppe, Tori und Uke"},
      {"key": "stand-11", "name": "Nage-no-kata: Wurf 3", "sides": 1, "description": "Eine Gruppe, Tori und Uke"},
      {"key": "stand-12", "name": "Zeigen von Yakusoku-geiko (Stand)", "sides": 1},
      {"key": "stand-13", "name": "Kakari-geiko", "sides": 1, "description": "Uke weicht mehrmals aus → Kombination"},
      {"key": "stand-14", "name": "Übergang Stand-Boden", "sides": 1, "description": "2 Varianten"}
    ]},
    {"key": "stichproben", "title": "Stichproben", "items": [
      {"key": "stichproben-1", "name": "O-soto-gari", "sides": 1, "description": "Grosse Aussensichel"},
      {"key": "stichproben-2", "name": "Uki-goshi", "sides": 1, "description": "Flatternde Hüfte"},
      {"key": "stichproben-3", "name": "Ko-soto-gari", "sides": 1, "description": "Kleine Aussensichel"},
      {"key": "stichproben-4", "name": "Ippon-seoi-nage", "sides": 1, "description": "Punkt-Schulterwurf"},
      {"key": "stichproben-5", "name": "Harai-goshi", "sides": 1, "description": "Hüfte fegen"},
      {"key": "stichproben-6", "name": "Uchi-mata", "sides": 1, "description": "Innerer Schenkelwurf"},
      {"key": "stichproben-7", "name": "Tani-otoshi", "sides": 1, "description": "Talfallzug / ins Tal stürzen"},
      {"key": "stichproben-8", "name": "Yoko-shiho-gatame", "sides": 1, "description": "Seitlicher Haltegriff, Seitvierer"},
      {"key": "stichproben-9", "name": "Ude-hishigi-juji-gatame", "sides": 1, "description": "Den Arm kreuzhebeln"},
      {"key": "stichproben-10", "name": "Tate-shiho-gatame", "sides": 1, "description": "Reitvierer"}
    ]},
    {"key": "theorie", "title": "Theorie", "items": [
      {"key": "theorie-1", "name": "Thema Kampf- / Turnierwesen", "sides": 1, "description": "Waza-ari, Ippon, Mate, Osae-komi, Toketa, Hajime, Shido, Hansoku-make"},
      {"key": "theorie-2", "name": "Unterschiede zwischen …", "sides": 1, "description": "Gake und Gari · oder Uki-goshi und O-goshi · oder De-ashi-barai und Okuri-ashi-barai · …"},
      {"key": "theorie-3", "name": "Was weisst du über Shime-waza?", "sides": 1},
      {"key": "theorie-4", "name": "Wie wird «aufgegeben» bei einer Hebeltechnik?", "sides": 1},
      {"key": "theorie-5", "name": "Unterschied zwischen Randori und Shiai", "sides": 1},
      {"key": "theorie-6", "name": "Erkläre einem Newcomer …", "sides": 1, "description": "Ushiro-ukemi · oder Yoko-ukemi · oder die Dojoregeln · …"},
      {"key": "theorie-7", "name": "Erkläre …", "sides": 1, "description": "Den Unterschied zwischen Randori und Shiai · oder wie Ippon erzielt werden kann · oder was du über Hebeltechniken im Judo weisst · …"}
    ]}
  ]'::jsonb),
  ('Judo', '1. Kyu', 'Braungurt', 117,
   '[
    {"key": "nage", "title": "Nage-waza", "subtitle": "Wurftechniken", "minPoints": 25, "items": [
      {"key": "nage-1", "name": "Soto-makikomi", "sides": 2, "description": "Äusseres Mitfallen"},
      {"key": "nage-2", "name": "Hane-makikomi", "sides": 2, "description": "Schnelles Einrollen"},
      {"key": "nage-3", "name": "Uki-waza", "sides": 2, "description": "Schwebewurf"},
      {"key": "nage-4", "name": "Sumi-gaeshi", "sides": 2, "description": "Eckenkippe"},
      {"key": "nage-5", "name": "Hikkomi-gaeshi", "sides": 2, "description": "Erlaubter Übergang zur Bodenlage"},
      {"key": "nage-6", "name": "Ura-nage", "sides": 2, "description": "Rückwurf, Wurf nach hinten"},
      {"key": "nage-7", "name": "Yoko-guruma", "sides": 2, "description": "Seitrad"},
      {"key": "nage-8", "name": "Kata-guruma", "sides": 2, "description": "Schulterrad"}
    ]},
    {"key": "ukemi", "title": "Ukemi", "subtitle": "Fallschule", "items": [
      {"key": "ukemi-1", "name": "Ushiro-ukemi", "sides": 2, "description": "Fall rückwärts (über ein Hindernis)"},
      {"key": "ukemi-2", "name": "Yoko-ukemi", "sides": 2, "description": "Fall seitwärts (an Uke)"},
      {"key": "ukemi-3", "name": "Mae-mawari-ukemi", "sides": 2, "description": "Fall vorwärts (über ein Hindernis mit Aufstehen)"},
      {"key": "ukemi-4", "name": "Freier Fall auf eine Seite", "sides": 1}
    ]},
    {"key": "katame", "title": "Katame-waza", "subtitle": "Kontrolltechniken", "minPoints": 9, "items": [
      {"key": "katame-1", "name": "Ude-hishigi-ude-gatame", "sides": 1, "description": "Den Arm durch Drücken auf den Ellenbogen hebeln"},
      {"key": "katame-2", "name": "Ude-hishigi-hiza-gatame", "sides": 1, "description": "Den Arm mit dem Knie hebeln"},
      {"key": "katame-3", "name": "Ude-hishigi-hara-gatame", "sides": 1, "description": "Den Arm mit Hilfe des Bauches hebeln"},
      {"key": "katame-4", "name": "Ude-hishigi-sankaku-gatame", "sides": 1, "description": "Den Arm mit den Beinen hebeln"},
      {"key": "katame-5", "name": "Sankaku-jime", "sides": 1, "description": "Würger mit den Beinen"},
      {"key": "katame-6", "name": "Hadaka-jime", "sides": 1, "description": "Freies, nacktes Würgen"}
    ]},
    {"key": "boden", "title": "Bewegungsaufgaben Boden", "items": [
      {"key": "boden-1", "name": "Befreiung aus Kuzure-kami-shiho-gatame", "sides": 1},
      {"key": "boden-2", "name": "Befreiung aus Hon-kesa-gatame", "sides": 1},
      {"key": "boden-3", "name": "Befreiung aus Kuzure-kesa-gatame", "sides": 1},
      {"key": "boden-4", "name": "Befreiung aus Yoko-shiho-gatame", "sides": 1},
      {"key": "boden-5", "name": "Befreiung aus Tate-shiho-gatame", "sides": 1},
      {"key": "boden-6", "name": "Befreiung aus Zangenlage", "sides": 1, "description": "Tori zwischen den Beinen von Uke"},
      {"key": "boden-7", "name": "Angriff aus Zangenlage", "sides": 1, "description": "Uke zwischen den Beinen von Tori"},
      {"key": "boden-8", "name": "Drehung aus Bankposition, Var. 1", "sides": 1},
      {"key": "boden-9", "name": "Drehung aus Bankposition, Var. 2", "sides": 1},
      {"key": "boden-10", "name": "Drehung aus Bankposition, Var. 3", "sides": 1},
      {"key": "boden-11", "name": "Drehung aus Bauchlage, Var. 1", "sides": 1},
      {"key": "boden-12", "name": "Drehung aus Bauchlage, Var. 2", "sides": 1},
      {"key": "boden-13", "name": "Drehung aus Bauchlage, Var. 3", "sides": 1}
    ]},
    {"key": "stand", "title": "Bewegungsaufgaben Stand", "items": [
      {"key": "stand-1", "name": "Tokui-waza", "sides": 1, "description": "Vorwärts, rückwärts, seitlich rechts, seitlich links"},
      {"key": "stand-2", "name": "Tokui-waza gegen einen Rechtskämpfer", "sides": 1},
      {"key": "stand-3", "name": "Tokui-waza gegen einen Linkskämpfer", "sides": 1},
      {"key": "stand-4", "name": "Tokui-waza gegen einen sperrenden Kämpfer", "sides": 1},
      {"key": "stand-5", "name": "Tokui-waza gegen einen gebeugten Kämpfer", "sides": 1},
      {"key": "stand-6", "name": "Renraku-waza einmal Start mit der Tokui-waza", "sides": 1},
      {"key": "stand-7", "name": "Renraku-waza einmal mit Ende der Tokui-waza", "sides": 1},
      {"key": "stand-8", "name": "Übergang in die Bodenlage mit der Tokui-waza", "sides": 1},
      {"key": "stand-9", "name": "Nage-no-kata: Wurfgruppe 1 (Tori)", "sides": 1},
      {"key": "stand-10", "name": "Nage-no-kata: Wurfgruppe 2 (Tori)", "sides": 1},
      {"key": "stand-11", "name": "Nage-no-kata: Wurfgruppe 3 (Tori)", "sides": 1},
      {"key": "stand-12", "name": "Nage-no-kata: Wurfgruppe 1 (Uke)", "sides": 1},
      {"key": "stand-13", "name": "Nage-no-kata: Wurfgruppe 2 (Uke)", "sides": 1},
      {"key": "stand-14", "name": "Nage-no-kata: Wurfgruppe 3 (Uke)", "sides": 1},
      {"key": "stand-15", "name": "Zeigen von Yakusoku-geiko (Stand)", "sides": 1},
      {"key": "stand-16", "name": "Kakari-geiko", "sides": 1, "description": "Uke weicht mehrmals aus → Kombination"},
      {"key": "stand-17", "name": "Übergang Stand-Boden", "sides": 1, "description": "2 Varianten"}
    ]},
    {"key": "stichproben", "title": "Stichproben", "items": [
      {"key": "stichproben-1", "name": "O-soto-gari", "sides": 1, "description": "Grosse Aussensichel"},
      {"key": "stichproben-2", "name": "Uki-goshi", "sides": 1, "description": "Flatternde Hüfte"},
      {"key": "stichproben-3", "name": "Ko-soto-gari", "sides": 1, "description": "Kleine Aussensichel"},
      {"key": "stichproben-4", "name": "Ippon-seoi-nage", "sides": 1, "description": "Punkt-Schulterwurf"},
      {"key": "stichproben-5", "name": "Harai-goshi", "sides": 1, "description": "Hüfte fegen"},
      {"key": "stichproben-6", "name": "Uchi-mata", "sides": 1, "description": "Innerer Schenkelwurf"},
      {"key": "stichproben-7", "name": "Tani-otoshi", "sides": 1, "description": "Talfallzug / ins Tal stürzen"},
      {"key": "stichproben-8", "name": "Yoko-shiho-gatame", "sides": 1, "description": "Seitlicher Haltegriff, Seitvierer"},
      {"key": "stichproben-9", "name": "Ude-hishigi-juji-gatame", "sides": 1, "description": "Den Arm kreuzhebeln"},
      {"key": "stichproben-10", "name": "Tate-shiho-gatame", "sides": 1, "description": "Reitvierer"}
    ]},
    {"key": "theorie", "title": "Theorie", "items": [
      {"key": "theorie-1", "name": "Thema Kampf- / Turnierwesen", "sides": 1, "description": "Waza-ari, Ippon, Mate, Osae-komi, Toketa, Hajime, Shido, Hansoku-make"},
      {"key": "theorie-2", "name": "Unterschiede zwischen …", "sides": 1, "description": "Gake und Gari · oder Uki-goshi und O-goshi · oder De-ashi-barai und Okuri-ashi-barai · …"},
      {"key": "theorie-3", "name": "Was weisst du über Shime-waza?", "sides": 1},
      {"key": "theorie-4", "name": "Wie wird «aufgegeben» bei einer Hebeltechnik?", "sides": 1},
      {"key": "theorie-5", "name": "Unterschied zwischen Randori und Shiai", "sides": 1},
      {"key": "theorie-6", "name": "Erkläre einem Newcomer …", "sides": 1, "description": "Ushiro-ukemi · oder Yoko-ukemi · oder Mae-mawari-ukemi · oder die Dojoregeln · …"},
      {"key": "theorie-7", "name": "Erkläre den Unterschied zwischen Randori und Shiai", "sides": 1},
      {"key": "theorie-8", "name": "Erkläre, wie Ippon erzielt werden kann", "sides": 1},
      {"key": "theorie-9", "name": "Erkläre, was du über Hebeltechniken im Judo weisst", "sides": 1}
    ]}
  ]'::jsonb)
ON CONFLICT (section, grade) DO NOTHING;
