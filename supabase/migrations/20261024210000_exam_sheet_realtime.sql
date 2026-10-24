-- Q-Prüfungen: live sheets.
--
-- Two examiners grading the same pair share one sheet. The sheet subscribes
-- to changes of its candidates, scores and examiners through Supabase
-- Realtime (postgres_changes), so a score, a note, a sign-on or the result
-- shows on the other phone within a second.
--
-- Realtime applies the tables' row level security per subscriber: staff
-- receive the changes, members receive none. Deletes are the exception
-- Postgres cannot check; they carry only the primary key (candidate and item
-- key, candidate and examiner account), no points, notes or names.

DO $$
DECLARE
  t text;
BEGIN
  -- Plain Postgres (no Supabase Realtime), or a publication of all tables
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime' AND NOT puballtables
  ) THEN
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY['exam_candidates', 'exam_examiners', 'exam_scores'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
