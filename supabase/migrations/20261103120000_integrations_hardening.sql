-- Integrations hardening after phase 3c (docs/INTEGRATIONS.md).
--
-- member_status_from_labels() is no API function any more: the legacy
-- sync's guard called it through PostgREST (20261028100000), and since
-- phase 3c only the database does, through member_status_for() and the
-- triggers that derive membership_status. Those run as the owner (SECURITY
-- DEFINER), so staff edits, trial registrations and the layer derive the
-- status as before (supabase/checks/integration_layer.sql).
--
-- A connection's settings.record_urls links to its records in the
-- provider. record_urls.event is the address of an event, with {id} (once)
-- for its external id, https only; the Integrations page links an issue
-- about an event to it ("In Webling öffnen"). Filled here from the live
-- event links, which hold Webling's portal links since phase 3; a database
-- without links gets none.

-----------------
-- The status rule is internal
-----------------

REVOKE EXECUTE ON FUNCTION public.member_status_from_labels(jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;

-----------------
-- Links to a provider's records: settings.record_urls
-----------------

-- The event template of each connection from its live event links: when
-- every one that has a url ends with its own external id and the part
-- before it is the same for all, that part plus {id}. Only a part with the
-- host complete (https://host/...) and without {id} counts, so the id can
-- only fill the path. A template already set is kept, as are other keys
-- of record_urls. Returns the number of connections filled. Run once below;
-- kept for the checks and for a connection whose first links come later.
CREATE OR REPLACE FUNCTION public.integration_fill_record_urls()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_filled integer;
BEGIN
  WITH t AS (
    SELECT l.connection, min(left(l.url, length(l.url) - length(l.external_id))) AS prefix
      FROM public.event_links l
     WHERE l.gone_at IS NULL AND l.url IS NOT NULL
     GROUP BY l.connection
    HAVING bool_and(length(l.url) > length(l.external_id) AND right(l.url, length(l.external_id)) = l.external_id)
       AND count(DISTINCT left(l.url, length(l.url) - length(l.external_id))) = 1
  )
  UPDATE public.integration_connections c
     SET settings = c.settings || jsonb_build_object('record_urls',
           coalesce(c.settings->'record_urls', '{}'::jsonb) || jsonb_build_object('event', t.prefix || '{id}')),
         updated_at = now()
    FROM t
   WHERE t.connection = c.id
     AND t.prefix ~ '^https://[^/?#]+[/?#]'
     AND strpos(t.prefix, '{id}') = 0
     AND (NOT (c.settings ? 'record_urls')
          OR (jsonb_typeof(c.settings->'record_urls') = 'object' AND NOT ((c.settings->'record_urls') ? 'event')));
  GET DIAGNOSTICS v_filled = ROW_COUNT;
  RETURN v_filled;
END;
$$;

COMMENT ON COLUMN public.integration_connections.settings IS
  'Not secret (integration_settings_ok); handed to the adapter by integration_begin (Webling: participant_state_property). The apply reads default_section, section_rules, hidden_group_pattern and participant_note, the app hidden_group_pattern and record_urls.event (link template of an event in the provider, https, {id} once for its external id).';

COMMENT ON FUNCTION public.integration_fill_record_urls() IS
  'Sets settings.record_urls.event (link template with {id}) of each connection whose live event links share it; keeps a template already set. Internal: run by 20261103120000 and the checks.';

REVOKE EXECUTE ON FUNCTION public.integration_fill_record_urls()
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  RAISE NOTICE 'record_urls: % connection(s) filled', public.integration_fill_record_urls();
END $$;
