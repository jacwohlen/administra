-- Retention breakdown: one row per member who trained in the year before
-- year_param, with their age, the training they attended most that year
-- and whether they are gone (no attendance in year_param). The stats page
-- aggregates these into churn by age group and by training.
--
-- "Churned" matches get_member_retention: attended the previous year but
-- not this one. SECURITY INVOKER, so RLS on logs and members limits it to
-- staff like the other stats functions.
CREATE OR REPLACE FUNCTION public.get_retention_breakdown(year_param text)
RETURNS TABLE (
  "memberId" integer,
  age integer,
  "trainingId" integer,
  title text,
  section text,
  weekday text,
  "dateFrom" text,
  churned boolean
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH prev AS (
    SELECT l."memberId", l."trainingId", COUNT(*) AS sessions, MAX(l.date) AS last_date
    FROM public.logs l
    WHERE l.date LIKE concat((year_param::integer - 1)::text, '%')
      AND l."memberId" IS NOT NULL
      AND l."trainingId" IS NOT NULL
    GROUP BY l."memberId", l."trainingId"
  ),
  main_training AS (
    -- The training a member attended most; ties go to the most recent one
    SELECT DISTINCT ON (p."memberId") p."memberId", p."trainingId"
    FROM prev p
    ORDER BY p."memberId", p.sessions DESC, p.last_date DESC
  ),
  still_active AS (
    SELECT DISTINCT l."memberId"
    FROM public.logs l
    WHERE l.date LIKE concat(year_param, '%')
  )
  SELECT
    mt."memberId",
    -- Age at the end of the previous year; birthdays are free text
    CASE
      WHEN m.birthday ~ '^\d{4}-\d{2}-\d{2}$' THEN
        date_part('year', age(make_date(year_param::integer - 1, 12, 31), m.birthday::date))::integer
    END AS age,
    t.id::integer,
    t.title,
    t.section,
    t.weekday,
    t."dateFrom",
    NOT EXISTS (SELECT 1 FROM still_active s WHERE s."memberId" = mt."memberId") AS churned
  FROM main_training mt
  INNER JOIN public.members m ON m.id = mt."memberId"
  INNER JOIN public.trainings t ON t.id = mt."trainingId";
$$;

REVOKE EXECUTE ON FUNCTION public.get_retention_breakdown(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_retention_breakdown(text) TO authenticated;
