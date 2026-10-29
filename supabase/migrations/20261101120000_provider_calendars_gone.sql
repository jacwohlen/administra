-- Calendars the provider no longer has (docs/INTEGRATIONS.md).
--
-- A complete events run settles only the calendars it read (scope
-- calendars): their links not seen go, their open issues resolve. A
-- calendar deleted at the provider is never read again, so its issues
-- stayed open for good, its linked events stayed linked (read-only in the
-- app) and the mapping kept listing it.
--
-- An adapter that knows every calendar the provider has now sends them as
-- scope.provider_calendars (capabilities version 3; an older database
-- ignores the key). A complete run then also settles the catalog's
-- calendars missing from that list: they count as read, with no records,
-- so the existing rules apply unchanged. Their events and holidays go
-- (within the window, under the events gone guard), their issues resolve,
-- and the catalog marks them gone_at until the provider lists them again.

ALTER TABLE public.integration_calendars ADD COLUMN gone_at timestamptz;

COMMENT ON COLUMN public.integration_calendars.gone_at IS
  'When a run''s complete calendar list (scope provider_calendars) first lacked this calendar; NULL once listed again';

-- As in 20261030120000, plus scope.provider_calendars (capabilities 3):
-- events {complete, calendars, provider_calendars: [every calendar id the
-- provider has], from}. The calendars read must be among them. With a
-- complete scope, catalog calendars of the connection not in the list are
-- added to scope.calendars and listed as scope.calendars_gone, and the
-- catalog marks them (also for a dry or refused run: a fact about the
-- provider, like the registration of new calendars).
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
  IF NOT FOUND OR NOT v_c.enabled THEN
    RAISE EXCEPTION 'UNKNOWN_CONNECTION' USING ERRCODE = 'P0001';
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
                                       'link_to', 'problem'),
      'event_keys', jsonb_build_array('calendar', 'title', 'starts_on', 'ends_on', 'all_day', 'time_from',
                                      'time_to', 'location', 'max_participants', 'description', 'url',
                                      'cancelled', 'participants', 'problem'),
      'calendar_targets', jsonb_build_array('event', 'break', 'ignore'),
      'max_records_per_call', 1000)
  );
END;
$$;

-- As in 20261029120000; a calendar the provider no longer has is nothing
-- left to review
CREATE OR REPLACE FUNCTION public.integration_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (public.integration_is_service() OR public.is_admin()) THEN
    RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'provider', c.provider,
      'display_name', c.display_name,
      'enabled', c.enabled,
      'runs_in', c.runs_in,
      'members', (SELECT jsonb_build_object(
                          'linked', count(*) FILTER (WHERE l.gone_at IS NULL),
                          'gone', count(*) FILTER (WHERE l.gone_at IS NOT NULL),
                          'last_seen_at', max(l.last_seen_at))
                    FROM public.member_links l WHERE l.connection = c.id),
      'events', (SELECT jsonb_build_object(
                         'linked', count(*) FILTER (WHERE l.gone_at IS NULL),
                         'gone', count(*) FILTER (WHERE l.gone_at IS NOT NULL),
                         'last_seen_at', max(l.last_seen_at))
                   FROM public.event_links l WHERE l.connection = c.id),
      'breaks', (SELECT count(*) FROM public.training_plan_breaks b WHERE b.connection = c.id),
      'to_review', jsonb_build_object(
         'groups', (SELECT count(*) FROM public.integration_member_groups g
                     WHERE g.connection = c.id AND NOT g.reviewed),
         'calendars', (SELECT count(*) FROM public.integration_calendars ic
                        WHERE ic.connection = c.id AND NOT ic.reviewed AND ic.gone_at IS NULL)),
      'last_run', (SELECT coalesce(jsonb_object_agg(k.kind, (
                          SELECT jsonb_build_object('id', r.id, 'status', r.status, 'dry_run', r.dry_run,
                                                    'started_at', r.started_at, 'finished_at', r.finished_at,
                                                    'refused', r.guard->>'refused', 'error', r.error)
                            FROM public.integration_runs r
                           WHERE r.connection = c.id AND r.kind = k.kind AND NOT r.dry_run
                           ORDER BY r.started_at DESC, r.id DESC LIMIT 1)), '{}'::jsonb)
                     FROM (VALUES ('members'), ('events'), ('config')) k(kind)),
      'last_success', (SELECT coalesce(jsonb_object_agg(k.kind, (
                             SELECT max(r.finished_at) FROM public.integration_runs r
                              WHERE r.connection = c.id AND r.kind = k.kind AND NOT r.dry_run
                                AND r.status IN ('ok', 'warning'))), '{}'::jsonb)
                        FROM (VALUES ('members'), ('events')) k(kind)),
      'issues', (SELECT jsonb_build_object(
                          'error', count(*) FILTER (WHERE i.severity = 'error'),
                          'warning', count(*) FILTER (WHERE i.severity = 'warning'),
                          'info', count(*) FILTER (WHERE i.severity = 'info'))
                   FROM public.integration_issues i
                  WHERE i.connection = c.id AND i.resolved_at IS NULL AND i.dismissed_at IS NULL)
    ) ORDER BY c.id), '[]'::jsonb)
    FROM public.integration_connections c);
END;
$$;
