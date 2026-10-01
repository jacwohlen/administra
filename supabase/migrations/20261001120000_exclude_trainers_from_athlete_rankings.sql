-- Trainers and assistants are logged in the same table as attendees. The
-- athlete rankings counted those sessions too, so trainers appeared in both
-- the trainer and the athlete ranking for the same session. Count only
-- attendee rows for the athlete rankings. Event coaches usually take part as
-- well, so the event participant ranking keeps counting them.

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
