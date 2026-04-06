-----------------
-- Stats Enhancement Functions
-----------------

-- 1. Summary KPIs: total trainings, unique participants, events, avg attendance
CREATE OR REPLACE FUNCTION public.get_stats_summary(year_param text)
RETURNS TABLE (
  total_training_sessions bigint,
  total_unique_participants bigint,
  total_events bigint,
  avg_attendance_per_training numeric,
  avg_attendance_per_event numeric
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(DISTINCT (l.date, l."trainingId"))
     FROM public.logs l
     WHERE (year_param = '' OR l.date LIKE concat(year_param, '%'))
    ) AS total_training_sessions,

    (SELECT COUNT(DISTINCT l."memberId")
     FROM public.logs l
     WHERE (year_param = '' OR l.date LIKE concat(year_param, '%'))
    ) AS total_unique_participants,

    (SELECT COUNT(*)
     FROM public.events e
     WHERE (year_param = '' OR e.date LIKE concat(year_param, '%'))
    ) AS total_events,

    (SELECT ROUND(AVG(session_count), 1)
     FROM (
       SELECT COUNT(l."memberId") AS session_count
       FROM public.logs l
       WHERE (year_param = '' OR l.date LIKE concat(year_param, '%'))
       GROUP BY l.date, l."trainingId"
     ) sub
    ) AS avg_attendance_per_training,

    (SELECT ROUND(AVG(event_count), 1)
     FROM (
       SELECT COUNT(el."memberId") AS event_count
       FROM public.event_logs el
       JOIN public.events e ON e.id = el."eventId"
       WHERE (year_param = '' OR e.date LIKE concat(year_param, '%'))
       GROUP BY el."eventId"
     ) sub2
    ) AS avg_attendance_per_event;
END;
$$;

-- 2. Average attendance per training (for bar chart)
CREATE OR REPLACE FUNCTION public.get_avg_attendance_by_training(year_param text)
RETURNS TABLE (
  "trainingId" smallint,
  title text,
  section text,
  avg_attendance numeric
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id AS "trainingId",
    t.title,
    t.section,
    ROUND(AVG(sub.cnt), 1) AS avg_attendance
  FROM public.trainings t
  INNER JOIN (
    SELECT l."trainingId", l.date, COUNT(l."memberId") AS cnt
    FROM public.logs l
    WHERE (year_param = '' OR l.date LIKE concat(year_param, '%'))
    GROUP BY l."trainingId", l.date
  ) sub ON sub."trainingId" = t.id
  GROUP BY t.id, t.title, t.section
  ORDER BY t.section, avg_attendance DESC;
END;
$$;

-- 3. Monthly attendance by section (for stacked bar chart)
CREATE OR REPLACE FUNCTION public.get_monthly_attendance(year_param text)
RETURNS TABLE (
  month text,
  section text,
  count bigint
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    SUBSTRING(l.date FROM 1 FOR 7) AS month,
    t.section,
    COUNT(l."memberId") AS count
  FROM public.logs l
  INNER JOIN public.trainings t ON t.id = l."trainingId"
  WHERE (year_param = '' OR l.date LIKE concat(year_param, '%'))
  GROUP BY SUBSTRING(l.date FROM 1 FOR 7), t.section
  ORDER BY month, t.section;
END;
$$;

-- 4. Attendance distribution by section (for donut chart)
CREATE OR REPLACE FUNCTION public.get_attendance_by_section(year_param text)
RETURNS TABLE (
  section text,
  count bigint
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.section,
    COUNT(l."memberId") AS count
  FROM public.logs l
  INNER JOIN public.trainings t ON t.id = l."trainingId"
  WHERE (year_param = '' OR l.date LIKE concat(year_param, '%'))
  GROUP BY t.section
  ORDER BY count DESC;
END;
$$;

-- 5. Member retention: new vs returning vs churned
CREATE OR REPLACE FUNCTION public.get_member_retention(year_param text)
RETURNS TABLE (
  new_members bigint,
  returning_members bigint,
  churned_members bigint
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  prev_year text;
BEGIN
  -- Calculate previous year
  prev_year := (year_param::integer - 1)::text;

  RETURN QUERY
  SELECT
    -- New: attended this year but never before this year
    (SELECT COUNT(DISTINCT l."memberId")
     FROM public.logs l
     WHERE l.date LIKE concat(year_param, '%')
       AND l."memberId" NOT IN (
         SELECT DISTINCT l2."memberId"
         FROM public.logs l2
         WHERE l2.date < concat(year_param, '-01-01')
       )
    ) AS new_members,

    -- Returning: attended this year AND also attended before this year
    (SELECT COUNT(DISTINCT l."memberId")
     FROM public.logs l
     WHERE l.date LIKE concat(year_param, '%')
       AND l."memberId" IN (
         SELECT DISTINCT l2."memberId"
         FROM public.logs l2
         WHERE l2.date < concat(year_param, '-01-01')
       )
    ) AS returning_members,

    -- Churned: attended previous year but NOT this year
    (SELECT COUNT(DISTINCT l."memberId")
     FROM public.logs l
     WHERE l.date LIKE concat(prev_year, '%')
       AND l."memberId" NOT IN (
         SELECT DISTINCT l2."memberId"
         FROM public.logs l2
         WHERE l2.date LIKE concat(year_param, '%')
       )
    ) AS churned_members;
END;
$$;

-- 6. Trainer workload: sessions per trainer by role
CREATE OR REPLACE FUNCTION public.get_trainer_workload(year_param text)
RETURNS TABLE (
  "memberId" integer,
  lastname text,
  firstname text,
  main_trainer_count bigint,
  assistant_count bigint,
  total_count bigint
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    l."memberId",
    m.lastname,
    m.firstname,
    COUNT(CASE WHEN l."trainerRole" = 'main_trainer' THEN 1 END) AS main_trainer_count,
    COUNT(CASE WHEN l."trainerRole" = 'assistant' THEN 1 END) AS assistant_count,
    COUNT(*) AS total_count
  FROM public.logs l
  INNER JOIN public.members m ON m.id = l."memberId"
  WHERE l."trainerRole" IN ('main_trainer', 'assistant')
    AND (year_param = '' OR l.date LIKE concat(year_param, '%'))
  GROUP BY l."memberId", m.lastname, m.firstname
  ORDER BY total_count DESC, m.lastname;
END;
$$;
