-- Q-Prüfungen: fixes from the review of the exam roles
-- (20261024120000_exam_roles.sql).
--
-- * An examined candidate stays as examined: once a sheet is started or has
--   a result, who is examined (member, exam day) and for what (section,
--   grade) is fixed, the program snapshot and the start too, and a result
--   is only changed by reopening the sheet. Before, a trainer could move a
--   graded sheet to another member, withdraw or delete it, and a reopen
--   then removed the wrong member's grade.
-- * Trainers delete only candidates whose sheet has not started; the TK
--   cleans up anything.
-- * Examiners sign on to and off open sheets only, under their own name.
-- * Staff-side candidates fit the exam day: its section, kyu grades only
--   (the result trigger records the grade with the definer's rights).
-- * Members register for a grade above their current one only, and not
--   any more once the sheet has a result; their registration list says
--   whether grading is done (not how it went).
-- * The member's registration remark (note) is visible to the member; staff
--   get an internal note (staff_note) next to it.
-- * An exam role only lives on viewer and trainer accounts: changing the
--   role to member or admin clears it, so it cannot come back unnoticed.

-- ---------------------------------------------------------------------------
-- Exam roles follow the account role
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clear_exam_role()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.role NOT IN ('viewer', 'trainer') THEN
    NEW.exam_role := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_profiles_clear_exam_role
  BEFORE INSERT OR UPDATE OF role, exam_role ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.clear_exam_role();

UPDATE public.user_profiles
SET exam_role = NULL
WHERE exam_role IS NOT NULL AND role NOT IN ('viewer', 'trainer');

-- ---------------------------------------------------------------------------
-- Internal note on a candidate
-- ---------------------------------------------------------------------------
ALTER TABLE public.exam_candidates
  ADD COLUMN staff_note text CHECK (length(staff_note) <= 2000);

-- ---------------------------------------------------------------------------
-- Candidate rows: who may change what, and what an examined row keeps
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_exam_grading()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_sheet constant text[] := ARRAY[
    'program', 'min_points', 'started_at', 'result',
    'total_points', 'max_points', 'completed_at', 'completed_by', 'member_grade_id'
  ];
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  -- A candidate is examined for a kyu grade of the exam day's section
  IF NEW.section IS DISTINCT FROM (SELECT e.section FROM public.exams e WHERE e.id = NEW.exam_id)
     OR EXISTS (
       SELECT 1 FROM public.grade_definitions g
       WHERE g.section = NEW.section AND g.grade = NEW.grade AND g."isDan"
     ) THEN
    RAISE EXCEPTION 'grade does not fit the exam day' USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF num_nonnulls(NEW.program, NEW.min_points, NEW.started_at, NEW.result, NEW.total_points,
                    NEW.max_points, NEW.completed_at, NEW.completed_by, NEW.member_grade_id) > 0 THEN
      RAISE EXCEPTION 'a candidate starts without a sheet' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW.total_points, NEW.max_points, NEW.completed_at, NEW.completed_by, NEW.member_grade_id)
     IS DISTINCT FROM (OLD.total_points, OLD.max_points, OLD.completed_at, OLD.completed_by, OLD.member_grade_id) THEN
    RAISE EXCEPTION 'result columns are set by the result' USING ERRCODE = '42501';
  END IF;
  IF (NEW.result, NEW.started_at, NEW.program, NEW.min_points)
     IS DISTINCT FROM (OLD.result, OLD.started_at, OLD.program, OLD.min_points)
     AND NOT public.is_examiner() THEN
    RAISE EXCEPTION 'only examiners grade' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - v_sheet) IS DISTINCT FROM (to_jsonb(OLD) - v_sheet)
     AND NOT (public.is_writer() OR public.is_exam_manager()) THEN
    RAISE EXCEPTION 'only trainers and the TK manage candidates' USING ERRCODE = '42501';
  END IF;

  -- Examined: the sheet keeps its program and start, and stays with its
  -- member and exam day; a result is taken back by reopening (result null)
  IF OLD.started_at IS NOT NULL OR OLD.result IS NOT NULL THEN
    IF (NEW.program, NEW.min_points, NEW.started_at)
       IS DISTINCT FROM (OLD.program, OLD.min_points, OLD.started_at) THEN
      RAISE EXCEPTION 'the sheet keeps its program once started' USING ERRCODE = '22023';
    END IF;
    IF (NEW.member_id, NEW.exam_id) IS DISTINCT FROM (OLD.member_id, OLD.exam_id) THEN
      RAISE EXCEPTION 'an examined candidate stays on its sheet' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF OLD.result IS NOT NULL AND NEW.result IS NOT NULL
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'reopen the sheet first' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

-- Grade and section: fixed once the sheet started or has a result (also for
-- grades without a program, whose sheet is never started)
CREATE OR REPLACE FUNCTION public.lock_exam_candidate_grade()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (OLD.started_at IS NOT NULL OR OLD.result IS NOT NULL)
     AND (NEW.grade IS DISTINCT FROM OLD.grade OR NEW.section IS DISTINCT FROM OLD.section) THEN
    RAISE EXCEPTION 'grade cannot change once grading has started' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

ALTER POLICY exam_candidates_delete ON public.exam_candidates
  USING (
    ((SELECT public.is_writer()) AND started_at IS NULL AND result IS NULL)
    OR (SELECT public.is_exam_manager())
  );

-- ---------------------------------------------------------------------------
-- Examiners: open sheets only, under their own name
-- ---------------------------------------------------------------------------
ALTER POLICY exam_examiners_insert ON public.exam_examiners
  WITH CHECK (
    (SELECT public.is_examiner())
    AND user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.exam_candidates c WHERE c.id = candidate_id AND c.result IS NULL)
  );
ALTER POLICY exam_examiners_delete ON public.exam_examiners
  USING (
    (SELECT public.is_examiner())
    AND (
      (SELECT public.is_exam_manager())
      OR (
        user_id = (SELECT auth.uid())
        AND EXISTS (SELECT 1 FROM public.exam_candidates c WHERE c.id = candidate_id AND c.result IS NULL)
      )
    )
  );

-- Not security definer: it checks the API role, and examiners add only
-- themselves (policy), whose profile they can read
CREATE OR REPLACE FUNCTION public.name_exam_examiner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  -- Requests through the API: the name on the sheet is the account's
  -- (as examinerName() in src/lib/examUtils.ts)
  IF current_user IN ('authenticated', 'anon') THEN
    SELECT coalesce(nullif(btrim(p.full_name), ''), split_part(p.email, '@', 1))
    INTO v_name
    FROM public.user_profiles p
    WHERE p.user_id = NEW.user_id;
    IF FOUND THEN
      NEW.name := v_name;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER exam_examiners_name
  BEFORE INSERT ON public.exam_examiners
  FOR EACH ROW EXECUTE FUNCTION public.name_exam_examiner();

-- ---------------------------------------------------------------------------
-- Member registration
-- ---------------------------------------------------------------------------
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
  v_rank integer;
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

  -- A kyu grade of the section above the member's current grade there (the
  -- next one is suggested, any higher one may be chosen, e.g. adults
  -- skipping a half belt)
  SELECT "gradeRank" INTO v_rank
  FROM public.grade_definitions
  WHERE section = v_exam.section AND grade = p_grade AND NOT "isDan";
  IF v_rank IS NULL OR v_rank <= coalesce((
    SELECT max(g."gradeRank")
    FROM public.member_grades mg
    JOIN public.grade_definitions g ON g.section = mg.section AND g.grade = mg.grade
    WHERE mg."memberId" = p_member_id AND mg.section = v_exam.section
  ), 0) THEN
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
    registered_at = now(),
    registered_by = EXCLUDED.registered_by
  -- Called up, withdrawn or examined: changes go through the trainers
  WHERE public.exam_candidates.status = 'registered'
    AND public.exam_candidates.started_at IS NULL
    AND public.exam_candidates.result IS NULL
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'registration can no longer be changed' USING ERRCODE = '22023';
  END IF;
  RETURN v_id;
END;
$$;

-- The member's registrations: status, call-up and whether grading started or
-- is done; never the result itself (a pass shows as the new grade)
DROP FUNCTION public.get_my_exam_registrations();
CREATE FUNCTION public.get_my_exam_registrations()
RETURNS TABLE (
  id bigint,
  exam_id bigint,
  member_id integer,
  section text,
  grade text,
  belt_length_cm smallint,
  note text,
  status text,
  group_name text,
  call_time text,
  started boolean,
  finished boolean,
  registered_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.exam_id, c.member_id, c.section, c.grade, c.belt_length_cm, c.note,
         c.status, c.group_name, c.call_time,
         c.started_at IS NOT NULL OR c.result IS NOT NULL,
         c.result IS NOT NULL,
         c.registered_at
  FROM public.exam_candidates c
  WHERE c.member_id IN (SELECT public.my_member_ids())
  ORDER BY c.registered_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.clear_exam_role() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_exam_grading() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lock_exam_candidate_grade() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.name_exam_examiner() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.register_for_exam(bigint, integer, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_for_exam(bigint, integer, text, integer, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_my_exam_registrations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_exam_registrations() TO authenticated, service_role;
