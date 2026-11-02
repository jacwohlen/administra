-- Alleda's API for other systems (docs/API.md), first for the club's
-- website showing the training plan.
--
-- Other systems call the app's endpoints under /api/v1/ with an API key an
-- admin created: `Authorization: Bearer alleda_<48 hex>`. The key is shown
-- once; the database keeps only its SHA-256. A key carries scopes (what it
-- may read, so far only training_plan:read), the origins a browser may read
-- the answers from (CORS) and how trainers are named.
--
--   api_keys              the keys, admins read and change them (never the
--                         hash) and delete them to revoke
--   api_key_create()      a new key for admins, the plaintext returned once
--   api_key_use()         the key's row for a valid key with the scope
--                         (internal, not callable through the API)
--   api_training_plan()   the public part of the training plan for a key
--                         with training_plan:read; granted to anon, the key
--                         is the only credential

CREATE TABLE public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  -- The first characters after "alleda_", to recognise a key in the list
  prefix text NOT NULL CHECK (prefix ~ '^[0-9a-f]{8}$'),
  key_hash text NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] NOT NULL DEFAULT '{}'
    CHECK (scopes <@ ARRAY['training_plan:read']::text[]),
  -- Origins like https://www.example.ch whose pages may read the answers in
  -- the browser; empty: only servers (no CORS)
  allowed_origins text[] NOT NULL DEFAULT '{}'
    CHECK (array_position(allowed_origins, NULL) IS NULL),
  -- How the training plan names trainers: full (Anna Muster), initial
  -- (Anna M.) or none
  trainer_names text NOT NULL DEFAULT 'full'
    CHECK (trainer_names IN ('full', 'initial', 'none')),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

-- Origins are compared as the browser sends them: scheme, host and port,
-- lower case, no path or trailing slash
CREATE OR REPLACE FUNCTION public.api_origin_valid(p_origin text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_origin ~ '^https?://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$';
$$;

CREATE OR REPLACE FUNCTION public.api_origins_valid(p_origins text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(bool_and(public.api_origin_valid(o)), true) FROM unnest(p_origins) o;
$$;

ALTER TABLE public.api_keys
  ADD CONSTRAINT api_keys_origins_valid CHECK (public.api_origins_valid(allowed_origins));

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- Admins list, rename, change and delete (revoke) keys; new keys only
-- through api_key_create(), so the key is made in the database. The hash
-- stays unreadable: column grants without key_hash.
REVOKE ALL ON public.api_keys FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, name, prefix, scopes, allowed_origins, trainer_names, created_by, created_at,
              last_used_at)
  ON public.api_keys TO authenticated;
GRANT UPDATE (name, scopes, allowed_origins, trainer_names) ON public.api_keys TO authenticated;
GRANT DELETE ON public.api_keys TO authenticated;
GRANT ALL ON public.api_keys TO service_role;

CREATE POLICY "Admins read API keys" ON public.api_keys
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "Admins change API keys" ON public.api_keys
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admins revoke API keys" ON public.api_keys
  FOR DELETE TO authenticated USING (public.is_admin());

-- A new key: returns its id and the plaintext key, which is never shown
-- again. Admins only.
CREATE OR REPLACE FUNCTION public.api_key_create(
  p_name text,
  p_scopes text[],
  p_allowed_origins text[] DEFAULT '{}',
  p_trainer_names text DEFAULT 'full'
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text := encode(extensions.gen_random_bytes(24), 'hex');
  v_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.api_keys (name, prefix, key_hash, scopes, allowed_origins, trainer_names,
                               created_by)
  VALUES (btrim(p_name), left(v_secret, 8),
          encode(extensions.digest('alleda_' || v_secret, 'sha256'), 'hex'),
          coalesce(p_scopes, '{}'), coalesce(p_allowed_origins, '{}'),
          coalesce(p_trainer_names, 'full'), auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'key', 'alleda_' || v_secret);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.api_key_create(text, text[], text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.api_key_create(text, text[], text[], text)
  TO authenticated, service_role;

-- The row of a valid key that has the scope, else nothing. Notes the use
-- at most once a minute, so a busy website does not write on every call.
-- Internal: only the API functions below call it.
CREATE OR REPLACE FUNCTION public.api_key_use(p_key text, p_scope text)
RETURNS public.api_keys
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key public.api_keys;
BEGIN
  IF p_key IS NULL OR p_key !~ '^alleda_[0-9a-f]{48}$' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_key FROM public.api_keys
  WHERE key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')
    AND p_scope = ANY (scopes);
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_key.last_used_at IS NULL OR v_key.last_used_at < now() - interval '1 minute' THEN
    UPDATE public.api_keys SET last_used_at = now() WHERE id = v_key.id;
  END IF;
  RETURN v_key;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.api_key_use(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_key_use(text, text) TO service_role;

-- The public part of the training plan between two dates (at most 400
-- days apart), for a key with training_plan:read; NULL for any other key.
-- What the website may show: the planned trainings, their sessions without
-- notes, the holidays, and the trainers' names as the key says (none: no
-- names at all). The app computes the dates with buildPlan(), as on the
-- plan page and in the calendar feeds (src/lib/publicApi.ts).
CREATE OR REPLACE FUNCTION public.api_training_plan(p_key text, p_from date, p_to date)
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
  v_key := public.api_key_use(p_key, 'training_plan:read');
  IF v_key.id IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 400 THEN
    RAISE EXCEPTION 'INVALID_RANGE' USING ERRCODE = '22023';
  END IF;
  -- Dates are 'YYYY-MM-DD' text like everywhere in the plan
  v_from := to_char(p_from, 'YYYY-MM-DD');
  v_to := to_char(p_to, 'YYYY-MM-DD');

  RETURN jsonb_build_object(
    'allowed_origins', to_jsonb(v_key.allowed_origins),
    'trainings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id,
        'title', t.title,
        'weekday', t.weekday,
        'dateFrom', t."dateFrom",
        'dateTo', t."dateTo",
        'section', t.section,
        'mainTrainerId', CASE WHEN v_key.trainer_names <> 'none' THEN t."mainTrainerId" END
      ) ORDER BY t.id)
      FROM public.trainings t
      JOIN public.training_plan_trainings pt ON pt.training_id = t.id
    ), '[]'::jsonb),
    'sessions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'training_id', s.training_id,
        'date', s.date,
        'trainer_id', CASE WHEN v_key.trainer_names <> 'none' THEN s.trainer_id END,
        'topic', s.topic,
        'cancelled', s.cancelled
      ) ORDER BY s.date, s.training_id)
      FROM public.training_plan_sessions s
      JOIN public.training_plan_trainings pt ON pt.training_id = s.training_id
      WHERE s.date BETWEEN v_from AND v_to
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
    ), '[]'::jsonb),
    -- Only the names, formatted here so a key without names never gets one
    'trainers', CASE WHEN v_key.trainer_names = 'none' THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id,
        'name', CASE v_key.trainer_names
          WHEN 'initial' THEN btrim(btrim(coalesce(m.firstname, '')) || ' '
            || CASE WHEN btrim(coalesce(m.lastname, '')) <> ''
                    THEN left(btrim(m.lastname), 1) || '.' ELSE '' END)
          ELSE btrim(btrim(coalesce(m.firstname, '')) || ' ' || btrim(coalesce(m.lastname, '')))
        END
      ) ORDER BY m.id)
      FROM public.members m
      WHERE m.id IN (
        SELECT s.trainer_id
        FROM public.training_plan_sessions s
        JOIN public.training_plan_trainings pt ON pt.training_id = s.training_id
        WHERE s.date BETWEEN v_from AND v_to
        UNION
        SELECT t."mainTrainerId"
        FROM public.trainings t
        JOIN public.training_plan_trainings pt ON pt.training_id = t.id
      )
    ), '[]'::jsonb) END
  );
END;
$$;

-- The API route calls it with the anon key: other systems have no session
REVOKE EXECUTE ON FUNCTION public.api_training_plan(text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.api_training_plan(text, date, date)
  TO anon, authenticated, service_role;
