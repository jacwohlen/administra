-- Lizenznummer and the J+S module (docs/JS_EXPORT.md, docs/INTEGRATIONS.md)
--
--   members.license_number   the member's licence number, which J+S uses as
--                            its person number (PERSONENNUMMER). A member
--                            field like the name: owned by the provider when
--                            the member comes from one (Webling's
--                            "Lizenznummer"), else entered in the app.
--   integration layer        takes license_number in member records
--                            (capabilities member_keys); Webling owns it
--   integration_connections  'js': the J+S module, off until an admin
--                            switches it on. Admins switch every connection
--                            on and off (integration_set_enabled); a
--                            disabled one is skipped by the sync
--                            (CONNECTION_DISABLED) and hidden in the app
--   js_courses,              the club's J+S courses and their trainings, for
--   js_course_trainings      the CSV export to the NDS

ALTER TABLE public.members ADD COLUMN license_number text
  CONSTRAINT members_license_number_valid
  CHECK (license_number IS NULL OR (btrim(license_number) <> '' AND length(license_number) <= 40));

-----------------
-- Integration layer: member.license_number
-----------------

-- As in 20261030120000, plus member.license_number
CREATE OR REPLACE FUNCTION public.integration_field_policy_ok(p jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN jsonb_typeof(p) IS DISTINCT FROM 'object' THEN false ELSE NOT EXISTS (
    SELECT 1 FROM jsonb_each(p) e
     WHERE e.key NOT IN ('member.firstname', 'member.lastname', 'member.birthday', 'member.mobile',
                         'member.email', 'member.labels', 'member.license_number',
                         'event.title', 'event.date', 'event.date_to', 'event.all_day', 'event.timeFrom',
                         'event.timeTo', 'event.location', 'event.section', 'event.maxParticipants',
                         'event.description',
                         'break.title', 'break.date_from', 'break.date_to', 'break.cancels_training')
        OR jsonb_typeof(e.value) <> 'string'
        OR (e.value #>> '{}') NOT IN ('owned', 'fill', 'initial'))
  END;
$$;

-- As in 20261029120000, plus license_number (trimmed, blank is none)
CREATE OR REPLACE FUNCTION public.integration_normalize_member(p jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH f AS (
    SELECT
      nullif(btrim(coalesce(public.integration_text(p->'lastname'), '')), '') AS lastname,
      public.integration_text(p->'birthday') AS birthday,
      CASE WHEN p->>'problem' ~ '^[a-z_]{1,40}$' THEN p->>'problem' END AS problem,
      CASE WHEN public.integration_text(p->'link_to') ~ '^[1-9]\d{0,8}$'
           THEN (public.integration_text(p->'link_to'))::integer END AS link_to,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('key', coalesce(y.id, y.name), 'name', y.name)
                                 ORDER BY y.ord), '[]'::jsonb)
         FROM (SELECT x.ord,
                      CASE jsonb_typeof(x.g) WHEN 'object' THEN nullif(btrim(public.integration_text(x.g->'id')), '') END AS id,
                      -- names as sent (labels are compared exactly), blank ones dropped
                      CASE WHEN btrim(coalesce(CASE jsonb_typeof(x.g) WHEN 'string' THEN x.g #>> '{}'
                                                                      WHEN 'object' THEN x.g->>'name' END, '')) <> ''
                           THEN CASE jsonb_typeof(x.g) WHEN 'string' THEN x.g #>> '{}' ELSE x.g->>'name' END
                      END AS name
                 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p->'groups') = 'array'
                                                THEN p->'groups' ELSE '[]'::jsonb END)
                      WITH ORDINALITY x(g, ord)) y
        WHERE y.name IS NOT NULL) AS groups
  ), v AS (
    SELECT f.*,
           f.birthday IS NOT NULL AND f.birthday <> ''
             AND public.integration_iso_date(f.birthday, '1900-01-01', '2100-12-31') IS NULL AS bad_birthday
      FROM f
  )
  SELECT jsonb_strip_nulls(jsonb_build_object(
           'lastname', v.lastname,
           'link_to', v.link_to,
           'problem', coalesce(v.problem, CASE WHEN v.lastname IS NULL THEN 'missing_lastname' END)))
      || CASE WHEN p ? 'firstname'
              THEN jsonb_build_object('firstname', btrim(coalesce(public.integration_text(p->'firstname'), '')))
              ELSE '{}'::jsonb END
      || CASE WHEN p ? 'birthday' AND NOT v.bad_birthday
              THEN jsonb_build_object('birthday', v.birthday) ELSE '{}'::jsonb END
      || CASE WHEN p ? 'mobile' THEN jsonb_build_object('mobile', public.integration_text(p->'mobile'))
              ELSE '{}'::jsonb END
      || CASE WHEN p ? 'email' THEN jsonb_build_object('email', btrim(public.integration_text(p->'email')))
              ELSE '{}'::jsonb END
      || CASE WHEN p ? 'license_number'
              THEN jsonb_build_object('license_number', nullif(btrim(coalesce(public.integration_text(p->'license_number'), '')), ''))
              ELSE '{}'::jsonb END
      || CASE WHEN p ? 'groups' THEN jsonb_build_object('groups', v.groups) ELSE '{}'::jsonb END
      || jsonb_build_object('invalid', CASE WHEN v.bad_birthday THEN '["birthday"]'::jsonb ELSE '[]'::jsonb END)
  FROM v;
$$;

-- As in 20261029120000, plus license_number
CREATE OR REPLACE FUNCTION public.integration_write_member(
  p_c public.integration_connections, p_r public.integration_records, p_now timestamptz
)
RETURNS text
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pol jsonb := p_c.field_policy;
  d jsonb := p_r.data;
  v_creating boolean := p_r.action = 'insert';
  v_id integer := p_r.target_id;
  m public.members%ROWTYPE;
  v_first text;
  v_last text;
  v_birth text;
  v_mobile text;
  v_email text;
  v_license text;
  v_labels jsonb;
  v_n integer;
BEGIN
  IF v_creating THEN
    IF v_id IS NULL THEN
      v_id := nextval(pg_get_serial_sequence('public.members', 'id'));
    END IF;
    INSERT INTO public.members (id, firstname, lastname, birthday, mobile, license_number, labels)
    VALUES (v_id,
            coalesce(public.integration_pick(v_pol->>'member.firstname', d ? 'firstname', d->>'firstname', NULL, true),
                     d->>'firstname', ''),
            coalesce(public.integration_pick(v_pol->>'member.lastname', true, d->>'lastname', NULL, true),
                     d->>'lastname'),
            public.integration_pick(v_pol->>'member.birthday', d ? 'birthday', d->>'birthday', NULL, true),
            public.integration_pick(v_pol->>'member.mobile', d ? 'mobile', d->>'mobile', NULL, true),
            public.integration_pick(v_pol->>'member.license_number', d ? 'license_number', d->>'license_number', NULL, true),
            CASE WHEN v_pol ? 'member.labels' AND p_r.labels IS NOT NULL THEN p_r.labels ELSE '[]'::jsonb END);
    INSERT INTO public.member_links (connection, external_id, member_id, last_seen_at)
    VALUES (p_c.id, p_r.external_id, v_id, p_now);
    v_email := public.integration_pick(v_pol->>'member.email', d ? 'email', d->>'email', NULL, true);
    IF nullif(v_email, '') IS NOT NULL THEN
      UPDATE public.members SET email = v_email WHERE id = v_id;
    END IF;
    UPDATE public.integration_records SET target_id = v_id
     WHERE run_id = p_r.run_id AND external_id = p_r.external_id;
    RETURN 'inserted';
  END IF;

  IF p_r.action = 'adopt' THEN
    INSERT INTO public.member_links (connection, external_id, member_id, last_seen_at)
    VALUES (p_c.id, p_r.external_id, v_id, p_now);
  END IF;

  SELECT * INTO m FROM public.members WHERE id = v_id FOR UPDATE;
  v_first := coalesce(public.integration_pick(v_pol->>'member.firstname', d ? 'firstname', d->>'firstname', m.firstname, false), '');
  v_last := coalesce(public.integration_pick(v_pol->>'member.lastname', d ? 'lastname', d->>'lastname', m.lastname, false), m.lastname);
  v_birth := public.integration_pick(v_pol->>'member.birthday', d ? 'birthday', d->>'birthday', m.birthday, false);
  v_mobile := public.integration_pick(v_pol->>'member.mobile', d ? 'mobile', d->>'mobile', m.mobile, false);
  v_email := public.integration_pick(v_pol->>'member.email', d ? 'email', d->>'email', m.email, false);
  v_license := public.integration_pick(v_pol->>'member.license_number', d ? 'license_number', d->>'license_number',
                                       m.license_number, false);
  v_labels := CASE
    WHEN NOT (d ? 'groups') OR p_r.labels IS NULL THEN m.labels
    WHEN v_pol->>'member.labels' = 'owned' THEN p_r.labels
    WHEN v_pol->>'member.labels' = 'fill' AND jsonb_array_length(p_r.labels) > 0 THEN p_r.labels
    ELSE m.labels END;

  UPDATE public.members
     SET firstname = v_first, lastname = v_last, birthday = v_birth, mobile = v_mobile,
         email = v_email, license_number = v_license, labels = v_labels
   WHERE id = v_id
     AND (firstname, lastname, birthday, mobile, email, license_number, labels)
         IS DISTINCT FROM (v_first, v_last, v_birth, v_mobile, v_email, v_license, v_labels);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- Back in the provider: the link trigger derives the status from the labels just written
  IF p_r.action = 'revive' THEN
    UPDATE public.member_links SET gone_at = NULL, last_seen_at = p_now
     WHERE connection = p_c.id AND external_id = p_r.external_id;
  END IF;

  RETURN CASE p_r.action WHEN 'adopt' THEN 'adopted' WHEN 'revive' THEN 'revived'
                         ELSE CASE WHEN v_n > 0 THEN 'updated' ELSE 'unchanged' END END;
END;
$$;

-- As in 20261101120000, plus license_number in member_keys, and a disabled
-- connection is CONNECTION_DISABLED (PT423) instead of UNKNOWN_CONNECTION,
-- so the sync can tell "switched off" from a wrong connection id
CREATE OR REPLACE FUNCTION public.integration_begin(
  p_connection text,
  p_kind text,
  p_options jsonb DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_c public.integration_connections%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Europe/Zurich')::date;
  v_options jsonb := CASE WHEN jsonb_typeof(p_options) = 'object' THEN p_options ELSE '{}'::jsonb END;
  v_in jsonb;
  v_scope jsonb;
  v_listed jsonb;
  v_gone jsonb;
  v_trigger text;
  v_runner text;
  v_id bigint;
BEGIN
  PERFORM public.integration_authorize(p_connection);
  SELECT * INTO v_c FROM public.integration_connections WHERE id = p_connection;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNKNOWN_CONNECTION' USING ERRCODE = 'P0001';
  END IF;
  -- Switched off on the Integrations page: the sync skips it (exit 0)
  IF NOT v_c.enabled THEN
    RAISE EXCEPTION 'CONNECTION_DISABLED' USING ERRCODE = 'PT423';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('members', 'events') THEN
    RAISE EXCEPTION 'invalid kind' USING ERRCODE = '22023';
  END IF;

  v_in := CASE WHEN jsonb_typeof(v_options->'scope') = 'object' THEN v_options->'scope' ELSE '{}'::jsonb END;
  IF p_kind = 'members' THEN
    v_scope := jsonb_build_object('complete', coalesce(v_in->>'complete' = 'true', false));
  ELSE
    IF v_in ? 'calendars' AND jsonb_typeof(v_in->'calendars') <> 'array' THEN
      RAISE EXCEPTION 'invalid scope' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_in->'calendars', '[]'::jsonb)) x
                WHERE coalesce(public.integration_text(x), '') !~ '^[A-Za-z0-9_.:@/+=-]{1,200}$') THEN
      RAISE EXCEPTION 'invalid scope: calendar ids' USING ERRCODE = '22023';
    END IF;
    v_scope := jsonb_build_object(
      'complete', coalesce(v_in->>'complete' = 'true', false),
      'calendars', (SELECT coalesce(jsonb_agg(DISTINCT x), '[]'::jsonb)
                      FROM jsonb_array_elements_text(coalesce(v_in->'calendars', '[]'::jsonb)) x),
      'from', coalesce(public.integration_iso_date(v_in->>'from', '1900-01-01', '2200-12-31'),
                       to_char(date_trunc('year', v_today), 'YYYY-MM-DD')));
    -- Every calendar the provider has: never empty (the adapter cannot
    -- have read the list then), ids as above, and it holds those read
    IF v_in ? 'provider_calendars' THEN
      IF jsonb_typeof(v_in->'provider_calendars') <> 'array'
         OR jsonb_array_length(v_in->'provider_calendars') = 0 THEN
        RAISE EXCEPTION 'invalid scope: provider calendars' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_in->'provider_calendars') x
                  WHERE coalesce(public.integration_text(x), '') !~ '^[A-Za-z0-9_.:@/+=-]{1,200}$') THEN
        RAISE EXCEPTION 'invalid scope: calendar ids' USING ERRCODE = '22023';
      END IF;
      v_listed := (SELECT jsonb_agg(DISTINCT x)
                     FROM jsonb_array_elements_text(v_in->'provider_calendars') x);
      IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_scope->'calendars') x WHERE NOT v_listed ? x) THEN
        RAISE EXCEPTION 'invalid scope: a calendar read is not among the provider calendars'
          USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;
  v_trigger := coalesce(v_options->>'trigger',
                        CASE WHEN public.integration_is_service() THEN 'schedule' ELSE 'app' END);
  IF v_trigger NOT IN ('schedule', 'manual', 'app') THEN
    RAISE EXCEPTION 'invalid trigger' USING ERRCODE = '22023';
  END IF;
  v_runner := CASE WHEN v_options->>'runner' ~ '^[a-z]{1,20}:[A-Za-z0-9._-]{1,60}$' THEN v_options->>'runner' END;

  PERFORM pg_advisory_xact_lock(hashtext('integration:' || p_connection || ':' || p_kind));
  -- A run left open for an hour (runner killed; the workflow stops after
  -- 30 minutes): never applied is failed, applied but not finished a warning
  UPDATE public.integration_runs
     SET status = CASE status WHEN 'applied' THEN 'warning' ELSE 'failed' END,
         error = CASE status WHEN 'applied' THEN 'not_finished' ELSE 'abandoned' END,
         finished_at = now()
   WHERE status IN ('running', 'applied') AND started_at < now() - interval '1 hour';
  -- Staged records of closed runs (any connection): no personal data stays
  DELETE FROM public.integration_records r
   USING public.integration_runs u
   WHERE r.run_id = u.id AND (u.finished_at IS NOT NULL OR u.status NOT IN ('running', 'applied'));
  IF EXISTS (SELECT 1 FROM public.integration_runs
              WHERE connection = p_connection AND kind = p_kind AND status IN ('running', 'applied')) THEN
    RAISE EXCEPTION 'RUN_IN_PROGRESS' USING ERRCODE = 'PT409';
  END IF;
  -- Housekeeping: runs for 400 days, issues half a year after they closed
  -- (a dismissed issue only once no run has seen it for half a year)
  DELETE FROM public.integration_runs WHERE started_at < now() - interval '400 days';
  DELETE FROM public.integration_issues
   WHERE (resolved_at < now() - interval '180 days')
      OR (dismissed_at IS NOT NULL AND last_seen_at < now() - interval '180 days');

  -- Calendars the provider no longer has count as read completely, with
  -- no records (under the run lock, so the catalog is the one this run sees)
  IF v_listed IS NOT NULL AND (v_scope->>'complete')::boolean THEN
    SELECT coalesce(jsonb_agg(ic.external_id ORDER BY ic.external_id), '[]'::jsonb)
      INTO v_gone
      FROM public.integration_calendars ic
     WHERE ic.connection = p_connection AND ic.external_id IS NOT NULL AND NOT v_listed ? ic.external_id;
    v_scope := v_scope || jsonb_build_object(
      'calendars', (SELECT coalesce(jsonb_agg(DISTINCT x), '[]'::jsonb)
                      FROM (SELECT jsonb_array_elements_text(v_scope->'calendars')
                            UNION SELECT jsonb_array_elements_text(v_gone)) t(x)),
      'calendars_gone', v_gone);
    UPDATE public.integration_calendars
       SET gone_at = now()
     WHERE connection = p_connection AND gone_at IS NULL AND v_gone ? external_id;
    UPDATE public.integration_calendars
       SET gone_at = NULL
     WHERE connection = p_connection AND gone_at IS NOT NULL AND v_listed ? external_id;
  END IF;

  INSERT INTO public.integration_runs (connection, kind, scope, trigger, runner, dry_run)
  VALUES (p_connection, p_kind, v_scope, v_trigger, v_runner, coalesce(v_options->>'dry_run' = 'true', false))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'run', v_id,
    'kind', p_kind,
    'scope', v_scope,
    'today', to_char(v_today, 'YYYY-MM-DD'),
    'settings', v_c.settings,
    'capabilities', jsonb_build_object(
      'version', 3,
      'member_keys', jsonb_build_array('firstname', 'lastname', 'birthday', 'mobile', 'email', 'groups',
                                       'license_number', 'link_to', 'problem'),
      'event_keys', jsonb_build_array('calendar', 'title', 'starts_on', 'ends_on', 'all_day', 'time_from',
                                      'time_to', 'location', 'max_participants', 'description', 'url',
                                      'cancelled', 'participants', 'problem'),
      'calendar_targets', jsonb_build_array('event', 'break', 'ignore'),
      'max_records_per_call', 1000)
  );
END;
$$;

-- Webling owns the licence number like the name: read-only in the app while
-- linked, cleared when Webling has none. An older adapter does not send the
-- key, so nothing changes until it does.
UPDATE public.integration_connections
   SET field_policy = field_policy || '{"member.license_number": "owned"}'
 WHERE id = 'webling';

-----------------
-- Modules on and off
-----------------

-- The J+S module has no sync: runs_in 'sync' means nobody can open a run
-- for it from the app, and no runner does
INSERT INTO public.integration_connections (id, provider, display_name, enabled, runs_in)
VALUES ('js', 'js', 'J+S (NDS)', false, 'sync')
ON CONFLICT (id) DO NOTHING;

-- Admins switch a connection on or off. Off: the sync skips it, the app
-- hides what belongs to it; its links, runs and data stay.
CREATE OR REPLACE FUNCTION public.integration_set_enabled(p_connection text, p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'invalid value' USING ERRCODE = '22023';
  END IF;
  UPDATE public.integration_connections SET enabled = p_enabled WHERE id = p_connection;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNKNOWN_CONNECTION' USING ERRCODE = 'P0001';
  END IF;
  RETURN p_enabled;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.integration_set_enabled(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.integration_set_enabled(text, boolean) TO authenticated;

-----------------
-- J+S courses
-----------------

CREATE TABLE public.js_courses (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  -- Course number in the NDS; empty until the course is approved there.
  course_number text NOT NULL DEFAULT '',
  title text NOT NULL CHECK (btrim(title) <> ''),
  date_from date NOT NULL,
  date_to date NOT NULL,
  -- ORT of every training, required by the NDS
  location text NOT NULL DEFAULT '',
  -- Allowed training durations in minutes; depend on the course's user
  -- group and main sport. Default: NG 1, Art. 1 Abs. 1 J+S-V-BASPO.
  durations smallint[] NOT NULL DEFAULT '{60,75,90}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT js_courses_dates_valid CHECK (date_from <= date_to)
);

CREATE TABLE public.js_course_trainings (
  course_id integer NOT NULL REFERENCES public.js_courses (id) ON DELETE CASCADE,
  training_id smallint NOT NULL REFERENCES public.trainings (id) ON DELETE CASCADE,
  PRIMARY KEY (course_id, training_id)
);

CREATE INDEX js_course_trainings_training_id_idx ON public.js_course_trainings (training_id);

ALTER TABLE public.js_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.js_course_trainings ENABLE ROW LEVEL SECURITY;

CREATE POLICY js_courses_read ON public.js_courses
  FOR SELECT TO authenticated USING ((SELECT public.is_staff()));
CREATE POLICY js_courses_insert ON public.js_courses
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_writer()));
CREATE POLICY js_courses_update ON public.js_courses
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_writer()))
  WITH CHECK ((SELECT public.is_writer()));
CREATE POLICY js_courses_delete ON public.js_courses
  FOR DELETE TO authenticated USING ((SELECT public.is_writer()));

CREATE POLICY js_course_trainings_read ON public.js_course_trainings
  FOR SELECT TO authenticated USING ((SELECT public.is_staff()));
CREATE POLICY js_course_trainings_insert ON public.js_course_trainings
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_writer()));
CREATE POLICY js_course_trainings_delete ON public.js_course_trainings
  FOR DELETE TO authenticated USING ((SELECT public.is_writer()));

REVOKE ALL ON public.js_courses, public.js_course_trainings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.js_courses TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.js_course_trainings TO authenticated;
GRANT ALL ON public.js_courses, public.js_course_trainings TO service_role;
