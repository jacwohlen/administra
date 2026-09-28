-- Details behind the member retention figures on the stats page.
--
-- Both functions are SECURITY INVOKER, so RLS on logs and members limits
-- them to staff like the other stats functions. Birthdays are free text;
-- the age is only computed for ISO dates.

-- Every member who trained in the year before year_param, with their age at
-- the end of that year, the training they attended most, their last
-- session and whether they are gone (no attendance in year_param). The page
-- aggregates these into churn rates by age group and by training.
-- "Churned" matches get_member_retention.
CREATE OR REPLACE FUNCTION public.get_retention_breakdown(year_param text)
RETURNS TABLE (
  "memberId" integer,
  firstname text,
  lastname text,
  age integer,
  "trainingId" integer,
  title text,
  section text,
  weekday text,
  "dateFrom" text,
  last_date text,
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
    SELECT DISTINCT ON (p."memberId")
      p."memberId",
      p."trainingId",
      MAX(p.last_date) OVER (PARTITION BY p."memberId") AS last_date
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
    m.firstname,
    m.lastname,
    CASE
      WHEN m.birthday ~ '^\d{4}-\d{2}-\d{2}$' THEN
        date_part('year', age(make_date(year_param::integer - 1, 12, 31), m.birthday::date))::integer
    END AS age,
    t.id::integer,
    t.title,
    t.section,
    t.weekday,
    t."dateFrom",
    mt.last_date,
    NOT EXISTS (SELECT 1 FROM still_active s WHERE s."memberId" = mt."memberId") AS churned
  FROM main_training mt
  INNER JOIN public.members m ON m.id = mt."memberId"
  INNER JOIN public.trainings t ON t.id = mt."trainingId";
$$;

-- Members who trained for the first time in year_param (no attendance
-- before it, matching get_member_retention's "new"), with their age at the
-- end of that year, the training they attended most and their first session.
CREATE OR REPLACE FUNCTION public.get_new_member_breakdown(year_param text)
RETURNS TABLE (
  "memberId" integer,
  firstname text,
  lastname text,
  age integer,
  "trainingId" integer,
  title text,
  section text,
  weekday text,
  "dateFrom" text,
  first_date text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH this_year AS (
    SELECT l."memberId", l."trainingId", COUNT(*) AS sessions, MAX(l.date) AS last_date
    FROM public.logs l
    WHERE l.date LIKE concat(year_param, '%')
      AND l."memberId" IS NOT NULL
      AND l."trainingId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.logs l2
        WHERE l2."memberId" = l."memberId" AND l2.date < concat(year_param, '-01-01')
      )
    GROUP BY l."memberId", l."trainingId"
  ),
  main_training AS (
    SELECT DISTINCT ON (y."memberId") y."memberId", y."trainingId"
    FROM this_year y
    ORDER BY y."memberId", y.sessions DESC, y.last_date DESC
  )
  SELECT
    mt."memberId",
    m.firstname,
    m.lastname,
    CASE
      WHEN m.birthday ~ '^\d{4}-\d{2}-\d{2}$' THEN
        date_part('year', age(make_date(year_param::integer, 12, 31), m.birthday::date))::integer
    END AS age,
    t.id::integer,
    t.title,
    t.section,
    t.weekday,
    t."dateFrom",
    (SELECT MIN(l.date) FROM public.logs l WHERE l."memberId" = mt."memberId") AS first_date
  FROM main_training mt
  INNER JOIN public.members m ON m.id = mt."memberId"
  INNER JOIN public.trainings t ON t.id = mt."trainingId";
$$;

REVOKE EXECUTE ON FUNCTION public.get_retention_breakdown(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_retention_breakdown(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_new_member_breakdown(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_new_member_breakdown(text) TO authenticated;
