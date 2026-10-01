-- Trainers and assistants are logged in the same table as attendees. The
-- athlete rankings counted those sessions too, so trainers appeared in both
-- the trainer and the athlete ranking for the same session. Count only
-- attendee rows for the athlete rankings, and only non-coach rows for the
-- event participant ranking.

CREATE OR REPLACE FUNCTION public.get_top_athletes(year text)
RETURNS TABLE (
  "memberId"  integer,
  lastname  text,
  firstname text,
  count     bigint
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
    COUNT(*)
  FROM public.logs AS l
  INNER JOIN public.members AS m ON m.id = l."memberId"
  WHERE l."trainerRole" = 'attendee'
    AND l.date LIKE concat(year, '%')
  GROUP BY l."memberId", m.lastname, m.firstname
  ORDER BY COUNT(*) DESC, m.lastname;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_top_athletes_by_section(year text)
RETURNS TABLE (
  section   text,
  "memberId"  integer,
  lastname  text,
  firstname text,
  count     bigint
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
  WHERE l."trainerRole" = 'attendee'
    AND l.date LIKE concat(year, '%')
  GROUP BY t.section, l."memberId", m.lastname, m.firstname
  ORDER BY COUNT(*) DESC, m.lastname;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_top_athletes_from_section(sect text, year text)
RETURNS TABLE (
  rank      bigint,
  section   text,
  "memberId"  integer,
  lastname  text,
  firstname text,
  count     bigint
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
  WHERE l."trainerRole" = 'attendee'
    AND l.date LIKE concat(year, '%')
    AND lower(t.section) = lower(sect)
  GROUP BY t.section, l."memberId", m.lastname, m.firstname
  ORDER BY COUNT(*) DESC, m.lastname;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_top_event_participants(year_param text DEFAULT NULL, section_param text DEFAULT NULL)
RETURNS TABLE (
    section text,
    "memberId" integer,
    lastname text,
    firstname text,
    count bigint,
    rank bigint
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE(e.section, 'Unknown') as section,
        m.id as "memberId",
        m.lastname,
        m.firstname,
        COUNT(el.id) as count,
        RANK() OVER (PARTITION BY e.section ORDER BY COUNT(el.id) DESC) as rank
    FROM public.event_logs el
    JOIN public.events e ON el."eventId" = e.id
    JOIN public.members m ON el."memberId" = m.id
    WHERE
        el."isCoach" = false
        AND (year_param IS NULL OR EXTRACT(YEAR FROM e.date::date) = year_param::integer)
        AND (section_param IS NULL OR e.section = section_param)
    GROUP BY e.section, m.id, m.lastname, m.firstname
    ORDER BY section, count DESC, m.lastname, m.firstname;
END;
$$;
