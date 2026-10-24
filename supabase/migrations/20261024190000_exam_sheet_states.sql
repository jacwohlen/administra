-- Q-Prüfungen: sheet states, from the second review of the exam roles.
--
-- * A withdrawn candidate gets no start, no scores and no result; a
--   candidate with a result is not withdrawn without reopening first (the
--   sheet hides "Wieder öffnen" for withdrawn candidates). Calling up a
--   graded candidate (registered -> invited) stays possible, so a bulk
--   call-up does not fail on one already graded.
-- * A result changes only by reopening (passed -> null -> failed), as the
--   app does, not passed -> failed in one step.
-- * An empty program (no items yet) does not count as a program for the
--   member's grade suggestion.

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
  -- A result is changed by reopening; a candidate with a result is not
  -- withdrawn (that would hide the reopen) and a withdrawn one gets no start
  -- and no result
  IF OLD.result IS NOT NULL AND NEW.result IS NOT NULL
     AND (NEW.result <> OLD.result
          OR (NEW.status IS DISTINCT FROM OLD.status AND 'withdrawn' IN (NEW.status, OLD.status))) THEN
    RAISE EXCEPTION 'reopen the sheet first' USING ERRCODE = '22023';
  END IF;
  IF NEW.status = 'withdrawn'
     AND ((NEW.result IS NOT NULL AND NEW.result IS DISTINCT FROM OLD.result)
          OR (NEW.started_at IS NOT NULL AND OLD.started_at IS NULL)) THEN
    RAISE EXCEPTION 'the candidate is withdrawn' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

-- Scores: the sheet must be open and the candidate not withdrawn
CREATE OR REPLACE FUNCTION public.lock_open_exam_sheet()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM public.exam_candidates
  WHERE id = NEW.candidate_id AND result IS NULL AND status <> 'withdrawn'
  FOR SHARE;
  IF NOT FOUND AND current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'the sheet is closed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_exam_program_grades()
RETURNS TABLE (section text, grade text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.section, p.grade FROM public.exam_programs p
  WHERE public.is_approved_user() AND jsonb_array_length(p.parts) > 0;
$$;

REVOKE EXECUTE ON FUNCTION public.guard_exam_grading() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lock_open_exam_sheet() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_exam_program_grades() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_exam_program_grades() TO authenticated, service_role;
