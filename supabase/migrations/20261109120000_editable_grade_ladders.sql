-- Grade ladders edited in the app instead of with SQL, so a club can add the
-- ladder of any sport (Karate, Ju-Jitsu, BJJ, …) for one of its sections.
-- See docs/GRADE_LADDERS.md.
--
-- A ladder stays what it was: the grade_definitions rows of one section,
-- lowest grade first by "gradeRank". Admins replace a section's whole ladder
-- at once through save_grade_ladder(), which keeps "gradeRank" 1..n without
-- gaps (get_member_current_grades() finds the next grade at rank + 1),
-- renames a grade everywhere it is used (member_grades now cascades like
-- exam_programs and exam_candidates already did) and refuses to drop a grade
-- that a grading, an exam registration or an exam program still uses.
-- grade_definitions keeps having no write policy: the function is the only
-- way in.

-- ---------------------------------------------------------------------------
-- 1. A renamed grade moves with its gradings
-- ---------------------------------------------------------------------------
ALTER TABLE public.member_grades DROP CONSTRAINT IF EXISTS member_grades_grade_fkey;
ALTER TABLE public.member_grades
  ADD CONSTRAINT member_grades_grade_fkey FOREIGN KEY (section, grade)
  REFERENCES public.grade_definitions (section, grade) ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. save_grade_ladder(section, grades)
--
-- p_grades: the whole ladder, lowest grade first, as
--   [{ "grade": "5. Kyu", "previous": "5. Kyu" | null, "beltColor": "#f4d03f",
--      "beltColor2": null, "isDan": false }, …]
-- "previous" is the grade's current name (null for a new grade), so a rename
-- is told apart from a delete plus an insert. Grades of the section that no
-- element names as previous are deleted; an empty array deletes the ladder.
-- ---------------------------------------------------------------------------
-- One row per rung of the editor's list, rank from the position (objects only)
CREATE OR REPLACE FUNCTION public.grade_ladder_input(p_grades jsonb)
RETURNS TABLE (rank int, grade text, previous text, belt_color text, belt_color2 text, is_dan boolean)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT e.ord::int,
         btrim(e.value ->> 'grade'),
         nullif(e.value ->> 'previous', ''),
         btrim(coalesce(e.value ->> 'beltColor', '')),
         nullif(btrim(coalesce(e.value ->> 'beltColor2', '')), ''),
         CASE WHEN jsonb_typeof(e.value -> 'isDan') = 'boolean'
              THEN (e.value ->> 'isDan')::boolean END
  FROM jsonb_array_elements(p_grades) WITH ORDINALITY AS e(value, ord)
  WHERE jsonb_typeof(e.value) = 'object';
$$;

REVOKE EXECUTE ON FUNCTION public.grade_ladder_input(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_grade_ladder(p_section text, p_grades jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_section text := btrim(coalesce(p_section, ''));
  v_count int;
  v_in_use text;
  r record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'only admins edit grade ladders' USING ERRCODE = '42501';
  END IF;
  IF v_section = '' OR length(v_section) > 60 THEN
    RAISE EXCEPTION 'invalid section' USING ERRCODE = '22023';
  END IF;
  IF p_grades IS NULL OR jsonb_typeof(p_grades) <> 'array' THEN
    RAISE EXCEPTION 'grades must be an array' USING ERRCODE = '22023';
  END IF;
  v_count := jsonb_array_length(p_grades);
  IF v_count > 100 THEN
    RAISE EXCEPTION 'too many grades' USING ERRCODE = '22023';
  END IF;

  IF (SELECT count(*) FROM public.grade_ladder_input(p_grades)) <> v_count THEN
    RAISE EXCEPTION 'every grade must be an object' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.grade_ladder_input(p_grades)
             WHERE grade IS NULL OR grade = '' OR length(grade) > 40) THEN
    RAISE EXCEPTION 'invalid grade name' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.grade_ladder_input(p_grades) WHERE is_dan IS NULL) THEN
    RAISE EXCEPTION 'isDan must be true or false' USING ERRCODE = '22023';
  END IF;
  -- Hex colours from the editor, or a colour name some ladders were seeded with
  IF EXISTS (SELECT 1 FROM public.grade_ladder_input(p_grades)
             WHERE belt_color !~ '^(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}|[a-zA-Z]{3,20})$'
                OR belt_color2 !~ '^(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}|[a-zA-Z]{3,20})$') THEN
    RAISE EXCEPTION 'invalid belt colour' USING ERRCODE = '22023';
  END IF;
  SELECT string_agg(grade, ', ') INTO v_in_use FROM (
    SELECT lower(grade) AS grade FROM public.grade_ladder_input(p_grades)
    GROUP BY lower(grade) HAVING count(*) > 1) d;
  IF v_in_use IS NOT NULL THEN
    RAISE EXCEPTION 'duplicate grade: %', v_in_use USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT previous FROM public.grade_ladder_input(p_grades) WHERE previous IS NOT NULL
             GROUP BY previous HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'a grade is kept twice' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.grade_ladder_input(p_grades) i
             WHERE i.previous IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM public.grade_definitions g
                               WHERE g.section = v_section AND g.grade = i.previous)) THEN
    RAISE EXCEPTION 'unknown grade, reload the ladder' USING ERRCODE = '40001';
  END IF;

  -- No other save in between
  PERFORM 1 FROM public.grade_definitions WHERE section = v_section FOR UPDATE;

  -- Grades left out are deleted, unless something still uses them
  SELECT string_agg(g.grade, ', ' ORDER BY g."gradeRank") INTO v_in_use
  FROM public.grade_definitions g
  WHERE g.section = v_section
    AND g.grade NOT IN (SELECT previous FROM public.grade_ladder_input(p_grades) WHERE previous IS NOT NULL)
    AND (EXISTS (SELECT 1 FROM public.member_grades mg WHERE mg.section = g.section AND mg.grade = g.grade)
      OR EXISTS (SELECT 1 FROM public.exam_candidates c WHERE c.section = g.section AND c.grade = g.grade)
      OR EXISTS (SELECT 1 FROM public.exam_programs p WHERE p.section = g.section AND p.grade = g.grade));
  IF v_in_use IS NOT NULL THEN
    RAISE EXCEPTION 'grade in use: %', v_in_use USING ERRCODE = '23503';
  END IF;

  DELETE FROM public.grade_definitions g
  WHERE g.section = v_section
    AND g.grade NOT IN (SELECT previous FROM public.grade_ladder_input(p_grades) WHERE previous IS NOT NULL);

  -- Renames in two steps, so two grades can swap names: first out of the
  -- way, then to the new name; ON UPDATE CASCADE carries gradings, exam
  -- registrations and programs along
  UPDATE public.grade_definitions g
  SET grade = E'\u0001' || i.rank
  FROM public.grade_ladder_input(p_grades) i
  WHERE g.section = v_section AND g.grade = i.previous AND i.grade <> i.previous;

  UPDATE public.grade_definitions g
  SET grade = i.grade
  FROM public.grade_ladder_input(p_grades) i
  WHERE g.section = v_section AND g.grade = E'\u0001' || i.rank;

  -- Rank, colours and dan for every kept grade, then the new ones
  UPDATE public.grade_definitions g
  SET "gradeRank" = i.rank, "beltColor" = i.belt_color, "beltColor2" = i.belt_color2,
      "isDan" = i.is_dan
  FROM public.grade_ladder_input(p_grades) i
  WHERE g.section = v_section AND i.previous IS NOT NULL AND g.grade = i.grade
    AND (g."gradeRank", g."beltColor", g."beltColor2", g."isDan")
        IS DISTINCT FROM (i.rank, i.belt_color, i.belt_color2, i.is_dan);

  INSERT INTO public.grade_definitions (section, grade, "gradeRank", "beltColor", "beltColor2", "isDan")
  SELECT v_section, i.grade, i.rank, i.belt_color, i.belt_color2, i.is_dan
  FROM public.grade_ladder_input(p_grades) i
  WHERE i.previous IS NULL;

  -- A grade that became (or stopped being) a dan changes the black belt badge
  FOR r IN SELECT DISTINCT mg."memberId" FROM public.member_grades mg WHERE mg.section = v_section LOOP
    PERFORM public.refresh_member_grade_medal_badges(r."memberId");
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_grade_ladder(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_grade_ladder(text, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.save_grade_ladder(text, jsonb) IS
  'Admins: replace the grade ladder of one section (lowest grade first), renaming, reordering, adding and deleting unused grades in one go. docs/GRADE_LADDERS.md';
