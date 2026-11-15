-- The API's third use (docs/API.md): the Einsätze report (activity report,
-- docs/ACTIVITY_REPORT.md) for another system, e.g. the treasurer's
-- program. In the app only admins see it; through the API a key with the
-- new scope, which only admins can create, and which is for servers only
-- like event_participants:read (personal data, never in a browser).
--
--   activity_report:read   a new scope
--   api_activity_report()  what the report page loads under RLS for an
--                          admin, for a period: trainer check-ins, the
--                          trainings held, events with their check-ins, the
--                          plan, and the names of the people in it. The
--                          endpoint computes the report from it with
--                          buildActivityReport(), the code the page uses,
--                          so the numbers are the same.
--
-- Granted to anon like the other API functions: the key is the only
-- credential, checked first with api_key_use().

ALTER TABLE public.api_keys DROP CONSTRAINT api_keys_scopes_check;
ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_scopes_check
  CHECK (scopes <@ ARRAY['training_plan:read', 'event_participants:read',
                         'activity_report:read']::text[]);

-- Personal data never in a browser: such a key lists no websites
ALTER TABLE public.api_keys DROP CONSTRAINT api_keys_personal_data_server_only;
ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_personal_data_server_only
  CHECK (NOT (scopes && ARRAY['event_participants:read', 'activity_report:read']::text[])
         OR cardinality(allowed_origins) = 0);

-- The report's data for a period (at most 400 days), for a key with
-- activity_report:read; NULL for any other key. p_member_id: the person
-- the report is asked for, returned as "member" (NULL when there is no such
-- member); the data stays the club's, the endpoint picks the person's rows.
-- Members only with id and name, never contact data, birthday or notes.
CREATE OR REPLACE FUNCTION public.api_activity_report(
  p_key text,
  p_from date,
  p_to date,
  p_member_id integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key public.api_keys;
  v_from text;
  v_to text;
BEGIN
  v_key := public.api_key_use(p_key, 'activity_report:read');
  IF v_key.id IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 400 THEN
    RAISE EXCEPTION 'INVALID_RANGE' USING ERRCODE = '22023';
  END IF;
  -- Dates are 'YYYY-MM-DD' text like everywhere in the app
  v_from := to_char(p_from, 'YYYY-MM-DD');
  v_to := to_char(p_to, 'YYYY-MM-DD');

  RETURN (
    WITH trainer_logs AS (
      SELECT l.date, l."trainingId", l."memberId", l."trainerRole"
      FROM public.logs l
      WHERE l."trainerRole" IN ('main_trainer', 'assistant')
        AND l.date BETWEEN v_from AND v_to
        AND l."memberId" IS NOT NULL
    ),
    evs AS (
      SELECT e.id, e.title, e.date, e.date_to, e.section
      FROM public.events e
      WHERE e.date <= v_to AND coalesce(e.date_to, e.date) >= v_from
    ),
    ev_logs AS (
      SELECT l."eventId", l."memberId", l."isCoach", l."coachDay"
      FROM public.event_logs l
      WHERE l."eventId" IN (SELECT id FROM evs)
    ),
    sessions AS (
      SELECT s.id, s.training_id, s.date, s.trainer_id, s.topic, s.cancelled
      FROM public.training_plan_sessions s
      WHERE s.date BETWEEN v_from AND v_to
    ),
    people AS (
      SELECT "memberId" AS id FROM trainer_logs
      UNION SELECT "memberId" FROM ev_logs WHERE "isCoach"
      UNION SELECT trainer_id FROM sessions WHERE trainer_id IS NOT NULL
      UNION SELECT t."mainTrainerId" FROM public.trainings t
            JOIN public.training_plan_trainings pt ON pt.training_id = t.id
            WHERE t."mainTrainerId" IS NOT NULL
      UNION SELECT p_member_id WHERE p_member_id IS NOT NULL
    )
    SELECT jsonb_build_object(
      'allowed_origins', to_jsonb(v_key.allowed_origins),
      'member', (SELECT jsonb_build_object(
                   'id', m.id,
                   'firstname', btrim(coalesce(m.firstname, '')),
                   'lastname', btrim(coalesce(m.lastname, '')))
                 FROM public.members m WHERE m.id = p_member_id),
      'members', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', m.id,
          'firstname', btrim(coalesce(m.firstname, '')),
          'lastname', btrim(coalesce(m.lastname, ''))
        ) ORDER BY m.id)
        FROM public.members m WHERE m.id IN (SELECT id FROM people)
      ), '[]'::jsonb),
      'trainings', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', t.id,
          'title', t.title,
          'section', t.section,
          'weekday', t.weekday,
          'dateFrom', t."dateFrom",
          'dateTo', t."dateTo",
          'mainTrainerId', t."mainTrainerId"
        ) ORDER BY t.id)
        FROM public.trainings t
      ), '[]'::jsonb),
      'planned_ids', COALESCE((
        SELECT jsonb_agg(pt.training_id ORDER BY pt.training_id)
        FROM public.training_plan_trainings pt
      ), '[]'::jsonb),
      'trainer_logs', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'date', l.date,
          'trainingId', l."trainingId",
          'memberId', l."memberId",
          'trainerRole', l."trainerRole"
        ) ORDER BY l.date, l."trainingId", l."memberId")
        FROM trainer_logs l
      ), '[]'::jsonb),
      -- Every training held, as view_logs_summary gives it to the page
      'held', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'date', v.date,
          'trainingId', v."trainingId",
          'count', v.count,
          'mainTrainerCount', v."mainTrainerCount",
          'totalTrainerCount', v."totalTrainerCount",
          'hasLessonPlan', v."hasLessonPlan"
        ) ORDER BY v.date, v."trainingId")
        FROM public.view_logs_summary v
        WHERE v.date BETWEEN v_from AND v_to
      ), '[]'::jsonb),
      'events', COALESCE((
        SELECT jsonb_agg(to_jsonb(e) ORDER BY e.date, e.id) FROM evs e
      ), '[]'::jsonb),
      'event_logs', COALESCE((
        SELECT jsonb_agg(to_jsonb(l)) FROM ev_logs l
      ), '[]'::jsonb),
      -- The plan without notes (the report never shows them)
      'sessions', COALESCE((
        SELECT jsonb_agg(to_jsonb(s) ORDER BY s.date, s.training_id) FROM sessions s
      ), '[]'::jsonb),
      'breaks', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', b.id,
          'title', b.title,
          'date_from', b.date_from,
          'date_to', b.date_to,
          'cancels_training', b.cancels_training
        ) ORDER BY b.date_from, b.id)
        FROM public.training_plan_breaks b
        WHERE b.date_to >= v_from AND b.date_from <= v_to
      ), '[]'::jsonb)
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.api_activity_report(text, date, date, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.api_activity_report(text, date, date, integer)
  TO anon, authenticated, service_role;
