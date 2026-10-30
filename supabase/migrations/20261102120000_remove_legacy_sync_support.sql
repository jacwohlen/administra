-- The legacy Webling sync is gone (integrations phase 3c, docs/INTEGRATIONS.md).
--
-- Dev switched the sync to the integration layer on 2026-10-28, prod on
-- 2026-10-29; webling-sync no longer has the scripts that wrote members,
-- links, events and registrations directly through PostgREST. What the
-- database kept only for those writes goes, and the comments that still
-- name the legacy sync say what is true now.
--
-- Kept: member_status_from_labels() (the status of members without a live
-- link), the guard triggers' early return for writers other than
-- 'authenticated' (the layer writes as the owner of integration_apply),
-- events_all_day, the adoption of unlinked rows that carry a provider id,
-- the registrations marked by legacy_note_prefix (prod still has such
-- rows) and the replacement of holiday events, which finds nothing to do
-- any more.

-----------------
-- A start the legacy sync moved took the last day along
-----------------

-- Fired only for service_role's direct writes, which were the legacy
-- sync's: the layer writes events inside integration_apply (SECURITY
-- DEFINER, as the owner) and sends the last day itself, staff send both
-- days. A direct write now gets what staff get: a start after the last day
-- is refused (events_date_to_check).
DROP TRIGGER IF EXISTS events_keep_span ON public.events;
DROP FUNCTION IF EXISTS public.trigger_event_keep_span();

-----------------
-- Comments
-----------------

COMMENT ON FUNCTION public.member_status_from_labels(jsonb, text) IS
  'membership_status of members created in Administra (no link); left for a member whose links are all gone. integration_member_status() falls back to it; linked members take their status from the rows of integration_member_groups, and with the seeded rows both give the same status (supabase/checks/integration_layer.sql).';

COMMENT ON FUNCTION public.member_grants_access(text, timestamptz, jsonb) IS
  'A member record lets a member account in: active or passive, not archived, no trial label (phase 1b).';

COMMENT ON TABLE public.member_links IS
  'Provider record a member comes from (integration_connections); gone_at once the provider no longer has it. At most one live link per member. Written by the integration layer only.';

COMMENT ON COLUMN public.events.all_day IS
  'No times: the whole day (or days, with date_to). 00:00 to 00:00 (or 00:00 without an end) is stored as all day without times, whoever writes it.';

COMMENT ON COLUMN public.integration_connections.legacy_note_prefix IS
  'Notes prefix of the registrations the sync inserted before the integration layer, which marks its own with event_participants.source_connection; nothing inserts such rows any more. They stay the provider''s while their notes start with it, and an events run adopts the unmarked ones on its events (registrations_adopted).';
