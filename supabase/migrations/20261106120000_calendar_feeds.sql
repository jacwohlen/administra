-- Trainingsplanung as calendar feeds (ICS) for staff.
--
-- Viewers, trainers and admins subscribe to the training plan in their
-- calendar app: "Meine Trainings" (the dates their member leads) and "Alle
-- Trainings". Calendar apps fetch without a session, so the feed URL carries
-- a secret token per account: /api/calendar/<token>/<feed>.ics. The app
-- builds the calendar from what calendar_feed() returns, with the same plan
-- logic as the plan page (src/lib/calendarFeed.ts, docs/TRAINING_PLAN.md).
--
--   calendar_feeds         one token per account, read only through the
--                          two functions below
--   calendar_feed_token()  the caller's token: created on first use, a new
--                          one on renewal (the old link stops working)
--   calendar_feed(token)   the plan around today, while the token's account
--                          is approved staff; NULL otherwise

CREATE TABLE public.calendar_feeds (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE CHECK (token ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Nobody reads the tokens through the API: RLS without policies, and no
-- grants for the API roles (default privileges from 20260915130000 grant
-- them on every new table, so revoke explicitly).
ALTER TABLE public.calendar_feeds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.calendar_feeds FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.calendar_feeds TO service_role;

-- The caller's feed token, for the subscribe dialog on the plan page. Staff
-- only, like the plan itself. p_renew replaces it: subscriptions with the
-- old link stop working. The upsert keeps an existing token unless renewed,
-- so two first calls at once still agree.
CREATE OR REPLACE FUNCTION public.calendar_feed_token(p_renew boolean DEFAULT false)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.calendar_feeds AS f (user_id, token)
  VALUES (auth.uid(), encode(extensions.gen_random_bytes(32), 'hex'))
  ON CONFLICT (user_id) DO UPDATE
    SET token = CASE WHEN p_renew THEN EXCLUDED.token ELSE f.token END,
        created_at = CASE WHEN p_renew THEN now() ELSE f.created_at END
  RETURNING f.token INTO v_token;

  RETURN v_token;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.calendar_feed_token(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_feed_token(boolean) TO authenticated, service_role;

-- What a feed needs, for the calendar app fetching without a session: the
-- token stands for the account. Only while that account is approved staff
-- (the is_staff() rule for the token's account): a disabled account, or one
-- turned into a member account, gets NULL like an unknown token.
--
-- The window is wider than the feed's (8 weeks back, 12 months ahead in
-- Europe/Zurich), so the app can cut it without a gap at either end.
CREATE OR REPLACE FUNCTION public.calendar_feed(p_token text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    -- The account's members for "Meine Trainings": mirrors my_member_ids()
    -- for staff (20261027120000_member_access_requires_membership.sql), the
    -- linked member and the non-trial members with the account's address;
    -- the membership rule there only applies to member accounts
    'member_ids', COALESCE((
      SELECT jsonb_agg(x.id ORDER BY x.id)
      FROM (
        SELECT m.id FROM public.members m
        WHERE m.id = p.member_id
        UNION
        SELECT m.id FROM public.members m
        WHERE m.email IS NOT NULL
          AND public.normalize_email(m.email) = public.normalize_email(p.email)
          AND NOT public.has_trial_label(m.labels)
      ) x
    ), '[]'::jsonb),
    'trainings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id,
        'title', t.title,
        'weekday', t.weekday,
        'dateFrom', t."dateFrom",
        'dateTo', t."dateTo",
        'section', t.section,
        'mainTrainerId', t."mainTrainerId"
      ) ORDER BY t.id)
      FROM public.trainings t
      JOIN public.training_plan_trainings pt ON pt.training_id = t.id
    ), '[]'::jsonb),
    'sessions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'training_id', s.training_id,
        'date', s.date,
        'trainer_id', s.trainer_id,
        'topic', s.topic,
        'notes', s.notes,
        'cancelled', s.cancelled,
        'updated_at', s.updated_at
      ) ORDER BY s.date, s.training_id)
      FROM public.training_plan_sessions s
      JOIN public.training_plan_trainings pt ON pt.training_id = s.training_id
      WHERE s.date BETWEEN w.date_from AND w.date_to
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
      WHERE b.date_to >= w.date_from AND b.date_from <= w.date_to
    ), '[]'::jsonb),
    -- Names of the planned trainers and the main trainers, nothing else
    'trainers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id,
        'firstname', m.firstname,
        'lastname', m.lastname
      ) ORDER BY m.id)
      FROM public.members m
      WHERE m.id IN (
        SELECT s.trainer_id
        FROM public.training_plan_sessions s
        JOIN public.training_plan_trainings pt ON pt.training_id = s.training_id
        WHERE s.date BETWEEN w.date_from AND w.date_to
        UNION
        SELECT t."mainTrainerId"
        FROM public.trainings t
        JOIN public.training_plan_trainings pt ON pt.training_id = t.id
      )
    ), '[]'::jsonb)
  )
  FROM public.calendar_feeds f
  JOIN public.user_profiles p ON p.user_id = f.user_id
  CROSS JOIN (
    -- Dates are 'YYYY-MM-DD' text like everywhere in the plan
    SELECT to_char(current_date - 70, 'YYYY-MM-DD') AS date_from,
           to_char(current_date + 400, 'YYYY-MM-DD') AS date_to
  ) w
  WHERE p_token IS NOT NULL
    AND f.token = p_token
    AND p.status = 'approved'
    AND p.role IN ('viewer', 'trainer', 'admin');
$$;

-- The feed route calls it with the anon key (calendar apps send no cookie),
-- or as authenticated when a signed-in user opens the link in the browser
REVOKE EXECUTE ON FUNCTION public.calendar_feed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calendar_feed(text) TO anon, authenticated, service_role;
