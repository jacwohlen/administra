-- Q-Prüfungen: a score written while another examiner closes the sheet.
--
-- The exam_scores policies check "result is null" against the statement's
-- snapshot without locking the candidate, and the result trigger
-- (sync_exam_candidate_result) adds up the scores it can see. A score saved
-- in the same moment as Bestanden could therefore be missing from the stored
-- total yet still land on the finished sheet.
--
-- Every score write now takes a share lock on its open candidate row. That
-- conflicts with the result update: the update waits for the write and then
-- counts it, and a write that comes after the result finds the sheet closed.
-- Writes by the database owner (migrations, seed) are not checked.

CREATE OR REPLACE FUNCTION public.lock_open_exam_sheet()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM public.exam_candidates
  WHERE id = NEW.candidate_id AND result IS NULL
  FOR SHARE;
  IF NOT FOUND AND current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'the sheet is closed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- Not on DELETE: deleting a candidate must still cascade to the scores
CREATE TRIGGER exam_scores_lock_sheet
  BEFORE INSERT OR UPDATE ON public.exam_scores
  FOR EACH ROW EXECUTE FUNCTION public.lock_open_exam_sheet();

REVOKE EXECUTE ON FUNCTION public.lock_open_exam_sheet() FROM PUBLIC, anon, authenticated;
