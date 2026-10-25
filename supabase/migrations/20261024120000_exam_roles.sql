-- Q-Prüfungen: exam roles, and results stay with the club.
--
-- Two roles on top of the account's role (viewer / trainer / admin), set by
-- admins in the user management (user_profiles.exam_role):
--   examiner   grades: scores, notes, feedback, pass/fail (the sheet)
--   manager    the TK: exam days and programs, plus everything an
--              examiner does
-- Admins have both. Exam roles only count on staff accounts (viewer and up),
-- since grading needs the member list and the exam pages.
--
-- Candidates (registrations, call-up) stay with trainers and the TK, as on
-- the paper list in the dojo; grading columns change only through
-- examiners.
--
-- Members no longer see results: no sheets, points, feedback, examiners or
-- programs. They see exam days, their own registrations (through
-- get_my_exam_registrations(), without result columns) and, once passed,
-- the new kyu like any other grade. The grade note therefore no longer
-- carries the points.

ALTER TABLE public.user_profiles
  ADD COLUMN exam_role text CHECK (exam_role IN ('examiner', 'manager'));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_exam_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = auth.uid()
      AND status = 'approved'
      AND (role = 'admin' OR (role IN ('viewer', 'trainer') AND exam_role = 'manager'))
  );
$$;

CREATE OR REPLACE FUNCTION public.is_examiner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = auth.uid()
      AND status = 'approved'
      AND (role = 'admin' OR (role IN ('viewer', 'trainer') AND exam_role IN ('examiner', 'manager')))
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_exam_manager() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_examiner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_exam_manager() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_examiner() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Programs and exam days: the TK
-- ---------------------------------------------------------------------------
ALTER POLICY exam_programs_read ON public.exam_programs USING ((SELECT public.is_staff()));
ALTER POLICY exam_programs_insert ON public.exam_programs WITH CHECK ((SELECT public.is_exam_manager()));
ALTER POLICY exam_programs_update ON public.exam_programs
  USING ((SELECT public.is_exam_manager())) WITH CHECK ((SELECT public.is_exam_manager()));
ALTER POLICY exam_programs_delete ON public.exam_programs USING ((SELECT public.is_exam_manager()));

ALTER POLICY exams_insert ON public.exams WITH CHECK ((SELECT public.is_exam_manager()));
ALTER POLICY exams_update ON public.exams
  USING ((SELECT public.is_exam_manager())) WITH CHECK ((SELECT public.is_exam_manager()));
ALTER POLICY exams_delete ON public.exams USING ((SELECT public.is_exam_manager()));

-- ---------------------------------------------------------------------------
-- Candidates: trainers and the TK; grading columns only through examiners
-- ---------------------------------------------------------------------------
DROP POLICY exam_candidates_read_own ON public.exam_candidates;
ALTER POLICY exam_candidates_insert ON public.exam_candidates
  WITH CHECK ((SELECT public.is_writer()) OR (SELECT public.is_exam_manager()));
ALTER POLICY exam_candidates_update ON public.exam_candidates
  USING ((SELECT public.is_writer()) OR (SELECT public.is_examiner()))
  WITH CHECK ((SELECT public.is_writer()) OR (SELECT public.is_examiner()));
ALTER POLICY exam_candidates_delete ON public.exam_candidates
  USING ((SELECT public.is_writer()) OR (SELECT public.is_exam_manager()));

-- Through the API (migrations and the seed run as the owner):
--   * the result columns are set only by the result trigger
--   * the sheet (program snapshot, start, result) only by examiners
--   * the registration (everything else) only by trainers and the TK
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
  RETURN NEW;
END;
$$;

-- Named to run before the lock and result triggers (alphabetical order), so
-- it sees the row as the request sent it
CREATE TRIGGER exam_candidates_guard_grading
  BEFORE INSERT OR UPDATE ON public.exam_candidates
  FOR EACH ROW EXECUTE FUNCTION public.guard_exam_grading();

-- ---------------------------------------------------------------------------
-- Sheets: examiners
-- ---------------------------------------------------------------------------
DROP POLICY exam_examiners_read_own ON public.exam_examiners;
ALTER POLICY exam_examiners_insert ON public.exam_examiners
  WITH CHECK ((SELECT public.is_examiner()) AND user_id = (SELECT auth.uid()));
ALTER POLICY exam_examiners_delete ON public.exam_examiners
  USING (
    (SELECT public.is_examiner())
    AND (user_id = (SELECT auth.uid()) OR (SELECT public.is_exam_manager()))
  );

DROP POLICY exam_scores_read_own ON public.exam_scores;
ALTER POLICY exam_scores_insert ON public.exam_scores
  WITH CHECK (
    (SELECT public.is_examiner())
    AND EXISTS (SELECT 1 FROM public.exam_candidates c WHERE c.id = candidate_id AND c.result IS NULL)
  );
ALTER POLICY exam_scores_update ON public.exam_scores
  USING (
    (SELECT public.is_examiner())
    AND EXISTS (SELECT 1 FROM public.exam_candidates c WHERE c.id = candidate_id AND c.result IS NULL)
  )
  WITH CHECK ((SELECT public.is_examiner()));
ALTER POLICY exam_scores_delete ON public.exam_scores
  USING (
    (SELECT public.is_examiner())
    AND EXISTS (SELECT 1 FROM public.exam_candidates c WHERE c.id = candidate_id AND c.result IS NULL)
  );

-- ---------------------------------------------------------------------------
-- The result records the grade, without the points (grades are visible to
-- every approved account). Security definer: an examiner may be a viewer,
-- who cannot write member_grades directly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_exam_candidate_result()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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

  -- Points as the sheet shows them: per item left + right or the single
  -- score, only for items of the candidate's program snapshot.
  IF NEW.result IS NOT NULL AND NEW.program IS NOT NULL THEN
    SELECT
      coalesce(sum(
        CASE WHEN (i.item->>'sides')::int = 2
          THEN coalesce(s.left_points, 0) + coalesce(s.right_points, 0)
          ELSE coalesce(s.points, 0)
        END
      ), 0)::int,
      coalesce(sum(2 * (i.item->>'sides')::int), 0)::int
    INTO NEW.total_points, NEW.max_points
    FROM jsonb_array_elements(NEW.program) AS part(value)
    CROSS JOIN LATERAL jsonb_array_elements(part.value->'items') AS i(item)
    LEFT JOIN public.exam_scores s
      ON s.candidate_id = NEW.id AND s.item_key = i.item->>'key';
  ELSE
    NEW.total_points := NULL;
    NEW.max_points := NULL;
  END IF;

  IF NEW.result = 'passed' THEN
    SELECT date INTO v_date FROM public.exams WHERE id = NEW.exam_id;
    INSERT INTO public.member_grades ("memberId", section, grade, "examDate", note)
    VALUES (NEW.member_id, NEW.section, NEW.grade, v_date, 'Q-Prüfung')
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

CREATE OR REPLACE FUNCTION public.remove_exam_candidate_grade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.member_grades WHERE id = OLD.member_grade_id;
  RETURN NULL;
END;
$$;

UPDATE public.member_grades
SET note = 'Q-Prüfung'
WHERE note LIKE 'Q-Prüfung: %'
  AND id IN (SELECT member_grade_id FROM public.exam_candidates WHERE member_grade_id IS NOT NULL);

-- ---------------------------------------------------------------------------
-- What members see
-- ---------------------------------------------------------------------------

-- The caller's own registrations: status and call-up, no result columns.
CREATE OR REPLACE FUNCTION public.get_my_exam_registrations()
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
  registered_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.exam_id, c.member_id, c.section, c.grade, c.belt_length_cm, c.note,
         c.status, c.group_name, c.call_time, c.started_at IS NOT NULL, c.registered_at
  FROM public.exam_candidates c
  WHERE c.member_id IN (SELECT public.my_member_ids())
  ORDER BY c.registered_at DESC;
$$;

-- Which grades have a program (not the program itself), so the registration
-- suggests a grade that is examined rather than the white belt.
CREATE OR REPLACE FUNCTION public.get_exam_program_grades()
RETURNS TABLE (section text, grade text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.section, p.grade FROM public.exam_programs p
  WHERE public.is_approved_user();
$$;

REVOKE EXECUTE ON FUNCTION public.guard_exam_grading() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_exam_candidate_result() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.remove_exam_candidate_grade() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_exam_registrations() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_exam_program_grades() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_exam_registrations() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_exam_program_grades() TO authenticated, service_role;
