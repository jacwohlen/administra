--
-- Returns the last N training dates for a given training,
-- and for each participant, which dates they attended.
-- Used to render a dot streak + trend indicator on the attendance checklist.
--
CREATE FUNCTION public.get_checklist_member_streak(tid integer, before_date text, n integer DEFAULT 10)
RETURNS TABLE (
  "memberId"  integer,
  date        text,
  seq         integer
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH recent_dates AS (
    SELECT DISTINCT l.date AS d
    FROM public.logs l
    WHERE l."trainingId" = tid
      AND l.date < before_date
    ORDER BY l.date DESC
    LIMIT n
  ),
  numbered AS (
    SELECT d, ROW_NUMBER() OVER (ORDER BY d ASC) AS seq
    FROM recent_dates
  )
  SELECT l."memberId", l.date, nb.seq::integer
  FROM public.logs l
  INNER JOIN numbered nb ON nb.d = l.date
  WHERE l."trainingId" = tid;
END;
$$;
