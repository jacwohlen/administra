-----------------
-- Step 1: Add enum type and new column
-----------------

-- Create trainer role enum
CREATE TYPE trainer_role AS ENUM ('attendee', 'main_trainer', 'assistant');

-- Add new trainerRole column (nullable initially, will be set NOT NULL after migration)
ALTER TABLE public.logs
  ADD COLUMN "trainerRole" trainer_role;

-----------------
-- Step 2: Migrate existing data
-----------------

-- Convert existing isMainTrainer boolean to trainerRole enum
UPDATE public.logs
SET "trainerRole" = CASE
  WHEN "isMainTrainer" = TRUE THEN 'main_trainer'::trainer_role
  ELSE 'attendee'::trainer_role
END;

-- Make column NOT NULL and set default after migration
ALTER TABLE public.logs
  ALTER COLUMN "trainerRole" SET NOT NULL,
  ALTER COLUMN "trainerRole" SET DEFAULT 'attendee';

-----------------
-- Step 3: Update view_logs_summary
-----------------

-- Drop the existing view first (can't rename columns with CREATE OR REPLACE)
DROP VIEW IF EXISTS public.view_logs_summary;

-- Recreate with new column names
CREATE VIEW public.view_logs_summary
WITH (security_invoker = on) AS
SELECT
    logs.date,
    logs."trainingId",
    COUNT(logs."memberId") AS count,
    COUNT(CASE WHEN logs."trainerRole" = 'main_trainer' THEN 1 END) AS "mainTrainerCount",
    COUNT(CASE WHEN logs."trainerRole" = 'assistant' THEN 1 END) AS "assistantCount",
    COUNT(CASE WHEN logs."trainerRole" IN ('main_trainer', 'assistant') THEN 1 END) AS "totalTrainerCount",
    CASE
        WHEN lesson_plans.id IS NOT NULL THEN true
        ELSE false
    END AS "hasLessonPlan"
FROM public.logs
LEFT JOIN public.lesson_plans ON (
    lesson_plans."trainingId" = logs."trainingId" AND
    lesson_plans.date = logs.date
)
GROUP BY logs.date, logs."trainingId", lesson_plans.id;

-----------------
-- Step 4: Update existing functions
-----------------

-- Drop existing functions that have return type changes
DROP FUNCTION IF EXISTS public.get_checklist_members(text, integer);

-- Update get_checklist_members to return trainerRole
CREATE FUNCTION public.get_checklist_members(d text, tid integer)
RETURNS TABLE (
  "trainingId"    smallint,
  "memberId"      integer,
  lastname        text,
  firstname       text,
  labels          jsonb,
  img             text,
  date            text,
  "trainerRole"   trainer_role
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p."trainingId",
    p."memberId",
    m.lastname,
    m.firstname,
    m.labels,
    m.img,
    l.date,
    COALESCE(l."trainerRole", 'attendee'::trainer_role) as "trainerRole"
  FROM public.participants AS p
  FULL OUTER JOIN public.logs AS l
    ON p."memberId" = l."memberId"
   AND l.date = d
   AND l."trainingId" = tid
  INNER JOIN public.members AS m
    ON m.id = p."memberId"
  WHERE p."trainingId" = tid;
END;
$$;

-- Update get_top_trainers_by_section to use trainerRole
CREATE OR REPLACE FUNCTION public.get_top_trainers_by_section(year text)
RETURNS TABLE (
  section     text,
  "memberId"  integer,
  lastname    text,
  firstname   text,
  count       bigint
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.section,
    l."memberId",
    m.lastname,
    m.firstname,
    COUNT(*)
  FROM public.logs AS l
  INNER JOIN public.members   AS m ON m.id = l."memberId"
  INNER JOIN public.trainings AS t ON t.id = l."trainingId"
  WHERE l."trainerRole" IN ('main_trainer', 'assistant')
    AND l.date LIKE concat(year, '%')
  GROUP BY t.section, l."memberId", m.lastname, m.firstname
  ORDER BY COUNT(*) DESC, m.lastname;
END;
$$;

-- Update get_top_trainers_for_training to use trainerRole
CREATE OR REPLACE FUNCTION public.get_top_trainers_for_training(training integer, year text)
RETURNS TABLE (
  rank        bigint,
  section     text,
  "memberId"  smallint,
  lastname    text,
  firstname   text,
  count       bigint
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC, m.lastname) AS rank,
    t.section,
    l."memberId",
    m.lastname,
    m.firstname,
    COUNT(*)
  FROM public.logs AS l
  INNER JOIN public.members   AS m ON m.id = l."memberId"
  INNER JOIN public.trainings AS t ON t.id = l."trainingId"
  WHERE l.date LIKE concat(year, '%')
    AND t.id = training
    AND l."trainerRole" IN ('main_trainer', 'assistant')
  GROUP BY t.section, l."memberId", m.lastname, m.firstname
  ORDER BY COUNT(*) DESC, m.lastname;
END;
$$;

-- Update get_top_trainers_from_section to use trainerRole
CREATE OR REPLACE FUNCTION public.get_top_trainers_from_section(sect text, year text)
RETURNS TABLE (
  rank        bigint,
  section     text,
  "memberId"  integer,
  lastname    text,
  firstname   text,
  count       bigint
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC, m.lastname) AS rank,
    t.section,
    l."memberId",
    m.lastname,
    m.firstname,
    COUNT(*)
  FROM public.logs AS l
  INNER JOIN public.members   AS m ON m.id = l."memberId"
  INNER JOIN public.trainings AS t ON t.id = l."trainingId"
  WHERE l."trainerRole" IN ('main_trainer', 'assistant')
    AND l.date LIKE concat(year, '%')
    AND lower(t.section) = lower(sect)
  GROUP BY t.section, l."memberId", m.lastname, m.firstname
  ORDER BY COUNT(*) DESC, m.lastname;
END;
$$;

-----------------
-- Step 5: Create new function for trainer tracking data export
-----------------

CREATE OR REPLACE FUNCTION public.get_trainer_tracking_data(year_param text)
RETURNS TABLE (
  date            text,
  "trainingId"    smallint,
  "trainingTitle" text,
  section         text,
  "memberId"      integer,
  lastname        text,
  firstname       text,
  "trainerRole"   trainer_role,
  "attendeeCount" bigint
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    l.date,
    l."trainingId",
    t.title as "trainingTitle",
    t.section,
    l."memberId",
    m.lastname,
    m.firstname,
    l."trainerRole",
    (SELECT COUNT(*)
     FROM public.logs l2
     WHERE l2.date = l.date
       AND l2."trainingId" = l."trainingId"
       AND l2."trainerRole" = 'attendee') as "attendeeCount"
  FROM public.logs AS l
  INNER JOIN public.members AS m ON m.id = l."memberId"
  INNER JOIN public.trainings AS t ON t.id = l."trainingId"
  WHERE l."trainerRole" IN ('main_trainer', 'assistant')
    AND (year_param = '' OR l.date LIKE concat(year_param, '%'))
  ORDER BY l.date DESC, t.section, t.title, l."trainerRole" DESC;
END;
$$;

-----------------
-- Migration Complete
-----------------
-- NOTE: The old "isMainTrainer" column is kept for backward compatibility
-- It will be removed in a future migration after thorough testing
