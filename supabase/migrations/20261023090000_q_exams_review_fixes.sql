-- Q-Prüfungen, fixes from the review of 20261021120000_q_exams.sql (same
-- PR, shipped as a second migration so open preview branches pick it up).
--
-- 1. Draft feedback is no longer readable by members before the result.
--    exam_candidates_read_own lets members read their whole row at any
--    time, so the feedback moves to an exam_scores row with the reserved
--    item key '_feedback': scores are only readable for members, and only
--    writable for examiners, under the same "result is in" rules.
-- 2. The stored total is computed here from the scores and the program
--    snapshot when the result is set, instead of trusting one examiner's
--    possibly stale copy; reopening clears it again.
-- 3. A started sheet keeps its grade and section, and an exam day keeps its
--    section once candidates are registered, so a passed exam can only
--    record the grade it was graded for.
-- 4. Members change only registrations that are still 'registered'. A
--    withdrawn registration (by the member or by a trainer) or a call-up can
--    no longer be revived or changed through register_for_exam().

-- ---------------------------------------------------------------------------
-- 1. Feedback as a score row
-- ---------------------------------------------------------------------------
INSERT INTO public.exam_scores (candidate_id, item_key, note)
SELECT id, '_feedback', left(feedback, 2000)
FROM public.exam_candidates
WHERE feedback IS NOT NULL
ON CONFLICT (candidate_id, item_key) DO UPDATE SET note = EXCLUDED.note;

ALTER TABLE public.exam_candidates DROP COLUMN feedback;

-- ---------------------------------------------------------------------------
-- 2. Totals from the scores; grade recorded on pass
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
    VALUES (
      NEW.member_id, NEW.section, NEW.grade, v_date,
      CASE WHEN NEW.total_points IS NOT NULL
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

-- ---------------------------------------------------------------------------
-- 3. Locks
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lock_exam_candidate_grade()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.started_at IS NOT NULL
     AND (NEW.grade IS DISTINCT FROM OLD.grade OR NEW.section IS DISTINCT FROM OLD.section) THEN
    RAISE EXCEPTION 'grade cannot change once grading has started' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER exam_candidates_lock_grade
  BEFORE UPDATE OF grade, section ON public.exam_candidates
  FOR EACH ROW EXECUTE FUNCTION public.lock_exam_candidate_grade();

CREATE OR REPLACE FUNCTION public.lock_exam_section()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.section IS DISTINCT FROM OLD.section
     AND EXISTS (SELECT 1 FROM public.exam_candidates WHERE exam_id = OLD.id) THEN
    RAISE EXCEPTION 'section cannot change once candidates are registered' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER exams_lock_section
  BEFORE UPDATE OF section ON public.exams
  FOR EACH ROW EXECUTE FUNCTION public.lock_exam_section();

-- ---------------------------------------------------------------------------
-- 4. Registration by members: only open registrations change
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
    registered_at = now(),
    registered_by = EXCLUDED.registered_by
  -- Called up or withdrawn: changes and new registrations go through the trainers
  WHERE public.exam_candidates.status = 'registered'
    AND public.exam_candidates.started_at IS NULL
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'registration can no longer be changed' USING ERRCODE = '22023';
  END IF;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lock_exam_candidate_grade() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lock_exam_section() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.register_for_exam(bigint, integer, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_for_exam(bigint, integer, text, integer, text) TO authenticated, service_role;
