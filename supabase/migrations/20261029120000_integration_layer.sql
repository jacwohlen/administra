-- Integration layer (integrations phase 2, docs/INTEGRATIONS.md).
--
-- Administra owns its data model; a provider (Webling, later a CSV upload,
-- easyVerein or a calendar feed) only delivers records. Every adapter makes
-- the same four calls, as the sync (service role) or, for connections that
-- run in the app, as a signed-in admin in the browser:
--
--   integration_begin(connection, kind, options) -> run id, settings, capabilities
--   integration_stage(run, records)              -> records normalized, 1000 per call
--   integration_apply(run, options)              -> identity, mapping, guards, writes
--   integration_finish(run, report)              -> run closed, staged records deleted
--
-- Everything after the fetch happens here, in one transaction per apply:
-- identity through member_links / event_links (never through members.id),
-- provider groups -> labels and status and calendars -> sections or
-- holidays from catalog tables, which fields a provider owns
-- (field_policy), the mass guards (members gone, members losing or gaining
-- their membership, events gone; exact-count overrides), gone handling
-- within the run's declared scope, registrations the provider owns, the run
-- log and persistent issues (codes and ids, never names). A refused or dry
-- apply writes nothing but its run row (and new catalog rows); one record
-- the database refuses fails alone (write_failed), not the whole run.
--
-- Admins change what a group or calendar maps to with integration_set_mapping
-- (dry run, the same status guards, logged as a 'config' run); identity
-- rules, owned fields and guard limits change only by migration.
--
-- Purely additive for the sync that still runs from main against prod: it
-- writes members, member_links, events and event_participants directly and
-- keeps working (supabase/checks/member_access.sql). membership_status comes
-- out the same for every member: the Webling rules are now rows of
-- integration_member_groups, and the end of this migration aborts if any
-- stored status would change.

-----------------
-- Connections
-----------------

-- Which provider fields an adapter may write, and how:
--   owned   the provider's: written as sent (null clears), read-only in the app while linked
--   fill    written when the provider has a value, never cleared; read-only while linked
--   initial written when the layer creates the row; the app's afterwards
--   (absent) never written by the provider
CREATE OR REPLACE FUNCTION public.integration_field_policy_ok(p jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN jsonb_typeof(p) IS DISTINCT FROM 'object' THEN false ELSE NOT EXISTS (
    SELECT 1 FROM jsonb_each(p) e
     WHERE e.key NOT IN ('member.firstname', 'member.lastname', 'member.birthday', 'member.mobile',
                         'member.email', 'member.labels',
                         'event.title', 'event.date', 'event.date_to', 'event.timeFrom', 'event.timeTo',
                         'event.location', 'event.section', 'event.maxParticipants', 'event.description',
                         'break.title', 'break.date_from', 'break.date_to', 'break.cancels_training')
        OR jsonb_typeof(e.value) <> 'string'
        OR (e.value #>> '{}') NOT IN ('owned', 'fill', 'initial'))
  END;
$$;

-- Settings are handed to the adapter; secrets stay in the runner (GitHub)
CREATE OR REPLACE FUNCTION public.integration_settings_ok(p jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN jsonb_typeof(p) IS DISTINCT FROM 'object' THEN false ELSE NOT EXISTS (
    SELECT 1 FROM jsonb_object_keys(p) k WHERE k ~* '(api_?key|secret|token|passw|credential)')
  END;
$$;

CREATE TABLE public.integration_connections (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]{1,30}$'),
  -- Which adapter feeds it (webling, csv, easyverein, ical, ...): free, no schema change per provider
  provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]{1,30}$'),
  display_name text NOT NULL CHECK (btrim(display_name) <> '' AND length(display_name) <= 40),
  enabled boolean NOT NULL DEFAULT true,
  -- 'sync': only the service role runs it; 'app': also an admin in the browser (CSV upload)
  runs_in text NOT NULL DEFAULT 'sync' CHECK (runs_in IN ('sync', 'app')),
  -- 'external': a new record gets the provider's id as row id when it is an
  -- integer in [external_id_min, external_id_max) (Webling, for historical
  -- reasons); 'app': ids from the sequences. Existing records are always
  -- found through their links, whatever their id.
  member_ids text NOT NULL DEFAULT 'app' CHECK (member_ids IN ('app', 'external')),
  event_ids text NOT NULL DEFAULT 'app' CHECK (event_ids IN ('app', 'external')),
  external_id_min integer,
  external_id_max integer,
  -- Status of a linked member none of whose groups maps to a status
  default_status text NOT NULL DEFAULT 'non_member'
    CHECK (default_status IN ('trial', 'active', 'passive', 'non_member', 'left')),
  field_policy jsonb NOT NULL DEFAULT '{}' CHECK (public.integration_field_policy_ok(field_policy)),
  -- A new record that looks like a member the connection does not have (same
  -- e-mail, or same name and birthday): created and reported, or held back
  -- until an admin links it (link_to) or merges (merge_members). Never merged here.
  on_possible_duplicate text NOT NULL DEFAULT 'create' CHECK (on_possible_duplicate IN ('create', 'skip')),
  duplicate_match text NOT NULL DEFAULT 'email_or_name_birthday'
    CHECK (duplicate_match IN ('none', 'email', 'name_birthday', 'email_or_name_birthday')),
  -- Participant states that count as registered
  confirmed_states text[] NOT NULL DEFAULT '{confirmed}',
  -- Registrations inserted before event_participants.source_connection
  -- existed carry this notes prefix; they are adopted as the provider's
  legacy_note_prefix text,
  -- Mass guards: refused when more than max(min, floor(share * base)) at
  -- once, unless the run's options accept exactly that number
  gone_share numeric NOT NULL DEFAULT 0.1 CHECK (gone_share BETWEEN 0 AND 1),
  gone_min integer NOT NULL DEFAULT 5 CHECK (gone_min >= 0),
  drop_share numeric NOT NULL DEFAULT 0.1 CHECK (drop_share BETWEEN 0 AND 1),
  drop_status_share numeric NOT NULL DEFAULT 0.5 CHECK (drop_status_share BETWEEN 0 AND 1),
  drop_min integer NOT NULL DEFAULT 5 CHECK (drop_min >= 0),
  -- Not secret: handed to the adapter by integration_begin; default_section,
  -- section_rules, hidden_group_pattern and participant_note for the apply
  settings jsonb NOT NULL DEFAULT '{}' CHECK (public.integration_settings_ok(settings)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((external_id_min IS NULL) = (external_id_max IS NULL)),
  -- Inside the fence of 20261025220000 (app ids from 10'000'001)
  CHECK (external_id_min >= 1000 AND external_id_max <= 10000000 AND external_id_min < external_id_max),
  CHECK ((member_ids = 'app' AND event_ids = 'app') OR external_id_min IS NOT NULL),
  -- Two connections never claim the same ids
  EXCLUDE USING gist ((int4range(external_id_min, external_id_max)) WITH &&)
    WHERE (external_id_min IS NOT NULL)
);

COMMENT ON TABLE public.integration_connections IS
  'A provider the integration layer ingests from (docs/INTEGRATIONS.md): identity rule, owned fields, guard limits, adapter settings. No secrets. Changed by migration only.';

-- Webling as the legacy sync writes it: Webling ids are row ids (1''000 to
-- 10''000''000), name, birthday, mobile and groups are Webling's, an e-mail
-- only when Webling has one; event times, place and limit are never
-- cleared; the description holds the portal link as long as the app tells
-- Webling events by it (phase 3 moves it to event_links.url).
INSERT INTO public.integration_connections (
  id, provider, display_name, runs_in, member_ids, event_ids, external_id_min, external_id_max,
  default_status, field_policy, legacy_note_prefix, settings
) VALUES (
  'webling', 'webling', 'Webling', 'sync', 'external', 'external', 1000, 10000000,
  'non_member',
  '{"member.firstname": "owned", "member.lastname": "owned", "member.birthday": "owned",
    "member.mobile": "owned", "member.email": "fill", "member.labels": "owned",
    "event.title": "owned", "event.date": "owned", "event.date_to": "owned",
    "event.timeFrom": "fill", "event.timeTo": "fill", "event.location": "fill",
    "event.maxParticipants": "fill", "event.section": "owned", "event.description": "owned",
    "break.title": "owned", "break.date_from": "owned", "break.date_to": "owned",
    "break.cancels_training": "initial"}',
  'Imported from Webling',
  jsonb_build_object(
    'default_section', 'General',
    -- the section a calendar seen for the first time gets (transform_section() of the legacy sync)
    'section_rules', jsonb_build_array(
      jsonb_build_object('match', 'judo', 'section', 'Judo'),
      jsonb_build_object('match', 'aikido', 'section', 'Aikido'),
      jsonb_build_object('match', 'club', 'section', 'Club'),
      jsonb_build_object('match', 'verein', 'section', 'Club')),
    'hidden_group_pattern', '^\d\d_[A-Z]',
    'participant_note', 'Imported from Webling - Confirmed: confirmed',
    -- the Webling property holding a participant's state (instance-specific)
    'participant_state_property', '594'
  )
);

-----------------
-- Catalog: provider groups -> labels and status
-----------------

-- One row per provider group. external_id binds the row to the provider's
-- group id on first sight (seeded rows are matched by name until then), so
-- a group renamed in the provider keeps its status. The label written to
-- members is label, or the provider's current name when label is NULL;
-- it is unique per connection (integration_group_label()).
CREATE TABLE public.integration_member_groups (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  connection text NOT NULL REFERENCES public.integration_connections (id) ON DELETE CASCADE,
  external_id text CHECK (external_id <> '' AND length(external_id) <= 200),
  name text NOT NULL CHECK (btrim(name) <> ''),
  label text CHECK (btrim(label) <> ''),
  status text CHECK (status IN ('trial', 'active', 'passive', 'non_member', 'left')),
  -- The status group with the lowest rank wins (03_Austritt over Aktiv)
  rank integer NOT NULL DEFAULT 100 CHECK (rank BETWEEN 0 AND 1000),
  -- Not shown as a chip (status and bookkeeping groups)
  hidden boolean NOT NULL DEFAULT false,
  -- A role the app reads ('trainer': offered first as trainer)
  role text CHECK (role IN ('trainer')),
  -- false: seen for the first time, not classified by an admin yet
  reviewed boolean NOT NULL DEFAULT false,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  updated_at timestamptz,
  UNIQUE (connection, external_id)
);

CREATE UNIQUE INDEX integration_member_groups_unbound_name
  ON public.integration_member_groups (connection, name) WHERE external_id IS NULL;

-- A status is looked up by the label text (integration_member_status), so
-- two groups writing one label would share a status
CREATE UNIQUE INDEX integration_member_groups_label
  ON public.integration_member_groups (connection, (coalesce(label, name)));

-- Exactly the rules of member_status_from_labels() (20261025230000), so
-- every status stays as it is; Webling's legacy trial group is renamed as
-- transform_label() in webling-sync/src/webling.py does
INSERT INTO public.integration_member_groups (connection, name, label, status, rank, hidden, role, reviewed)
VALUES
  ('webling', '03_Austritt',            NULL,            'left',       10, true,  NULL,      true),
  ('webling', 'Aktiv',                  NULL,            'active',     20, true,  NULL,      true),
  ('webling', 'Passiv',                 NULL,            'passive',    30, true,  NULL,      true),
  ('webling', 'Ehrenmitglieder',        NULL,            'passive',    30, true,  NULL,      true),
  ('webling', 'Nicht-Mitglieder',       NULL,            'non_member', 40, true,  NULL,      true),
  ('webling', '04_Probetraining',       'Probetraining', 'non_member', 60, true,  NULL,      true),
  ('webling', '01_Anmeldung',           NULL,            NULL,        100, true,  NULL,      true),
  ('webling', '02_Rechnung verschickt', NULL,            NULL,        100, true,  NULL,      true),
  ('webling', '03_Rechnung bezahlt',    NULL,            NULL,        100, true,  NULL,      true),
  ('webling', '04_Pass bestellt',       NULL,            NULL,        100, true,  NULL,      true),
  ('webling', 'Test',                   NULL,            NULL,        100, true,  NULL,      true),
  ('webling', 'Erwachsenentrainer',     NULL,            NULL,        100, false, 'trainer', true),
  ('webling', 'Kindertrainer',          NULL,            NULL,        100, false, NULL,      true),
  ('webling', 'Hilfstrainer',           NULL,            NULL,        100, false, NULL,      true),
  ('webling', 'Vorstand',               NULL,            NULL,        100, false, NULL,      true),
  ('webling', 'J&S',                    NULL,            NULL,        100, false, NULL,      true);

-----------------
-- Catalog: provider calendars -> events (section) or holidays
-----------------

CREATE TABLE public.integration_calendars (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  connection text NOT NULL REFERENCES public.integration_connections (id) ON DELETE CASCADE,
  external_id text CHECK (external_id <> '' AND length(external_id) <= 200),
  name text NOT NULL CHECK (btrim(name) <> ''),
  -- 'event': events with section; 'break': training_plan_breaks (holidays);
  -- 'ignore': not imported (its linked events go as gone)
  target text NOT NULL DEFAULT 'event' CHECK (target IN ('event', 'break', 'ignore')),
  section text CHECK (btrim(section) <> '' AND length(section) <= 40),
  -- Breaks: a new period of at most this many days closes the dojo
  -- (cancels_training); longer ones are school holidays. NULL: always
  -- closed. The TK's "Dojo zu" wins afterwards (policy 'initial').
  closed_max_days integer CHECK (closed_max_days >= 0),
  reviewed boolean NOT NULL DEFAULT false,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  updated_at timestamptz,
  UNIQUE (connection, external_id)
);

CREATE UNIQUE INDEX integration_calendars_unbound_name
  ON public.integration_calendars (connection, name) WHERE external_id IS NULL;

-- What transform_section() in webling-sync/src/events.py gives the six
-- calendars today (run of 2026-10-27). Holidays stay events until phase 4.
INSERT INTO public.integration_calendars (connection, name, target, section, closed_max_days, reviewed)
VALUES
  ('webling', 'Judo Agenda',               'event', 'Judo',    NULL, true),
  ('webling', 'Judo Erwachsene Trainings', 'event', 'Judo',    NULL, true),
  ('webling', 'Judo Herren SMM',           'event', 'Judo',    NULL, true),
  ('webling', 'Aikido',                    'event', 'Aikido',  NULL, true),
  ('webling', 'Club',                      'event', 'Club',    NULL, true),
  ('webling', 'Ferien und Feiertage',      'event', 'General', 3,    true);

-----------------
-- Provenance of events, holidays and registrations
-----------------

CREATE TABLE public.event_links (
  connection text NOT NULL REFERENCES public.integration_connections (id),
  external_id text NOT NULL CHECK (external_id <> '' AND length(external_id) <= 200),
  event_id integer NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
  calendar_id bigint REFERENCES public.integration_calendars (id) ON DELETE SET NULL,
  -- The event in the provider (Webling portal link)
  url text CHECK (url ~ '^https://' AND length(url) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  gone_at timestamptz,
  PRIMARY KEY (connection, external_id),
  UNIQUE (event_id, connection)
);

-- One provider owns an event's fields
CREATE UNIQUE INDEX event_links_one_live_link ON public.event_links (event_id) WHERE gone_at IS NULL;

COMMENT ON TABLE public.event_links IS
  'Provider record an event comes from; gone_at once the provider no longer has it. Written by the integration layer only (no backfill: the first layer run links the events it sees).';

-- Multi-day events (shown from phase 4 on); inclusive, NULL for one day
ALTER TABLE public.events
  ADD COLUMN date_to text
  CONSTRAINT events_date_to_check CHECK (date_to ~ '^\d{4}-\d{2}-\d{2}$' AND date_to > date);

-- Holidays from a provider: (connection, external_id); NULL for the TK's own
ALTER TABLE public.training_plan_breaks
  ADD COLUMN connection text REFERENCES public.integration_connections (id),
  ADD COLUMN external_id text CHECK (external_id <> '' AND length(external_id) <= 200),
  ADD COLUMN calendar_id bigint REFERENCES public.integration_calendars (id) ON DELETE SET NULL,
  ADD COLUMN last_seen_at timestamptz,
  ADD CONSTRAINT training_plan_breaks_link_check CHECK ((connection IS NULL) = (external_id IS NULL)),
  ADD CONSTRAINT training_plan_breaks_link_key UNIQUE (connection, external_id);

-- Registrations a provider manages (inserts and removes). App rows: NULL.
ALTER TABLE public.event_participants
  ADD COLUMN source_connection text REFERENCES public.integration_connections (id);

UPDATE public.event_participants
   SET source_connection = 'webling'
 WHERE source_connection IS NULL AND notes LIKE 'Imported from Webling%';

-- Links name a configured connection; a member has at most one live link
-- (one provider owns its fields; merge_members refuses two)
ALTER TABLE public.member_links
  ADD CONSTRAINT member_links_connection_fkey
  FOREIGN KEY (connection) REFERENCES public.integration_connections (id);
CREATE UNIQUE INDEX member_links_one_live_link
  ON public.member_links (member_id) WHERE gone_at IS NULL;

COMMENT ON TABLE public.member_links IS
  'Provider record a member comes from (integration_connections); gone_at once the provider no longer has it. At most one live link per member. Written by the integration layer (and the legacy Webling sync until phase 3).';

-----------------
-- Runs, staged records, issues
-----------------

CREATE TABLE public.integration_runs (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  connection text NOT NULL REFERENCES public.integration_connections (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('members', 'events', 'config')),
  -- members: {"complete": bool}; events: {"complete": bool, "calendars":
  -- [ids read completely], "from": "YYYY-MM-DD"}. Only a complete scope
  -- marks records gone, events only in the calendars listed.
  scope jsonb NOT NULL DEFAULT '{}',
  trigger text NOT NULL DEFAULT 'schedule' CHECK (trigger IN ('schedule', 'manual', 'app')),
  -- Where it ran, e.g. 'github:12345678' (links the Actions log)
  runner text CHECK (runner ~ '^[a-z]{1,20}:[A-Za-z0-9._-]{1,60}$'),
  dry_run boolean NOT NULL DEFAULT false,
  -- running -> applied | refused (apply) -> ok | warning | refused | failed (finish)
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'applied', 'refused', 'ok', 'warning', 'failed')),
  started_by uuid DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  finished_at timestamptz,
  -- Counts; guard numbers and the refusal; overrides used; the adapter's
  -- counters. Never names, titles or values.
  result jsonb NOT NULL DEFAULT '{}',
  guard jsonb NOT NULL DEFAULT '{}',
  accepted jsonb NOT NULL DEFAULT '{}',
  adapter jsonb NOT NULL DEFAULT '{}',
  -- A code: SQLSTATE and constraint of a failed apply, 'abandoned', or the adapter's
  error text CHECK (error ~ '^[a-z0-9_.: -]{1,80}$')
);

CREATE INDEX integration_runs_connection_started
  ON public.integration_runs (connection, kind, started_at DESC);
-- One open run per connection and kind: a members run left open does not block events
CREATE UNIQUE INDEX integration_runs_one_open
  ON public.integration_runs (connection, kind) WHERE status IN ('running', 'applied');

-- Records of an open run, normalized by integration_stage(); deleted by
-- integration_finish() (and for closed runs by the next begin). The
-- columns after problem are the apply's plan. Readable by nobody.
CREATE TABLE public.integration_records (
  run_id bigint NOT NULL REFERENCES public.integration_runs (id) ON DELETE CASCADE,
  external_id text NOT NULL CHECK (external_id <> '' AND length(external_id) <= 200),
  data jsonb NOT NULL,
  -- Why the record cannot be applied (it still counts as seen: never gone)
  problem text,
  -- insert, adopt, update, revive, held, conflict, invalid; events also
  -- ignored, cancelled, out_of_scope; error when its write failed
  action text,
  target_id bigint,
  route text,
  calendar_id bigint,
  labels jsonb,
  -- possible duplicate: the other member and how it matched
  match_id integer,
  match text,
  -- inserted, adopted, revived, updated, unchanged; error: SQLSTATE
  result text,
  error text,
  PRIMARY KEY (run_id, external_id)
);

-- No foreign keys to members or events: merge_members (phase 1c) and
-- deletes must not depend on this table; a run that no longer observes an
-- issue resolves it. An issue about a record without a row (member_id or
-- event_id NULL, e.g. a failed insert, or the row deleted since) keeps
-- external_id, and the Integrations page shows it by that number.
CREATE TABLE public.integration_issues (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  connection text NOT NULL REFERENCES public.integration_connections (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('members', 'events')),
  code text NOT NULL CHECK (code ~ '^[a-z_]{3,40}$'),
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  -- Provider record ('' when the issue is not about one)
  external_id text NOT NULL DEFAULT '' CHECK (length(external_id) <= 200),
  member_id integer,
  other_member_id integer,
  event_id integer,
  -- A code ('email', 'missing_lastname', '23514'), never a value
  detail text CHECK (detail ~ '^[a-z0-9_]{1,40}$'),
  first_run bigint REFERENCES public.integration_runs (id) ON DELETE SET NULL,
  last_run bigint REFERENCES public.integration_runs (id) ON DELETE SET NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  -- Not observed by a later run that checks it
  resolved_at timestamptz,
  -- An admin decided it is fine (not a duplicate); stays closed until reopened
  dismissed_at timestamptz,
  dismissed_by uuid REFERENCES auth.users (id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX integration_issues_key ON public.integration_issues (
  connection, kind, code, external_id, (coalesce(member_id, 0)), (coalesce(other_member_id, 0)),
  (coalesce(event_id, 0))
);
CREATE INDEX integration_issues_open ON public.integration_issues (connection)
  WHERE resolved_at IS NULL AND dismissed_at IS NULL;

-----------------
-- Row level security and privileges
-----------------

ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_member_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_issues ENABLE ROW LEVEL SECURITY;

-- Staff read the configuration (labels to hide, provider names, owned
-- fields) and event links (read-only events); admins read runs and issues.
-- Nobody writes through the API: only the functions below and migrations.
-- Staged records are read by nobody (no grant, no policy).
CREATE POLICY integration_connections_read ON public.integration_connections
  FOR SELECT TO authenticated USING ((SELECT public.is_staff()));
CREATE POLICY integration_member_groups_read ON public.integration_member_groups
  FOR SELECT TO authenticated USING ((SELECT public.is_staff()));
CREATE POLICY integration_calendars_read ON public.integration_calendars
  FOR SELECT TO authenticated USING ((SELECT public.is_staff()));
CREATE POLICY event_links_read ON public.event_links
  FOR SELECT TO authenticated USING ((SELECT public.is_staff()));
CREATE POLICY integration_runs_read ON public.integration_runs
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY integration_issues_read ON public.integration_issues
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

-- New tables are granted to anon, authenticated and service_role by the
-- default privileges (20260915130000_explicit_api_role_grants.sql)
REVOKE ALL ON public.integration_connections, public.integration_member_groups,
  public.integration_calendars, public.event_links, public.integration_runs,
  public.integration_records, public.integration_issues
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.integration_connections, public.integration_member_groups,
  public.integration_calendars, public.event_links, public.integration_runs,
  public.integration_issues TO authenticated, service_role;

-----------------
-- Membership status from the catalog
-----------------

-- Status of a member from its labels and its link: p_link 'active' (live
-- link of p_connection), 'gone' (only gone links) or NULL (created in
-- Administra). A linked member takes the status group with the lowest rank
-- (the app's own trial label 'probetraining' ranks 50, as in
-- member_status_from_labels()), else the connection's default status.
-- Members created in Administra keep member_status_from_labels().
CREATE OR REPLACE FUNCTION public.integration_member_status(
  p_labels jsonb, p_connection text, p_link text
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_link = 'gone' THEN 'left'
    WHEN p_link = 'active' AND c.id IS NOT NULL THEN coalesce(
      (SELECT r.status
         FROM (SELECT coalesce(g.label, g.name) AS label, g.status, g.rank
                 FROM public.integration_member_groups g
                WHERE g.connection = c.id AND g.status IS NOT NULL
               UNION ALL
               SELECT 'probetraining', 'trial', 50) r
        WHERE (CASE WHEN jsonb_typeof(p_labels) = 'array' THEN p_labels ELSE '[]'::jsonb END) ? r.label
        ORDER BY r.rank, r.status
        LIMIT 1),
      c.default_status)
    ELSE public.member_status_from_labels(p_labels, p_link)
  END
  FROM (SELECT 1) one
  LEFT JOIN public.integration_connections c ON c.id = p_connection;
$$;

-- The status a member row has: its live link's connection; all links gone:
-- left; no link: the connection whose external id range it lies in (a row
-- the legacy sync inserts before writing its link, phase 1b), else created
-- in Administra. With the seeded catalog this is exactly phase 1b's
-- member_status_from_labels(labels, provider_link_state(id) or id range).
CREATE OR REPLACE FUNCTION public.member_status_for(p_member_id integer, p_labels jsonb)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_connection text;
  v_link text;
BEGIN
  SELECT l.connection INTO v_connection
    FROM public.member_links l
   WHERE l.member_id = p_member_id AND l.gone_at IS NULL
   ORDER BY l.connection
   LIMIT 1;
  IF FOUND THEN
    v_link := 'active';
  ELSIF EXISTS (SELECT 1 FROM public.member_links l WHERE l.member_id = p_member_id) THEN
    v_link := 'gone';
  ELSE
    SELECT c.id INTO v_connection
      FROM public.integration_connections c
     WHERE c.member_ids = 'external'
       AND p_member_id >= c.external_id_min AND p_member_id < c.external_id_max
     ORDER BY c.id
     LIMIT 1;
    IF FOUND THEN
      v_link := 'active';
    END IF;
  END IF;
  RETURN public.integration_member_status(p_labels, v_connection, v_link);
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_set_membership_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.membership_status := public.member_status_for(NEW.id, NEW.labels);
  RETURN NEW;
END;
$$;

-- Only rows whose status changes are written
CREATE OR REPLACE FUNCTION public.trigger_link_changed_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.members m
     SET membership_status = public.member_status_for(m.id, m.labels)
   WHERE m.id IN (
           CASE WHEN TG_OP <> 'INSERT' THEN OLD.member_id END,
           CASE WHEN TG_OP <> 'DELETE' THEN NEW.member_id END
         )
     AND m.membership_status IS DISTINCT FROM public.member_status_for(m.id, m.labels);
  RETURN NULL;
END;
$$;

-- UPDATE OF gone_at fired for every link the legacy sync upserts (PostgREST
-- always sends gone_at). Only a link that comes, goes, comes back or moves
-- can change a status.
DROP TRIGGER member_links_set_membership_status ON public.member_links;
CREATE TRIGGER member_links_set_membership_status
  AFTER INSERT OR DELETE ON public.member_links
  FOR EACH ROW EXECUTE FUNCTION public.trigger_link_changed_status();
CREATE TRIGGER member_links_changed_status
  AFTER UPDATE OF gone_at, member_id, connection ON public.member_links
  FOR EACH ROW
  WHEN ((OLD.gone_at IS NULL) IS DISTINCT FROM (NEW.gone_at IS NULL)
        OR OLD.member_id IS DISTINCT FROM NEW.member_id
        OR OLD.connection IS DISTINCT FROM NEW.connection)
  EXECUTE FUNCTION public.trigger_link_changed_status();

COMMENT ON FUNCTION public.member_status_from_labels(jsonb, text) IS
  'membership_status of members created in Administra (no link). Linked members: integration_member_status() with the rows of integration_member_groups; with the seeded rows both give the same status (supabase/checks/integration_layer.sql). The legacy sync''s guard predicts with this function until phase 3.';

-----------------
-- Fields a provider owns: read-only for staff while linked
-----------------

-- Staff edit through the API as 'authenticated'. The sync (service_role),
-- migrations and SECURITY DEFINER functions are not restricted. Not SECURITY
-- DEFINER: it needs the caller's role. The fields come from the connection
-- of the member's live link (policy owned or fill); id and status always.
CREATE OR REPLACE FUNCTION public.trigger_guard_provider_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_policy jsonb;
  v_old jsonb;
  v_new jsonb;
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  SELECT c.display_name, c.field_policy INTO v_name, v_policy
    FROM public.member_links l
    JOIN public.integration_connections c ON c.id = l.connection
   WHERE l.member_id = OLD.id AND l.gone_at IS NULL
   LIMIT 1;
  IF v_name IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
  END IF;
  IF TG_OP = 'DELETE'
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.membership_status IS DISTINCT FROM OLD.membership_status
     OR EXISTS (SELECT 1 FROM jsonb_each_text(v_policy) e
                 WHERE e.key LIKE 'member.%' AND e.value IN ('owned', 'fill')
                   AND (v_new -> substr(e.key, 8)) IS DISTINCT FROM (v_old -> substr(e.key, 8))) THEN
    RAISE EXCEPTION 'MANAGED_BY_PROVIDER: member % is maintained in its provider (%)', OLD.id, v_name
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

-- While an event is in its provider, what the provider owns is read-only
-- and it cannot be deleted (the next run would bring it back without its
-- attendance). Everything else (registration deadline) stays the app's.
CREATE OR REPLACE FUNCTION public.trigger_guard_provider_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_policy jsonb;
  v_old jsonb;
  v_new jsonb;
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  SELECT c.display_name, c.field_policy INTO v_name, v_policy
    FROM public.event_links l
    JOIN public.integration_connections c ON c.id = l.connection
   WHERE l.event_id = OLD.id AND l.gone_at IS NULL
   LIMIT 1;
  IF v_name IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
  END IF;
  IF TG_OP = 'DELETE'
     OR NEW.id IS DISTINCT FROM OLD.id
     OR EXISTS (SELECT 1 FROM jsonb_each_text(v_policy) e
                 WHERE e.key LIKE 'event.%' AND e.value IN ('owned', 'fill')
                   AND (v_new -> substr(e.key, 7)) IS DISTINCT FROM (v_old -> substr(e.key, 7))) THEN
    RAISE EXCEPTION 'MANAGED_BY_PROVIDER: event % is maintained in its provider (%)', OLD.id, v_name
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER events_guard_provider_fields
  BEFORE UPDATE OR DELETE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.trigger_guard_provider_event();

-- Holidays from a provider: what it owns is read-only and they cannot be
-- deleted; "Dojo zu" (cancels_training, policy 'initial') is the TK's.
-- Staff cannot create or fake provenance.
CREATE OR REPLACE FUNCTION public.trigger_guard_provider_break()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_policy jsonb;
  v_old jsonb;
  v_new jsonb;
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.connection IS NOT NULL OR NEW.external_id IS NOT NULL OR NEW.calendar_id IS NOT NULL
       OR NEW.last_seen_at IS NOT NULL THEN
      RAISE EXCEPTION 'MANAGED_BY_PROVIDER: only the integration layer links holidays'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.connection, NEW.external_id, NEW.calendar_id, NEW.last_seen_at)
       IS DISTINCT FROM (OLD.connection, OLD.external_id, OLD.calendar_id, OLD.last_seen_at) THEN
    RAISE EXCEPTION 'MANAGED_BY_PROVIDER: only the integration layer links holidays'
      USING ERRCODE = 'P0001';
  END IF;
  IF OLD.connection IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  SELECT c.display_name, c.field_policy INTO v_name, v_policy
    FROM public.integration_connections c WHERE c.id = OLD.connection;
  IF TG_OP <> 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
  END IF;
  IF TG_OP = 'DELETE'
     OR EXISTS (SELECT 1 FROM jsonb_each_text(v_policy) e
                 WHERE e.key LIKE 'break.%' AND e.value IN ('owned', 'fill')
                   AND (v_new -> substr(e.key, 7)) IS DISTINCT FROM (v_old -> substr(e.key, 7))) THEN
    RAISE EXCEPTION 'MANAGED_BY_PROVIDER: holiday % is maintained in its provider (%)', OLD.id, v_name
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER training_plan_breaks_guard_provider
  BEFORE INSERT OR UPDATE OR DELETE ON public.training_plan_breaks
  FOR EACH ROW EXECUTE FUNCTION public.trigger_guard_provider_break();

-- Only the integration layer marks registrations as a provider's
CREATE OR REPLACE FUNCTION public.trigger_guard_participant_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user = 'authenticated'
     AND NEW.source_connection IS DISTINCT FROM
         (CASE WHEN TG_OP = 'UPDATE' THEN OLD.source_connection END) THEN
    RAISE EXCEPTION 'MANAGED_BY_PROVIDER: only the integration layer marks registrations'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER event_participants_guard_source
  BEFORE INSERT OR UPDATE OF source_connection ON public.event_participants
  FOR EACH ROW EXECUTE FUNCTION public.trigger_guard_participant_source();

-- A registration stays the provider's only while its notes start with the
-- provider's note (the participant note the layer writes, or the legacy
-- prefix; without either, while they stay empty as the layer writes them),
-- the rule the legacy sync removes rows by. Notes changed in the app make
-- the row the app's, so the layer never removes it: staff editing them, or
-- merge_members (phase 1c), which gives a kept Webling registration the
-- notes of the app's registration it merges away.
-- SECURITY DEFINER: members cannot read integration_connections.
CREATE OR REPLACE FUNCTION public.trigger_participant_source_follows_notes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_note text;
  v_prefix text;
  v_notes text := coalesce(NEW.notes, '');
  v_kept boolean;
BEGIN
  SELECT nullif(c.settings->>'participant_note', ''), nullif(c.legacy_note_prefix, '')
    INTO v_note, v_prefix
    FROM public.integration_connections c
   WHERE c.id = NEW.source_connection;
  IF v_note IS NULL AND v_prefix IS NULL THEN
    v_kept := v_notes = '';
  ELSE
    v_kept := coalesce(starts_with(v_notes, v_note), false) OR coalesce(starts_with(v_notes, v_prefix), false);
  END IF;
  IF NOT v_kept THEN
    NEW.source_connection := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- BEFORE triggers fire in name order: after event_participants_guard_source,
-- which still refuses staff setting source_connection themselves
CREATE TRIGGER event_participants_source_follows_notes
  BEFORE UPDATE ON public.event_participants
  FOR EACH ROW
  WHEN (NEW.source_connection IS NOT NULL AND NEW.notes IS DISTINCT FROM OLD.notes)
  EXECUTE FUNCTION public.trigger_participant_source_follows_notes();

-----------------
-- Normalization (integration_stage)
-----------------

-- A real calendar date as YYYY-MM-DD between p_min and p_max, else NULL
CREATE OR REPLACE FUNCTION public.integration_iso_date(p text, p_min date, p_max date)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p IS NULL OR p !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN NULL;
  END IF;
  RETURN CASE WHEN to_char(p::date, 'YYYY-MM-DD') = p AND p::date BETWEEN p_min AND p_max THEN p END;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.integration_hhmm(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN p ~ '^([01]\d|2[0-3]):[0-5]\d$' THEN p END;
$$;

-- A JSON value as text; NULL for null, objects and arrays
CREATE OR REPLACE FUNCTION public.integration_text(p jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN jsonb_typeof(p) IN ('string', 'number', 'boolean') THEN p #>> '{}' END;
$$;

-- Member data: {firstname, lastname, birthday, mobile, email, groups:
-- [name | {id, name}], link_to, problem}. Only the keys sent are kept: a
-- field left out stays as it is, null clears it (field_policy decides).
-- Values are stored as sent; names are trimmed (as the legacy sync does).
-- A birthday that is not a real date is dropped and noted (invalid). A
-- record with a problem (the adapter's, e.g. 'fetch_failed', or
-- 'missing_lastname') counts as seen but is not written.
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
      || CASE WHEN p ? 'groups' THEN jsonb_build_object('groups', v.groups) ELSE '{}'::jsonb END
      || jsonb_build_object('invalid', CASE WHEN v.bad_birthday THEN '["birthday"]'::jsonb ELSE '[]'::jsonb END)
  FROM v;
$$;

-- Event data: {calendar: {id, name}, title, starts_on, ends_on, time_from,
-- time_to, location, max_participants, description, url, cancelled,
-- participants: null | [{member, state}], problem}. Dates are local
-- (Europe/Zurich) days, ends_on inclusive; times HH:MM. Only the keys sent
-- are kept. A start that is not a real date is 'invalid_date' (the adapter
-- sends 'no_date' for a provider's unset date, e.g. Webling's epoch).
CREATE OR REPLACE FUNCTION public.integration_normalize_event(p jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH f AS (
    SELECT
      public.integration_iso_date(p->>'starts_on', '1900-01-01', '2200-12-31') AS starts_on,
      public.integration_iso_date(p->>'ends_on', '1900-01-01', '2200-12-31') AS ends_on,
      coalesce(nullif(btrim(public.integration_text(p->'calendar'->'id')), ''),
               nullif(btrim(p->'calendar'->>'name'), '')) AS cal_key,
      nullif(btrim(p->'calendar'->>'name'), '') AS cal_name,
      CASE WHEN p->>'problem' ~ '^[a-z_]{1,40}$' THEN p->>'problem' END AS problem
  )
  SELECT jsonb_strip_nulls(jsonb_build_object(
           'calendar', CASE WHEN f.cal_key IS NOT NULL
                            THEN jsonb_build_object('key', f.cal_key, 'name', coalesce(f.cal_name, f.cal_key)) END,
           'title', coalesce(nullif(btrim(public.integration_text(p->'title')), ''), 'Untitled Event'),
           'starts_on', f.starts_on,
           'url', CASE WHEN p->>'url' ~ '^https://' AND length(p->>'url') <= 500 THEN p->>'url' END,
           'cancelled', coalesce(p->>'cancelled' = 'true', false),
           'problem', coalesce(f.problem, CASE WHEN f.cal_key IS NULL THEN 'no_calendar'
                                               WHEN f.starts_on IS NULL THEN 'invalid_date' END)))
      || CASE WHEN p ? 'ends_on'
              THEN jsonb_build_object('ends_on', CASE WHEN f.ends_on > f.starts_on THEN f.ends_on END)
              ELSE '{}'::jsonb END
      || CASE WHEN p ? 'time_from' AND (p->'time_from' = 'null'::jsonb OR public.integration_hhmm(p->>'time_from') IS NOT NULL)
              THEN jsonb_build_object('time_from', public.integration_hhmm(p->>'time_from')) ELSE '{}'::jsonb END
      || CASE WHEN p ? 'time_to' AND (p->'time_to' = 'null'::jsonb OR public.integration_hhmm(p->>'time_to') IS NOT NULL)
              THEN jsonb_build_object('time_to', public.integration_hhmm(p->>'time_to')) ELSE '{}'::jsonb END
      || CASE WHEN p ? 'location'
              THEN jsonb_build_object('location', nullif(btrim(coalesce(public.integration_text(p->'location'), '')), ''))
              ELSE '{}'::jsonb END
      || CASE WHEN p ? 'max_participants' AND (p->'max_participants' = 'null'::jsonb
                                               OR public.integration_text(p->'max_participants') ~ '^\d{1,6}$')
              THEN jsonb_build_object('max_participants',
                     CASE WHEN public.integration_text(p->'max_participants') ~ '^\d{1,6}$'
                          THEN (public.integration_text(p->'max_participants'))::integer END)
              ELSE '{}'::jsonb END
      || CASE WHEN p ? 'description' THEN jsonb_build_object('description', public.integration_text(p->'description'))
              ELSE '{}'::jsonb END
      || CASE WHEN jsonb_typeof(p->'participants') = 'array' THEN jsonb_build_object('participants', (
             SELECT coalesce(jsonb_agg(jsonb_build_object('member', btrim(public.integration_text(x->'member')),
                                                          'state', coalesce(x->>'state', '')))
                             FILTER (WHERE coalesce(btrim(public.integration_text(x->'member')), '')
                                           ~ '^[A-Za-z0-9_.:@/+=-]{1,200}$'), '[]'::jsonb)
               FROM jsonb_array_elements(p->'participants') x)) ELSE '{}'::jsonb END
      || jsonb_build_object('invalid', to_jsonb(array_remove(ARRAY[
             CASE WHEN p ? 'time_from' AND p->'time_from' <> 'null'::jsonb
                       AND public.integration_hhmm(p->>'time_from') IS NULL THEN 'time_from' END,
             CASE WHEN p ? 'time_to' AND p->'time_to' <> 'null'::jsonb
                       AND public.integration_hhmm(p->>'time_to') IS NULL THEN 'time_to' END,
             CASE WHEN p ? 'max_participants' AND p->'max_participants' <> 'null'::jsonb
                       AND coalesce(public.integration_text(p->'max_participants'), '') !~ '^\d{1,6}$'
                  THEN 'max_participants' END], NULL)))
  FROM f;
$$;

-- The value a provider field gets (field_policy, see above)
CREATE OR REPLACE FUNCTION public.integration_pick(
  p_policy text, p_present boolean, p_new text, p_old text, p_creating boolean
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT coalesce(p_present, false) OR p_policy IS NULL THEN p_old
    WHEN p_policy = 'owned' THEN p_new
    WHEN p_policy = 'fill' THEN coalesce(nullif(p_new, ''), p_old)
    WHEN p_policy = 'initial' AND p_creating THEN p_new
    ELSE p_old
  END;
$$;

-----------------
-- Who may run a connection
-----------------

-- The sync with the service role key, or a direct database session
-- (migrations, checks, a maintainer): PostgREST always switches the
-- 'role' setting away from its login role 'authenticator'; inside
-- SECURITY DEFINER functions current_user is the owner, the setting stays.
CREATE OR REPLACE FUNCTION public.integration_is_service()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(nullif(current_setting('role', true), ''), 'none') = 'service_role'
      OR (coalesce(nullif(current_setting('role', true), ''), 'none') = 'none'
          AND session_user <> 'authenticator');
$$;

-- The sync, or a signed-in admin for connections that run in the app (CSV
-- upload), on runs that admin started. anon cannot execute the API.
CREATE OR REPLACE FUNCTION public.integration_authorize(
  p_connection text,
  p_for_run boolean DEFAULT false,
  p_run_owner uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF public.integration_is_service() THEN
    RETURN;
  END IF;
  IF auth.uid() IS NOT NULL
     AND public.is_admin()
     AND EXISTS (SELECT 1 FROM public.integration_connections c
                  WHERE c.id = p_connection AND c.runs_in = 'app')
     AND (NOT p_for_run OR p_run_owner = auth.uid()) THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501';
END;
$$;

-----------------
-- begin / stage
-----------------

-- Opens a run of one kind. p_options: {scope, dry_run, trigger, runner}.
-- scope: members {complete}; events {complete, calendars: [ids read
-- completely], from: 'YYYY-MM-DD' (default January 1 this year)}.
-- Returns {run, kind, scope, today, settings, capabilities}: the adapter
-- sends only the record keys capabilities lists, so a newer adapter never
-- sends what an older database would not understand.
-- Errors: NOT_ALLOWED (42501), UNKNOWN_CONNECTION (P0001), RUN_IN_PROGRESS
-- (PT409: HTTP 409), invalid options (22023). A missing function (PGRST202
-- or 42883 on this first call) means the layer is not on this database.
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
      'version', 1,
      'member_keys', jsonb_build_array('firstname', 'lastname', 'birthday', 'mobile', 'email', 'groups',
                                       'link_to', 'problem'),
      'event_keys', jsonb_build_array('calendar', 'title', 'starts_on', 'ends_on', 'time_from', 'time_to',
                                      'location', 'max_participants', 'description', 'url', 'cancelled',
                                      'participants', 'problem'),
      'calendar_targets', jsonb_build_array('event', 'break', 'ignore'),
      'max_records_per_call', 1000)
  );
END;
$$;

-- Adds records to an open run: [{external_id, data}], at most 1000 per
-- call and 50'000 per run. Returns {staged, invalid}. A record staged twice
-- is seen but never applied ('duplicate': the provider's answer is ambiguous).
CREATE OR REPLACE FUNCTION public.integration_stage(p_run bigint, p_records jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run public.integration_runs%ROWTYPE;
  v_staged integer;
  v_invalid integer;
BEGIN
  SELECT * INTO v_run FROM public.integration_runs WHERE id = p_run;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  PERFORM public.integration_authorize(v_run.connection, true, v_run.started_by);
  IF v_run.status <> 'running' OR v_run.applied_at IS NOT NULL THEN
    RAISE EXCEPTION 'RUN_NOT_OPEN' USING ERRCODE = 'PT409';
  END IF;
  IF jsonb_typeof(p_records) IS DISTINCT FROM 'array' OR jsonb_array_length(p_records) > 1000 THEN
    RAISE EXCEPTION 'records: an array of at most 1000' USING ERRCODE = '22023';
  END IF;
  -- External ids end up in the run log: ids only (no spaces), never a name
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_records) x
              WHERE jsonb_typeof(x) <> 'object'
                 OR coalesce(btrim(public.integration_text(x->'external_id')), '') !~ '^[A-Za-z0-9_.:@/+=-]{1,200}$'
                 OR jsonb_typeof(x->'data') IS DISTINCT FROM 'object') THEN
    RAISE EXCEPTION 'records: each needs an external_id (letters, digits, _.:@/+=-) and data'
      USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.integration_records WHERE run_id = p_run)
     + jsonb_array_length(p_records) > 50000 THEN
    RAISE EXCEPTION 'records: too many for one run' USING ERRCODE = '22023';
  END IF;

  WITH x AS (
    SELECT btrim(public.integration_text(x->'external_id')) AS external_id,
           CASE v_run.kind WHEN 'members' THEN public.integration_normalize_member(x->'data')
                           ELSE public.integration_normalize_event(x->'data') END AS data,
           count(*) OVER (PARTITION BY btrim(public.integration_text(x->'external_id'))) AS n,
           row_number() OVER (PARTITION BY btrim(public.integration_text(x->'external_id'))) AS i
      FROM jsonb_array_elements(p_records) x
  ), ins AS (
    INSERT INTO public.integration_records AS r (run_id, external_id, data, problem)
    SELECT p_run, external_id, data, CASE WHEN n > 1 THEN 'duplicate' ELSE data->>'problem' END
      FROM x WHERE i = 1
    ON CONFLICT (run_id, external_id) DO UPDATE SET problem = 'duplicate'
    RETURNING r.problem
  )
  SELECT count(*), count(*) FILTER (WHERE problem IS NOT NULL) INTO v_staged, v_invalid FROM ins;

  RETURN jsonb_build_object('staged', v_staged, 'invalid', v_invalid);
END;
$$;

-----------------
-- Catalog registration (kept even when the apply is refused or dry, so
-- the Integrations page can show what is new)
-----------------

-- The label column of a group the provider calls p_name: NULL (the name is
-- the label), or, when another group of the connection already writes that
-- label or it is the app's own trial label, the name with the provider's
-- id ('Passiv (123)'). A status is looked up by the label text: a second
-- group called like a status group must not hand out its status.
CREATE OR REPLACE FUNCTION public.integration_group_label(
  p_connection text, p_name text, p_key text, p_except bigint DEFAULT NULL
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE WHEN p_name = 'probetraining' OR EXISTS (
                SELECT 1 FROM public.integration_member_groups g
                 WHERE g.connection = p_connection AND g.id IS DISTINCT FROM p_except
                   AND coalesce(g.label, g.name) = p_name)
              THEN p_name || ' (' || p_key || ')' END;
$$;

CREATE OR REPLACE FUNCTION public.integration_register_groups(p_run bigint, p_c public.integration_connections)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new integer;
  v_bound bigint[];
BEGIN
  -- Seeded rows are bound to the provider's id by their name: to the lowest
  -- id when several of the provider's groups have that name
  WITH staged AS (
    SELECT g->>'key' AS key, min(g->>'name') AS name
      FROM public.integration_records r, jsonb_array_elements(r.data->'groups') g
     WHERE r.run_id = p_run AND r.problem IS NULL
     GROUP BY 1
  ), bind AS (
    SELECT DISTINCT ON (mg.id) mg.id, s.key
      FROM staged s
      JOIN public.integration_member_groups mg
        ON mg.connection = p_c.id AND mg.external_id IS NULL AND mg.name = s.name
     WHERE NOT EXISTS (SELECT 1 FROM public.integration_member_groups x
                        WHERE x.connection = p_c.id AND x.external_id = s.key)
     ORDER BY mg.id, s.key
  ), bound AS (
    UPDATE public.integration_member_groups mg SET external_id = b.key
      FROM bind b WHERE mg.id = b.id
    RETURNING mg.id
  )
  SELECT array_agg(id) INTO v_bound FROM bound;

  -- New groups: no status (they change nobody's), hidden when they look
  -- like bookkeeping, not reviewed; a name another group's label already
  -- has (or a second new group's) gets the provider's id in its label.
  -- Except the other groups with the name of a seeded row bound just now
  -- (an archive folder titled like a status group): the old rule went by
  -- the title, so they copy that row's mapping, and nobody's status
  -- changes on the first run; an admin reviews them.
  WITH staged AS (
    SELECT g->>'key' AS key, min(g->>'name') AS name
      FROM public.integration_records r, jsonb_array_elements(r.data->'groups') g
     WHERE r.run_id = p_run AND r.problem IS NULL
     GROUP BY 1
  ), fresh AS (
    SELECT s.key, s.name, row_number() OVER (PARTITION BY s.name ORDER BY s.key) AS n
      FROM staged s
     WHERE NOT EXISTS (SELECT 1 FROM public.integration_member_groups x
                        WHERE x.connection = p_c.id AND x.external_id = s.key)
  ), ins AS (
    INSERT INTO public.integration_member_groups (connection, external_id, name, label, status, rank, hidden,
                                                  role, reviewed, last_seen_at)
    SELECT p_c.id, f.key, f.name,
           CASE WHEN f.n > 1 OR sd.id IS NOT NULL THEN f.name || ' (' || f.key || ')'
                ELSE public.integration_group_label(p_c.id, f.name, f.key) END,
           sd.status, coalesce(sd.rank, 100),
           coalesce(sd.hidden, f.name ~ (p_c.settings->>'hidden_group_pattern'), false),
           sd.role, false, now()
      FROM fresh f
      LEFT JOIN public.integration_member_groups sd
        ON sd.id = ANY (coalesce(v_bound, '{}')) AND sd.name = f.name
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_new FROM ins;
  RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION public.integration_register_calendars(p_run bigint, p_c public.integration_connections)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new integer;
BEGIN
  WITH staged AS (
    SELECT r.data->'calendar'->>'key' AS key, min(r.data->'calendar'->>'name') AS name
      FROM public.integration_records r
     WHERE r.run_id = p_run AND jsonb_typeof(r.data->'calendar') = 'object'
     GROUP BY 1
  ), bind AS (
    SELECT DISTINCT ON (ic.id) ic.id, s.key
      FROM staged s
      JOIN public.integration_calendars ic
        ON ic.connection = p_c.id AND ic.external_id IS NULL AND ic.name = s.name
     WHERE NOT EXISTS (SELECT 1 FROM public.integration_calendars x
                        WHERE x.connection = p_c.id AND x.external_id = s.key)
     ORDER BY ic.id, s.key
  )
  UPDATE public.integration_calendars ic SET external_id = b.key FROM bind b WHERE ic.id = b.id;

  -- New calendars hold events, in the section of the first matching rule
  WITH staged AS (
    SELECT r.data->'calendar'->>'key' AS key, min(r.data->'calendar'->>'name') AS name
      FROM public.integration_records r
     WHERE r.run_id = p_run AND jsonb_typeof(r.data->'calendar') = 'object'
     GROUP BY 1
  ), ins AS (
    INSERT INTO public.integration_calendars (connection, external_id, name, target, section, reviewed, last_seen_at)
    SELECT p_c.id, s.key, s.name, 'event',
           coalesce((SELECT x->>'section'
                       FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_c.settings->'section_rules') = 'array'
                                                      THEN p_c.settings->'section_rules' ELSE '[]'::jsonb END)
                            WITH ORDINALITY AS t(x, n)
                      WHERE coalesce(x->>'match', '') <> ''
                        AND strpos(lower(s.name), lower(x->>'match')) > 0
                      ORDER BY n LIMIT 1),
                    p_c.settings->>'default_section'),
           false, now()
      FROM staged s
     WHERE NOT EXISTS (SELECT 1 FROM public.integration_calendars x
                        WHERE x.connection = p_c.id AND x.external_id = s.key)
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_new FROM ins;
  RETURN v_new;
END;
$$;

-----------------
-- Membership status guard
-----------------

-- The members whose status a run (or a mapping change) of this connection
-- can change, with their status and whether they count now
-- (member_grants_access): linked to the connection, members staged records
-- name (link_to) or target, rows in its external id range. Taken before the
-- plan, which already rewrites labels of a renamed group. {id: [status, counts]}.
CREATE OR REPLACE FUNCTION public.integration_status_snapshot(p_c public.integration_connections, p_run bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(jsonb_object_agg(m.id::text, jsonb_build_array(
           m.membership_status,
           coalesce(public.member_grants_access(m.membership_status, m."archivedAt", m.labels), false))),
         '{}'::jsonb)
    FROM public.members m
   WHERE m.id IN (SELECT l.member_id FROM public.member_links l WHERE l.connection = p_c.id)
      OR m.id IN (SELECT r.target_id FROM public.integration_records r
                   WHERE r.run_id = p_run AND r.target_id IS NOT NULL)
      OR m.id IN (SELECT (r.data->>'link_to')::integer FROM public.integration_records r
                   WHERE r.run_id = p_run AND r.data ? 'link_to')
      OR (p_c.member_ids = 'external' AND m.id >= p_c.external_id_min AND m.id < p_c.external_id_max);
$$;

-- Compares the members of a snapshot with now: dropping (counted, no
-- longer do, apart from those going because the provider no longer has
-- them in this run: the gone guard's) and gaining (did not count, do now;
-- new members are not in the snapshot). Too many dropping: more than
-- max(drop_min, drop_share of those that counted) or more than
-- max(drop_min, drop_status_share of one status); too many gaining (mass
-- automatic approval): more than max(drop_min, drop_share). As the legacy
-- sync's plan_status_drop(), but on the statuses the database derived.
CREATE OR REPLACE FUNCTION public.integration_status_guard(
  p_c public.integration_connections, p_before jsonb, p_now timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH b AS (
    SELECT e.key::integer AS id, e.value->>0 AS status, (e.value->>1)::boolean AS counted
      FROM jsonb_each(p_before) e
  ), s AS (
    SELECT b.*,
           coalesce(public.member_grants_access(m.membership_status, m."archivedAt", m.labels), false) AS counts_now,
           coalesce(public.member_access_status(m.membership_status, m."archivedAt", m.labels), 'deleted') AS became,
           EXISTS (SELECT 1 FROM public.member_links l
                    WHERE l.member_id = b.id AND l.connection = p_c.id AND l.gone_at = p_now) AS going
      FROM b LEFT JOIN public.members m ON m.id = b.id
  ), d AS (
    SELECT * FROM s WHERE counted AND NOT counts_now AND NOT going
  ), n AS (
    SELECT (SELECT count(*) FROM s WHERE counted) AS counting,
           (SELECT count(*) FROM d) AS dropping,
           (SELECT count(*) FROM s WHERE NOT counted AND counts_now) AS gaining
  )
  SELECT jsonb_build_object(
    'counting', n.counting,
    'dropping', n.dropping,
    'gaining', n.gaining,
    'by_status', (SELECT coalesce(jsonb_object_agg(status, k), '{}'::jsonb)
                    FROM (SELECT status, count(*) AS k FROM d GROUP BY status) x),
    'became', (SELECT coalesce(jsonb_object_agg(became, k), '{}'::jsonb)
                 FROM (SELECT became, count(*) AS k FROM d GROUP BY became) x),
    'limit', greatest(p_c.drop_min, floor(n.counting * p_c.drop_share)::integer),
    'over_drop', n.dropping > greatest(p_c.drop_min, floor(n.counting * p_c.drop_share))
                 OR EXISTS (SELECT 1
                              FROM (SELECT status, count(*) AS k FROM d GROUP BY status) x
                             WHERE x.k > greatest(p_c.drop_min, floor(
                                     (SELECT count(*) FROM s WHERE s.counted AND s.status = x.status)
                                     * p_c.drop_status_share))),
    'over_gain', n.gaining > greatest(p_c.drop_min, floor(n.counting * p_c.drop_share))
  )
  FROM n;
$$;

-----------------
-- apply: members
-----------------

-- Plan: labels and identity, written into the run's records. Writes
-- nothing else. Returns the gone guard's numbers.
CREATE OR REPLACE FUNCTION public.integration_plan_members(p_run bigint, p_c public.integration_connections)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_complete boolean;
  v_staged integer;
  v_active integer;
  v_gone integer := 0;
  v_former integer := 0;
  g record;
  v_label text;
BEGIN
  SELECT coalesce((scope->>'complete')::boolean, false) INTO v_complete
    FROM public.integration_runs WHERE id = p_run;

  -- Renamed in the provider: the catalog follows, and so does the label of
  -- every member whose status this connection decides (any link of it, or
  -- a row in its id range without a link), not only of the records written
  -- below: a status is looked up by the label text, so a member left with
  -- the old label (a problem record, a partial run) would lose its status.
  -- A label set apart ('Probetraining') stays; one with the provider's id
  -- appended follows the name (integration_group_label()).
  FOR g IN
    WITH staged AS (
      SELECT x->>'key' AS key, min(x->>'name') AS name
        FROM public.integration_records r, jsonb_array_elements(r.data->'groups') x
       WHERE r.run_id = p_run AND r.problem IS NULL
       GROUP BY 1
    )
    SELECT mg.id, mg.external_id, mg.name AS old_name, s.name AS new_name, mg.label,
           coalesce(mg.label, mg.name) AS old_label
      FROM public.integration_member_groups mg
      JOIN staged s ON s.key = mg.external_id
     WHERE mg.connection = p_c.id AND mg.name <> s.name
     ORDER BY mg.id
  LOOP
    v_label := CASE WHEN g.label IS NULL OR g.label = g.old_name || ' (' || g.external_id || ')'
                    THEN public.integration_group_label(p_c.id, g.new_name, g.external_id, g.id)
                    ELSE g.label END;
    UPDATE public.integration_member_groups SET name = g.new_name, label = v_label WHERE id = g.id;
    IF coalesce(v_label, g.new_name) <> g.old_label THEN
      UPDATE public.members m
         SET labels = (SELECT jsonb_agg(CASE WHEN y.x = to_jsonb(g.old_label)
                                             THEN to_jsonb(coalesce(v_label, g.new_name)) ELSE y.x END
                                        ORDER BY y.o)
                         FROM jsonb_array_elements(m.labels) WITH ORDINALITY y(x, o))
       WHERE jsonb_typeof(m.labels) = 'array' AND m.labels ? g.old_label
         AND (EXISTS (SELECT 1 FROM public.member_links l WHERE l.member_id = m.id AND l.connection = p_c.id)
              OR (p_c.member_ids = 'external' AND m.id >= p_c.external_id_min AND m.id < p_c.external_id_max
                  AND NOT EXISTS (SELECT 1 FROM public.member_links l WHERE l.member_id = m.id)));
    END IF;
  END LOOP;

  UPDATE public.integration_member_groups mg SET last_seen_at = now()
   WHERE mg.connection = p_c.id
     AND mg.external_id IN (SELECT x->>'key'
                              FROM public.integration_records r, jsonb_array_elements(r.data->'groups') x
                             WHERE r.run_id = p_run AND r.problem IS NULL);

  -- Labels: the groups' labels in the provider's order, each once
  UPDATE public.integration_records r
     SET labels = coalesce((
           SELECT jsonb_agg(t.label ORDER BY t.ord)
             FROM (SELECT coalesce(mg.label, mg.name) AS label, min(x.ord) AS ord
                     FROM jsonb_array_elements(r.data->'groups') WITH ORDINALITY x(g, ord)
                     JOIN public.integration_member_groups mg
                       ON mg.connection = p_c.id AND mg.external_id = x.g->>'key'
                    GROUP BY 1) t), '[]'::jsonb)
   WHERE r.run_id = p_run AND r.problem IS NULL AND r.data ? 'groups';

  -- 1. The record's link (also a gone one: the member is back, unless it
  --    has meanwhile a live link of another connection)
  UPDATE public.integration_records r
     SET target_id = l.member_id,
         action = CASE WHEN r.problem IS NOT NULL THEN 'invalid'
                       WHEN l.gone_at IS NULL THEN 'update'
                       WHEN EXISTS (SELECT 1 FROM public.member_links o
                                     WHERE o.member_id = l.member_id AND o.gone_at IS NULL)
                         THEN 'conflict'
                       ELSE 'revive' END,
         match = CASE WHEN r.problem IS NULL AND l.gone_at IS NOT NULL AND EXISTS (
                        SELECT 1 FROM public.member_links o WHERE o.member_id = l.member_id AND o.gone_at IS NULL)
                      THEN 'linked_elsewhere' END
    FROM public.member_links l
   WHERE r.run_id = p_run AND l.connection = p_c.id AND l.external_id = r.external_id;

  UPDATE public.integration_records r SET action = 'invalid'
   WHERE r.run_id = p_run AND r.action IS NULL AND r.problem IS NOT NULL;

  -- 2. link_to: an admin matched the record to a member when reviewing an
  --    import (connections with app ids); the member must not be in a
  --    provider already
  UPDATE public.integration_records r
     SET target_id = m.id,
         action = CASE WHEN p_c.member_ids <> 'app'
                         OR EXISTS (SELECT 1 FROM public.member_links l
                                     WHERE l.member_id = m.id AND (l.gone_at IS NULL OR l.connection = p_c.id))
                       THEN 'conflict' ELSE 'adopt' END,
         match = 'link_to'
    FROM public.members m
   WHERE r.run_id = p_run AND r.action IS NULL AND m.id = (r.data->>'link_to')::integer;
  UPDATE public.integration_records r SET action = 'conflict', match = 'link_to'
   WHERE r.run_id = p_run AND r.action IS NULL AND r.data ? 'link_to';
  UPDATE public.integration_records r SET match = NULL
   WHERE r.run_id = p_run AND r.action = 'adopt' AND r.match = 'link_to';

  -- 3. Connections whose ids are row ids: a row with that id and no link at
  --    all is taken over (rows the legacy sync wrote); one linked anywhere
  --    is a conflict. Ids outside the range are invalid.
  IF p_c.member_ids = 'external' THEN
    UPDATE public.integration_records r
       SET action = 'invalid', problem = 'id_out_of_range'
     WHERE r.run_id = p_run AND r.action IS NULL
       AND NOT (r.external_id ~ '^[1-9]\d{0,8}$'
                AND r.external_id::bigint >= p_c.external_id_min
                AND r.external_id::bigint < p_c.external_id_max);
    UPDATE public.integration_records r
       SET target_id = m.id,
           action = CASE WHEN EXISTS (SELECT 1 FROM public.member_links l WHERE l.member_id = m.id)
                         THEN 'conflict' ELSE 'adopt' END,
           match = CASE WHEN EXISTS (SELECT 1 FROM public.member_links l WHERE l.member_id = m.id)
                        THEN 'id_taken' END
      FROM public.members m
     WHERE r.run_id = p_run AND r.action IS NULL AND m.id = r.external_id::integer;
  END IF;

  -- Two records for one member: the first keeps it
  WITH t AS (
    SELECT r.external_id,
           row_number() OVER (PARTITION BY r.target_id
                              ORDER BY CASE r.action WHEN 'update' THEN 0 WHEN 'revive' THEN 1 ELSE 2 END,
                                       r.external_id) AS i
      FROM public.integration_records r
     WHERE r.run_id = p_run AND r.action IN ('update', 'revive', 'adopt')
  )
  UPDATE public.integration_records r SET action = 'conflict', match = 'member_twice'
    FROM t WHERE r.run_id = p_run AND r.external_id = t.external_id AND t.i > 1;

  -- 4. New. A record that looks like a member the connection does not have
  --    is held back when the connection says so (never merged here).
  WITH d AS (
    SELECT r.external_id, x.id, x.how
      FROM public.integration_records r
     CROSS JOIN LATERAL (
       SELECT m.id,
              CASE WHEN p_c.duplicate_match IN ('email', 'email_or_name_birthday')
                        AND public.normalize_email(r.data->>'email') IS NOT NULL
                        AND public.normalize_email(m.email) = public.normalize_email(r.data->>'email')
                   THEN 'email' ELSE 'name_birthday' END AS how
         FROM public.members m
        WHERE NOT EXISTS (SELECT 1 FROM public.member_links l
                           WHERE l.member_id = m.id AND l.connection = p_c.id AND l.gone_at IS NULL)
          AND ((p_c.duplicate_match IN ('email', 'email_or_name_birthday')
                AND public.normalize_email(r.data->>'email') IS NOT NULL
                AND public.normalize_email(m.email) = public.normalize_email(r.data->>'email'))
            OR (p_c.duplicate_match IN ('name_birthday', 'email_or_name_birthday')
                AND coalesce(r.data->>'birthday', '') <> '' AND m.birthday = r.data->>'birthday'
                AND lower(m.lastname) = lower(r.data->>'lastname')
                AND lower(btrim(m.firstname)) = lower(coalesce(r.data->>'firstname', ''))))
        ORDER BY m.id
        LIMIT 1) x
     WHERE r.run_id = p_run AND r.action IS NULL
  )
  UPDATE public.integration_records r
     SET match_id = d.id, match = d.how
    FROM d
   WHERE r.run_id = p_run AND r.external_id = d.external_id;

  UPDATE public.integration_records r
     SET action = CASE WHEN r.match_id IS NOT NULL AND p_c.on_possible_duplicate = 'skip' THEN 'held'
                       ELSE 'insert' END,
         target_id = CASE WHEN r.match_id IS NOT NULL AND p_c.on_possible_duplicate = 'skip' THEN NULL
                          WHEN p_c.member_ids = 'external' THEN r.external_id::bigint END
   WHERE r.run_id = p_run AND r.action IS NULL;

  -- Gone guard numbers: live links the run did not see, and (ids are row
  -- ids) rows in the range never linked and not staged (any record with
  -- that external id counts as seen, also one with a problem)
  SELECT count(*) INTO v_staged FROM public.integration_records WHERE run_id = p_run;
  SELECT count(*) INTO v_active FROM public.member_links WHERE connection = p_c.id AND gone_at IS NULL;
  IF v_complete THEN
    SELECT count(*) INTO v_gone
      FROM public.member_links l
     WHERE l.connection = p_c.id AND l.gone_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.integration_records r
                        WHERE r.run_id = p_run AND r.external_id = l.external_id);
    IF p_c.member_ids = 'external' THEN
      SELECT count(*) INTO v_former
        FROM public.members m
       WHERE m.id >= p_c.external_id_min AND m.id < p_c.external_id_max
         AND NOT EXISTS (SELECT 1 FROM public.member_links l WHERE l.member_id = m.id)
         AND NOT EXISTS (SELECT 1 FROM public.integration_records r
                          WHERE r.run_id = p_run AND r.external_id = m.id::text);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'complete', v_complete,
    'staged', v_staged,
    'active_links', v_active,
    'to_gone', v_gone,
    'former', v_former,
    'limit', greatest(p_c.gone_min, floor(v_active * p_c.gone_share)::integer)
  );
END;
$$;

-- One member record: insert, adopt, revive or update with the field
-- policy. Runs inside its own subtransaction (integration_write_members).
-- A new member is inserted without e-mail, then linked, then given its
-- e-mail: the automatic approval (grant_member_access) only ever sees the
-- provider's status, never an interim "created in Administra". A member
-- back in the provider is written first and linked again after (its status
-- stays 'left' until then), so neither sees a status from its old labels.
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
  v_labels jsonb;
  v_n integer;
BEGIN
  IF v_creating THEN
    IF v_id IS NULL THEN
      v_id := nextval(pg_get_serial_sequence('public.members', 'id'));
    END IF;
    INSERT INTO public.members (id, firstname, lastname, birthday, mobile, labels)
    VALUES (v_id,
            coalesce(public.integration_pick(v_pol->>'member.firstname', d ? 'firstname', d->>'firstname', NULL, true),
                     d->>'firstname', ''),
            coalesce(public.integration_pick(v_pol->>'member.lastname', true, d->>'lastname', NULL, true),
                     d->>'lastname'),
            public.integration_pick(v_pol->>'member.birthday', d ? 'birthday', d->>'birthday', NULL, true),
            public.integration_pick(v_pol->>'member.mobile', d ? 'mobile', d->>'mobile', NULL, true),
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
  v_labels := CASE
    WHEN NOT (d ? 'groups') OR p_r.labels IS NULL THEN m.labels
    WHEN v_pol->>'member.labels' = 'owned' THEN p_r.labels
    WHEN v_pol->>'member.labels' = 'fill' AND jsonb_array_length(p_r.labels) > 0 THEN p_r.labels
    ELSE m.labels END;

  UPDATE public.members
     SET firstname = v_first, lastname = v_last, birthday = v_birth, mobile = v_mobile,
         email = v_email, labels = v_labels
   WHERE id = v_id
     AND (firstname, lastname, birthday, mobile, email, labels)
         IS DISTINCT FROM (v_first, v_last, v_birth, v_mobile, v_email, v_labels);
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

-- Writes the planned members (each record alone: one the database refuses
-- is noted as write_failed, the others go on), then seen and gone marks
-- and statuses a changed catalog changes
CREATE OR REPLACE FUNCTION public.integration_write_members(
  p_run bigint, p_c public.integration_connections, p_now timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_complete boolean;
  r public.integration_records%ROWTYPE;
  v_result text;
  v_state text;
  v_gone integer := 0;
  v_former integer := 0;
  v_statuses integer;
BEGIN
  SELECT coalesce((scope->>'complete')::boolean, false) INTO v_complete
    FROM public.integration_runs WHERE id = p_run;

  FOR r IN SELECT * FROM public.integration_records
            WHERE run_id = p_run AND action IN ('insert', 'adopt', 'revive', 'update')
            ORDER BY external_id
  LOOP
    BEGIN
      v_result := public.integration_write_member(p_c, r, p_now);
      UPDATE public.integration_records SET result = v_result
       WHERE run_id = p_run AND external_id = r.external_id;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      -- A failed insert created no row: the planned id (the provider's)
      -- must not end up in the issue as a member or event that exists
      UPDATE public.integration_records
         SET action = 'error', result = 'error', error = lower(v_state),
             target_id = CASE WHEN action = 'insert' THEN NULL ELSE target_id END
       WHERE run_id = p_run AND external_id = r.external_id;
    END;
  END LOOP;

  -- Seen (also records with a problem or a failed write): last_seen_at
  -- without touching gone_at (no status trigger)
  UPDATE public.member_links l SET last_seen_at = p_now
    FROM public.integration_records r2
   WHERE r2.run_id = p_run AND l.connection = p_c.id AND l.external_id = r2.external_id
     AND l.gone_at IS NULL AND l.last_seen_at IS DISTINCT FROM p_now;

  IF v_complete THEN
    UPDATE public.member_links l SET gone_at = p_now
     WHERE l.connection = p_c.id AND l.gone_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.integration_records r2
                        WHERE r2.run_id = p_run AND r2.external_id = l.external_id);
    GET DIAGNOSTICS v_gone = ROW_COUNT;
    -- Rows in the provider's id range it does not have and that were never
    -- linked (legacy): recorded as gone, so they count as having left
    IF p_c.member_ids = 'external' THEN
      INSERT INTO public.member_links (connection, external_id, member_id, gone_at)
      SELECT p_c.id, m.id::text, m.id, p_now
        FROM public.members m
       WHERE m.id >= p_c.external_id_min AND m.id < p_c.external_id_max
         AND NOT EXISTS (SELECT 1 FROM public.member_links l WHERE l.member_id = m.id)
         AND NOT EXISTS (SELECT 1 FROM public.integration_records r2
                          WHERE r2.run_id = p_run AND r2.external_id = m.id::text)
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_former = ROW_COUNT;
    END IF;
  END IF;

  -- Statuses the catalog changes without the labels changing (none with
  -- this run's catalog changes: a renamed group's labels follow in the
  -- plan, new groups have no status); kept as a safety net
  UPDATE public.members m
     SET membership_status = public.member_status_for(m.id, m.labels)
    FROM public.member_links l
   WHERE l.member_id = m.id AND l.connection = p_c.id AND l.gone_at IS NULL
     AND m.membership_status IS DISTINCT FROM public.member_status_for(m.id, m.labels);
  GET DIAGNOSTICS v_statuses = ROW_COUNT;

  RETURN (
    SELECT jsonb_build_object(
      'received', count(*),
      'inserted', count(*) FILTER (WHERE result = 'inserted'),
      'adopted', count(*) FILTER (WHERE result = 'adopted'),
      'revived', count(*) FILTER (WHERE result = 'revived'),
      'updated', count(*) FILTER (WHERE result = 'updated'),
      'unchanged', count(*) FILTER (WHERE result = 'unchanged'),
      'invalid', count(*) FILTER (WHERE action = 'invalid'),
      'conflicts', count(*) FILTER (WHERE action = 'conflict'),
      'held', count(*) FILTER (WHERE action = 'held'),
      'write_failed', count(*) FILTER (WHERE action = 'error'),
      'gone', v_gone,
      'former', v_former,
      'statuses_recomputed', v_statuses)
    FROM public.integration_records WHERE run_id = p_run);
END;
$$;

-- Issues of a members run: noted, and the ones a run that checks them no
-- longer observes resolved. Dismissed ones stay closed. Codes and ids only.
-- An issue about a record is checked by a complete run, or by a partial run
-- that staged that record; the duplicate scan of linked members checks
-- every run.
CREATE OR REPLACE FUNCTION public.integration_note_member_issues(p_run bigint, p_c public.integration_connections)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_complete boolean;
  v_noted integer;
  v_resolved integer;
BEGIN
  SELECT coalesce((scope->>'complete')::boolean, false) INTO v_complete
    FROM public.integration_runs WHERE id = p_run;

  WITH seen (code, severity, external_id, member_id, other_member_id, detail) AS (
    -- Records the run could not write (fetch errors are the adapter's)
    SELECT 'invalid_record', 'warning', r.external_id, r.target_id::integer, NULL::integer, r.problem
      FROM public.integration_records r
     WHERE r.run_id = p_run AND r.action = 'invalid' AND coalesce(r.problem, '') <> 'fetch_failed'
    UNION ALL
    SELECT 'id_conflict', 'error', r.external_id, r.target_id::integer, NULL::integer, r.match
      FROM public.integration_records r
     WHERE r.run_id = p_run AND r.action = 'conflict'
    UNION ALL
    -- (no member for a failed insert: the issue names the record only)
    SELECT 'write_failed', 'error', r.external_id, r.target_id::integer, NULL::integer, r.error
      FROM public.integration_records r
     WHERE r.run_id = p_run AND r.action = 'error'
    UNION ALL
    -- A value the provider has that is not valid here (the current one is kept)
    SELECT 'invalid_value', 'info', r.external_id, r.target_id::integer, NULL::integer, f
      FROM public.integration_records r, jsonb_array_elements_text(r.data->'invalid') f
     WHERE r.run_id = p_run AND r.result IN ('inserted', 'adopted', 'revived', 'updated', 'unchanged')
    UNION ALL
    -- Held back: looks like a member the connection does not have
    SELECT 'possible_duplicate', 'warning', r.external_id, NULL::integer, r.match_id, r.match
      FROM public.integration_records r
     WHERE r.run_id = p_run AND r.action = 'held'
    UNION ALL
    -- A member of this connection and another member not in it (created in
    -- Administra, gone from it, or from another provider) with the same
    -- e-mail, or the same name and birthday. For a merge (merge_members).
    SELECT DISTINCT ON (a.id, b.id) 'possible_duplicate', 'warning', l.external_id, a.id, b.id,
           CASE WHEN t.m_email THEN 'email' ELSE 'name_birthday' END
      FROM public.member_links l
      JOIN public.members a ON a.id = l.member_id
      JOIN public.members b
        ON b.id <> a.id
       AND NOT EXISTS (SELECT 1 FROM public.member_links x
                        WHERE x.member_id = b.id AND x.connection = p_c.id AND x.gone_at IS NULL)
     CROSS JOIN LATERAL (SELECT
           p_c.duplicate_match IN ('email', 'email_or_name_birthday')
           AND public.normalize_email(a.email) IS NOT NULL
           AND public.normalize_email(a.email) = public.normalize_email(b.email) AS m_email,
           p_c.duplicate_match IN ('name_birthday', 'email_or_name_birthday')
           AND coalesce(a.birthday, '') <> '' AND a.birthday = b.birthday
           AND lower(btrim(a.lastname)) = lower(btrim(b.lastname))
           AND lower(btrim(a.firstname)) = lower(btrim(b.firstname)) AS m_name) t
     WHERE l.connection = p_c.id AND l.gone_at IS NULL AND (t.m_email OR t.m_name)
  )
  INSERT INTO public.integration_issues AS i (connection, kind, code, severity, external_id, member_id,
                                              other_member_id, detail, first_run, last_run)
  SELECT DISTINCT ON (s.code, coalesce(s.external_id, ''), coalesce(s.member_id, 0), coalesce(s.other_member_id, 0))
         p_c.id, 'members', s.code, s.severity, coalesce(s.external_id, ''), s.member_id, s.other_member_id,
         CASE WHEN s.detail ~ '^[a-z0-9_]{1,40}$' THEN s.detail END, p_run, p_run
    FROM seen s
   ORDER BY s.code, coalesce(s.external_id, ''), coalesce(s.member_id, 0), coalesce(s.other_member_id, 0)
  ON CONFLICT (connection, kind, code, external_id, (coalesce(member_id, 0)),
               (coalesce(other_member_id, 0)), (coalesce(event_id, 0)))
  DO UPDATE SET last_run = p_run, last_seen_at = now(), detail = EXCLUDED.detail,
                severity = EXCLUDED.severity, resolved_at = NULL,
                first_run = CASE WHEN i.resolved_at IS NOT NULL THEN p_run ELSE i.first_run END,
                first_seen_at = CASE WHEN i.resolved_at IS NOT NULL THEN now() ELSE i.first_seen_at END;
  GET DIAGNOSTICS v_noted = ROW_COUNT;

  UPDATE public.integration_issues i SET resolved_at = now()
   WHERE i.connection = p_c.id AND i.kind = 'members' AND i.resolved_at IS NULL
     AND i.last_run IS DISTINCT FROM p_run
     AND ((i.code = 'possible_duplicate' AND i.member_id IS NOT NULL)
          OR (i.code IN ('invalid_record', 'id_conflict', 'write_failed', 'invalid_value', 'possible_duplicate')
              AND (v_complete OR EXISTS (SELECT 1 FROM public.integration_records r
                                          WHERE r.run_id = p_run AND r.external_id = i.external_id))));
  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  RETURN jsonb_build_object(
    'noted', v_noted,
    'resolved', v_resolved,
    'open', (SELECT count(*) FROM public.integration_issues
              WHERE connection = p_c.id AND resolved_at IS NULL AND dismissed_at IS NULL));
END;
$$;

-----------------
-- apply: events, holidays, registrations
-----------------

CREATE OR REPLACE FUNCTION public.integration_plan_events(p_run bigint, p_c public.integration_connections)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_scope jsonb;
  v_from text;
  v_active integer;
  v_gone integer;
BEGIN
  SELECT scope INTO v_scope FROM public.integration_runs WHERE id = p_run;
  v_from := v_scope->>'from';

  WITH staged AS (
    SELECT r.data->'calendar'->>'key' AS key, min(r.data->'calendar'->>'name') AS name
      FROM public.integration_records r
     WHERE r.run_id = p_run AND jsonb_typeof(r.data->'calendar') = 'object'
     GROUP BY 1
  )
  UPDATE public.integration_calendars ic SET name = s.name, last_seen_at = now()
    FROM staged s WHERE ic.connection = p_c.id AND ic.external_id = s.key;

  UPDATE public.integration_records r SET calendar_id = ic.id, route = ic.target
    FROM public.integration_calendars ic
   WHERE r.run_id = p_run AND ic.connection = p_c.id AND ic.external_id = r.data->'calendar'->>'key';

  -- What is not applied: problems, ignored calendars, cancelled, before the window
  UPDATE public.integration_records r
     SET action = CASE WHEN r.problem IS NOT NULL THEN 'invalid'
                       WHEN r.route = 'ignore' THEN 'ignored'
                       WHEN (r.data->>'cancelled')::boolean THEN 'cancelled'
                       WHEN coalesce(r.data->>'ends_on', r.data->>'starts_on') < v_from THEN 'out_of_scope'
                  END
   WHERE r.run_id = p_run;

  -- Events: the link, else (ids are row ids) an unlinked row with the
  -- provider's id (all events the legacy sync wrote), else new
  UPDATE public.integration_records r
     SET target_id = l.event_id,
         action = CASE WHEN l.gone_at IS NULL THEN 'update'
                       WHEN EXISTS (SELECT 1 FROM public.event_links o
                                     WHERE o.event_id = l.event_id AND o.gone_at IS NULL) THEN 'conflict'
                       ELSE 'revive' END
    FROM public.event_links l
   WHERE r.run_id = p_run AND r.route = 'event' AND r.action IS NULL
     AND l.connection = p_c.id AND l.external_id = r.external_id;

  IF p_c.event_ids = 'external' THEN
    UPDATE public.integration_records r SET action = 'invalid', problem = 'id_out_of_range'
     WHERE r.run_id = p_run AND r.route = 'event' AND r.action IS NULL
       AND NOT (r.external_id ~ '^[1-9]\d{0,8}$'
                AND r.external_id::bigint >= p_c.external_id_min
                AND r.external_id::bigint < p_c.external_id_max);
    UPDATE public.integration_records r
       SET target_id = e.id,
           action = CASE WHEN EXISTS (SELECT 1 FROM public.event_links l WHERE l.event_id = e.id)
                         THEN 'conflict' ELSE 'adopt' END,
           match = CASE WHEN EXISTS (SELECT 1 FROM public.event_links l WHERE l.event_id = e.id)
                        THEN 'id_taken' END
      FROM public.events e
     WHERE r.run_id = p_run AND r.route = 'event' AND r.action IS NULL
       AND e.id = r.external_id::integer;
  END IF;

  UPDATE public.integration_records r
     SET action = 'insert',
         target_id = CASE WHEN p_c.event_ids = 'external' THEN r.external_id::bigint END
   WHERE r.run_id = p_run AND r.route = 'event' AND r.action IS NULL;

  -- Holidays: the link, else a TK row with the same title and dates (the
  -- same fact; taken over), else new
  UPDATE public.integration_records r SET target_id = b.id, action = 'update'
    FROM public.training_plan_breaks b
   WHERE r.run_id = p_run AND r.route = 'break' AND r.action IS NULL
     AND b.connection = p_c.id AND b.external_id = r.external_id;

  WITH m AS (
    SELECT DISTINCT ON (b.id) b.id, r.external_id
      FROM public.integration_records r
      JOIN public.training_plan_breaks b
        ON b.connection IS NULL
       AND lower(btrim(b.title)) = lower(btrim(r.data->>'title'))
       AND b.date_from = r.data->>'starts_on'
       AND b.date_to = coalesce(r.data->>'ends_on', r.data->>'starts_on')
     WHERE r.run_id = p_run AND r.route = 'break' AND r.action IS NULL
     ORDER BY b.id, r.external_id
  )
  UPDATE public.integration_records r SET target_id = m.id, action = 'adopt'
    FROM m
   WHERE r.run_id = p_run AND r.external_id = m.external_id AND r.action IS NULL;

  UPDATE public.integration_records r SET action = 'insert'
   WHERE r.run_id = p_run AND r.route = 'break' AND r.action IS NULL;

  -- Gone: live links (and provider holidays) of the calendars this run read
  -- completely, within the window, that the run did not see as such
  -- (deleted, cancelled, or their calendar now holds holidays or is
  -- ignored). Records with a problem and records before the window count
  -- as seen. Nothing goes when the scope is not complete.
  IF coalesce((v_scope->>'complete')::boolean, false) THEN
    WITH cal AS (
      SELECT ic.id FROM public.integration_calendars ic
       WHERE ic.connection = p_c.id
         AND ic.external_id IN (SELECT jsonb_array_elements_text(v_scope->'calendars'))
    ), live AS (
      SELECT l.external_id, 'event' AS kind
        FROM public.event_links l JOIN public.events e ON e.id = l.event_id
       WHERE l.connection = p_c.id AND l.gone_at IS NULL AND l.calendar_id IN (SELECT id FROM cal)
         AND coalesce(e.date_to, e.date) >= v_from
      UNION ALL
      SELECT b.external_id, 'break'
        FROM public.training_plan_breaks b
       WHERE b.connection = p_c.id AND b.calendar_id IN (SELECT id FROM cal) AND b.date_to >= v_from
    )
    SELECT count(*),
           count(*) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM public.integration_records r
              WHERE r.run_id = p_run AND r.external_id = live.external_id
                AND (r.problem IS NOT NULL OR r.action = 'out_of_scope' OR r.route = live.kind)
                AND coalesce(r.action, '') NOT IN ('cancelled', 'ignored')))
      INTO v_active, v_gone
      FROM live;
  ELSE
    SELECT count(*) INTO v_active FROM public.event_links WHERE connection = p_c.id AND gone_at IS NULL;
    v_gone := 0;
  END IF;

  RETURN jsonb_build_object(
    'complete', coalesce((v_scope->>'complete')::boolean, false),
    'staged', (SELECT count(*) FROM public.integration_records WHERE run_id = p_run),
    'active_links', v_active,
    'to_gone', v_gone,
    'limit', greatest(p_c.gone_min, floor(v_active * p_c.gone_share)::integer)
  );
END;
$$;

-- One event or holiday record (own subtransaction, see integration_write_events)
CREATE OR REPLACE FUNCTION public.integration_write_event(
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
  v_id bigint := p_r.target_id;
  v_section text;
  v_closed_max integer;
  e public.events%ROWTYPE;
  b public.training_plan_breaks%ROWTYPE;
  v_title text;
  v_date text;
  v_date_to text;
  v_from text;
  v_to text;
  v_location text;
  v_max text;
  v_desc text;
  v_sec text;
  v_n integer;
BEGIN
  SELECT ic.section, ic.closed_max_days INTO v_section, v_closed_max
    FROM public.integration_calendars ic WHERE ic.id = p_r.calendar_id;

  IF p_r.route = 'break' THEN
    v_date_to := coalesce(d->>'ends_on', d->>'starts_on');
    IF v_creating THEN
      INSERT INTO public.training_plan_breaks (title, date_from, date_to, cancels_training, connection,
                                               external_id, calendar_id, last_seen_at)
      VALUES (d->>'title', d->>'starts_on', v_date_to,
              v_closed_max IS NULL OR v_date_to::date - (d->>'starts_on')::date + 1 <= v_closed_max,
              p_c.id, p_r.external_id, p_r.calendar_id, p_now)
      RETURNING id INTO v_id;
      UPDATE public.integration_records SET target_id = v_id
       WHERE run_id = p_r.run_id AND external_id = p_r.external_id;
      RETURN 'inserted';
    END IF;
    SELECT * INTO b FROM public.training_plan_breaks WHERE id = v_id FOR UPDATE;
    v_title := coalesce(public.integration_pick(v_pol->>'break.title', true, d->>'title', b.title, false), b.title);
    v_from := coalesce(public.integration_pick(v_pol->>'break.date_from', true, d->>'starts_on', b.date_from, false), b.date_from);
    v_to := coalesce(public.integration_pick(v_pol->>'break.date_to', true, v_date_to, b.date_to, false), b.date_to);
    UPDATE public.training_plan_breaks
       SET title = v_title, date_from = v_from, date_to = v_to,
           connection = p_c.id, external_id = p_r.external_id, calendar_id = p_r.calendar_id,
           last_seen_at = p_now
     WHERE id = v_id;
    RETURN CASE WHEN p_r.action = 'adopt' THEN 'adopted'
                WHEN (b.title, b.date_from, b.date_to) IS DISTINCT FROM (v_title, v_from, v_to) THEN 'updated'
                ELSE 'unchanged' END;
  END IF;

  IF v_creating THEN
    IF v_id IS NULL THEN
      v_id := nextval(pg_get_serial_sequence('public.events', 'id'));
    END IF;
    INSERT INTO public.events (id, title, date, date_to, "timeFrom", "timeTo", location, section,
                               "maxParticipants", description)
    VALUES (v_id, d->>'title', d->>'starts_on',
            public.integration_pick(v_pol->>'event.date_to', d ? 'ends_on', d->>'ends_on', NULL, true),
            public.integration_pick(v_pol->>'event.timeFrom', d ? 'time_from', d->>'time_from', NULL, true),
            public.integration_pick(v_pol->>'event.timeTo', d ? 'time_to', d->>'time_to', NULL, true),
            public.integration_pick(v_pol->>'event.location', d ? 'location', d->>'location', NULL, true),
            public.integration_pick(v_pol->>'event.section', true, v_section, NULL, true),
            public.integration_pick(v_pol->>'event.maxParticipants', d ? 'max_participants',
                                    d->>'max_participants', NULL, true)::integer,
            public.integration_pick(v_pol->>'event.description', d ? 'description', d->>'description', NULL, true));
    INSERT INTO public.event_links (connection, external_id, event_id, calendar_id, url, last_seen_at)
    VALUES (p_c.id, p_r.external_id, v_id, p_r.calendar_id, d->>'url', p_now);
    UPDATE public.integration_records SET target_id = v_id
     WHERE run_id = p_r.run_id AND external_id = p_r.external_id;
    RETURN 'inserted';
  END IF;

  IF p_r.action = 'adopt' THEN
    INSERT INTO public.event_links (connection, external_id, event_id, calendar_id, url, last_seen_at)
    VALUES (p_c.id, p_r.external_id, v_id, p_r.calendar_id, d->>'url', p_now);
  ELSE
    UPDATE public.event_links
       SET gone_at = NULL, last_seen_at = p_now, calendar_id = p_r.calendar_id,
           url = coalesce(d->>'url', url)
     WHERE connection = p_c.id AND external_id = p_r.external_id;
  END IF;

  SELECT * INTO e FROM public.events WHERE id = v_id FOR UPDATE;
  v_title := coalesce(public.integration_pick(v_pol->>'event.title', true, d->>'title', e.title, false), e.title);
  v_date := coalesce(public.integration_pick(v_pol->>'event.date', true, d->>'starts_on', e.date, false), e.date);
  v_date_to := public.integration_pick(v_pol->>'event.date_to', d ? 'ends_on', d->>'ends_on', e.date_to, false);
  v_from := public.integration_pick(v_pol->>'event.timeFrom', d ? 'time_from', d->>'time_from', e."timeFrom", false);
  v_to := public.integration_pick(v_pol->>'event.timeTo', d ? 'time_to', d->>'time_to', e."timeTo", false);
  v_location := public.integration_pick(v_pol->>'event.location', d ? 'location', d->>'location', e.location, false);
  v_sec := public.integration_pick(v_pol->>'event.section', true, v_section, e.section, false);
  v_max := public.integration_pick(v_pol->>'event.maxParticipants', d ? 'max_participants',
                                   d->>'max_participants', e."maxParticipants"::text, false);
  v_desc := public.integration_pick(v_pol->>'event.description', d ? 'description', d->>'description',
                                    e.description, false);
  -- A one-day event cannot end before it starts
  IF v_date_to <= v_date THEN
    v_date_to := NULL;
  END IF;

  UPDATE public.events
     SET title = v_title, date = v_date, date_to = v_date_to, "timeFrom" = v_from, "timeTo" = v_to,
         location = v_location, section = v_sec, "maxParticipants" = v_max::integer,
         description = v_desc, "updatedAt" = p_now
   WHERE id = v_id
     AND (title, date, date_to, "timeFrom", "timeTo", location, section, "maxParticipants", description)
         IS DISTINCT FROM (v_title, v_date, v_date_to, v_from, v_to, v_location, v_sec, v_max::integer, v_desc);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN CASE p_r.action WHEN 'adopt' THEN 'adopted' WHEN 'revive' THEN 'revived'
                         ELSE CASE WHEN v_n > 0 THEN 'updated' ELSE 'unchanged' END END;
END;
$$;

CREATE OR REPLACE FUNCTION public.integration_write_events(
  p_run bigint, p_c public.integration_connections, p_now timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_scope jsonb;
  v_from text;
  v_today text := to_char((now() AT TIME ZONE 'Europe/Zurich')::date, 'YYYY-MM-DD');
  r public.integration_records%ROWTYPE;
  v_result text;
  v_state text;
  v_gone integer := 0;
  v_deleted integer := 0;
  v_b_deleted integer := 0;
  v_adopted_regs integer := 0;
  v_added integer;
  v_removed integer;
BEGIN
  SELECT scope INTO v_scope FROM public.integration_runs WHERE id = p_run;
  v_from := v_scope->>'from';

  FOR r IN SELECT * FROM public.integration_records
            WHERE run_id = p_run AND action IN ('insert', 'adopt', 'revive', 'update')
            ORDER BY external_id
  LOOP
    BEGIN
      v_result := public.integration_write_event(p_c, r, p_now);
      UPDATE public.integration_records SET result = v_result
       WHERE run_id = p_run AND external_id = r.external_id;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
      -- A failed insert created no row: the planned id (the provider's)
      -- must not end up in the issue as a member or event that exists
      UPDATE public.integration_records
         SET action = 'error', result = 'error', error = lower(v_state),
             target_id = CASE WHEN action = 'insert' THEN NULL ELSE target_id END
       WHERE run_id = p_run AND external_id = r.external_id;
    END;
  END LOOP;

  -- Seen without being written (problem, before the window, failed write)
  UPDATE public.event_links l SET last_seen_at = p_now
    FROM public.integration_records r2
   WHERE r2.run_id = p_run AND l.connection = p_c.id AND l.external_id = r2.external_id
     AND l.gone_at IS NULL AND (r2.problem IS NOT NULL OR r2.action IN ('out_of_scope', 'error'));
  UPDATE public.training_plan_breaks b SET last_seen_at = p_now
    FROM public.integration_records r2
   WHERE r2.run_id = p_run AND b.connection = p_c.id AND b.external_id = r2.external_id
     AND (r2.problem IS NOT NULL OR r2.action IN ('out_of_scope', 'error'));

  -- Gone (see integration_plan_events): marked; future events nobody used
  -- in the app are deleted, the others kept as the app's (issue). Gone
  -- holidays are deleted (nothing refers to them).
  IF coalesce((v_scope->>'complete')::boolean, false) THEN
    WITH cal AS (
      SELECT ic.id FROM public.integration_calendars ic
       WHERE ic.connection = p_c.id
         AND ic.external_id IN (SELECT jsonb_array_elements_text(v_scope->'calendars'))
    )
    UPDATE public.event_links l SET gone_at = p_now
      FROM public.events e
     WHERE e.id = l.event_id AND l.connection = p_c.id AND l.gone_at IS NULL
       AND l.calendar_id IN (SELECT id FROM cal)
       AND coalesce(e.date_to, e.date) >= v_from
       AND NOT EXISTS (
         SELECT 1 FROM public.integration_records r2
          WHERE r2.run_id = p_run AND r2.external_id = l.external_id
            AND (r2.problem IS NOT NULL OR r2.action = 'out_of_scope' OR r2.route = 'event')
            AND coalesce(r2.action, '') NOT IN ('cancelled', 'ignored'));
    GET DIAGNOSTICS v_gone = ROW_COUNT;

    DELETE FROM public.events e
     USING public.event_links l
     WHERE l.event_id = e.id AND l.connection = p_c.id AND l.gone_at = p_now
       AND e.date >= v_today
       AND NOT EXISTS (SELECT 1 FROM public.event_logs x WHERE x."eventId" = e.id)
       AND NOT EXISTS (SELECT 1 FROM public.event_participants x
                        WHERE x."eventId" = e.id AND x.source_connection IS DISTINCT FROM p_c.id)
       AND NOT EXISTS (SELECT 1 FROM public.exams x WHERE x.event_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM public.member_medals x WHERE x."eventId" = e.id);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    WITH cal AS (
      SELECT ic.id FROM public.integration_calendars ic
       WHERE ic.connection = p_c.id
         AND ic.external_id IN (SELECT jsonb_array_elements_text(v_scope->'calendars'))
    )
    DELETE FROM public.training_plan_breaks b
     WHERE b.connection = p_c.id AND b.calendar_id IN (SELECT id FROM cal) AND b.date_to >= v_from
       AND NOT EXISTS (
         SELECT 1 FROM public.integration_records r2
          WHERE r2.run_id = p_run AND r2.external_id = b.external_id
            AND (r2.problem IS NOT NULL OR r2.action = 'out_of_scope' OR r2.route = 'break')
            AND coalesce(r2.action, '') NOT IN ('cancelled', 'ignored'));
    GET DIAGNOSTICS v_b_deleted = ROW_COUNT;
  END IF;

  -- Registrations of events not over yet whose participant list was read:
  -- confirmed members (through their live links of this connection) are
  -- added; the provider's own rows no longer confirmed are removed unless
  -- the app changed them since (attendance, another status, event_logs).
  -- App rows are never touched.
  IF p_c.legacy_note_prefix IS NOT NULL THEN
    UPDATE public.event_participants p SET source_connection = p_c.id
      FROM public.integration_records r2
     WHERE r2.run_id = p_run AND r2.route = 'event' AND r2.result IS NOT NULL AND r2.result <> 'error'
       AND p."eventId" = r2.target_id AND p.source_connection IS NULL
       AND p.notes LIKE p_c.legacy_note_prefix || '%';
    GET DIAGNOSTICS v_adopted_regs = ROW_COUNT;
  END IF;

  WITH open AS (
    SELECT r2.target_id::integer AS event_id, r2.data->'participants' AS participants
      FROM public.integration_records r2
     WHERE r2.run_id = p_run AND r2.route = 'event' AND r2.result IS NOT NULL AND r2.result <> 'error'
       AND jsonb_typeof(r2.data->'participants') = 'array'
       AND coalesce(r2.data->>'ends_on', r2.data->>'starts_on') >= v_today
  ), confirmed AS (
    SELECT DISTINCT o.event_id, l.member_id
      FROM open o, jsonb_array_elements(o.participants) x
      JOIN public.member_links l
        ON l.connection = p_c.id AND l.external_id = x->>'member' AND l.gone_at IS NULL
     WHERE x->>'state' = ANY (p_c.confirmed_states)
  ), del AS (
    DELETE FROM public.event_participants p
     USING open o
     WHERE p."eventId" = o.event_id AND p.source_connection = p_c.id
       AND p."attendanceStatus" = 'registered'
       AND NOT EXISTS (SELECT 1 FROM confirmed c
                        WHERE c.event_id = p."eventId" AND c.member_id = p."memberId")
       AND NOT EXISTS (SELECT 1 FROM public.event_logs x
                        WHERE x."eventId" = p."eventId" AND x."memberId" = p."memberId")
    RETURNING 1
  ), ins AS (
    INSERT INTO public.event_participants ("eventId", "memberId", "attendanceStatus", notes,
                                           source_connection)
    SELECT c.event_id, c.member_id, 'registered', p_c.settings->>'participant_note', p_c.id
      FROM confirmed c
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM del), (SELECT count(*) FROM ins) INTO v_removed, v_added;

  RETURN (
    SELECT jsonb_build_object(
      'received', count(*),
      'inserted', count(*) FILTER (WHERE route = 'event' AND result = 'inserted'),
      'adopted', count(*) FILTER (WHERE route = 'event' AND result = 'adopted'),
      'revived', count(*) FILTER (WHERE route = 'event' AND result = 'revived'),
      'updated', count(*) FILTER (WHERE route = 'event' AND result = 'updated'),
      'unchanged', count(*) FILTER (WHERE route = 'event' AND result = 'unchanged'),
      'gone', v_gone,
      'deleted', v_deleted,
      'kept', v_gone - v_deleted,
      'breaks_inserted', count(*) FILTER (WHERE route = 'break' AND result = 'inserted'),
      'breaks_adopted', count(*) FILTER (WHERE route = 'break' AND result = 'adopted'),
      'breaks_updated', count(*) FILTER (WHERE route = 'break' AND result = 'updated'),
      'breaks_deleted', v_b_deleted,
      'registrations_added', v_added,
      'registrations_removed', v_removed,
      'registrations_adopted', v_adopted_regs,
      'invalid', count(*) FILTER (WHERE action = 'invalid'),
      'conflicts', count(*) FILTER (WHERE action = 'conflict'),
      'write_failed', count(*) FILTER (WHERE action = 'error'),
      'ignored', count(*) FILTER (WHERE action IN ('ignored', 'cancelled')),
      'out_of_scope', count(*) FILTER (WHERE action = 'out_of_scope'))
    FROM public.integration_records WHERE run_id = p_run);
END;
$$;

-- As for members: an issue about a record is checked by a complete run, or
-- by a partial run that staged that record (an unknown participant: its
-- event, with the participant list); kept gone events are scanned every run
CREATE OR REPLACE FUNCTION public.integration_note_event_issues(p_run bigint, p_c public.integration_connections)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_complete boolean;
  v_today text := to_char((now() AT TIME ZONE 'Europe/Zurich')::date, 'YYYY-MM-DD');
  v_noted integer;
  v_resolved integer;
BEGIN
  SELECT coalesce((scope->>'complete')::boolean, false) INTO v_complete
    FROM public.integration_runs WHERE id = p_run;

  WITH seen (code, severity, external_id, event_id, detail) AS (
    -- Records the run could not write; a date the provider left unset is expected (info)
    SELECT 'invalid_event', 'info', r.external_id, r.target_id::integer, r.problem
      FROM public.integration_records r
     WHERE r.run_id = p_run AND r.action = 'invalid' AND coalesce(r.problem, '') <> 'fetch_failed'
    UNION ALL
    SELECT 'id_conflict', 'error', r.external_id, r.target_id::integer, r.match
      FROM public.integration_records r
     WHERE r.run_id = p_run AND r.action = 'conflict'
    UNION ALL
    -- (no event for a failed insert: the issue names the record only)
    SELECT 'write_failed', 'error', r.external_id, r.target_id::integer, r.error
      FROM public.integration_records r
     WHERE r.run_id = p_run AND r.action = 'error'
    UNION ALL
    SELECT 'invalid_value', 'info', r.external_id, r.target_id::integer, f
      FROM public.integration_records r, jsonb_array_elements_text(r.data->'invalid') f
     WHERE r.run_id = p_run AND r.result IN ('inserted', 'adopted', 'revived', 'updated', 'unchanged')
    UNION ALL
    -- Gone from the provider but kept, because the app used it
    SELECT 'event_gone_kept', 'warning', l.external_id, l.event_id, NULL::text
      FROM public.event_links l JOIN public.events e ON e.id = l.event_id
     WHERE l.connection = p_c.id AND l.gone_at IS NOT NULL AND e.date >= v_today
       AND NOT EXISTS (SELECT 1 FROM public.event_links o WHERE o.event_id = l.event_id AND o.gone_at IS NULL)
    UNION ALL
    -- Confirmed in the provider, but no live member of this connection
    SELECT DISTINCT 'unknown_participant', 'warning', x->>'member', r.target_id::integer, NULL::text
      FROM public.integration_records r, jsonb_array_elements(r.data->'participants') x
     WHERE r.run_id = p_run AND r.route = 'event' AND r.result IS NOT NULL AND r.result <> 'error'
       AND jsonb_typeof(r.data->'participants') = 'array'
       AND x->>'state' = ANY (p_c.confirmed_states)
       AND NOT EXISTS (SELECT 1 FROM public.member_links l
                        WHERE l.connection = p_c.id AND l.external_id = x->>'member' AND l.gone_at IS NULL)
  )
  INSERT INTO public.integration_issues AS i (connection, kind, code, severity, external_id, event_id,
                                              detail, first_run, last_run)
  SELECT DISTINCT ON (s.code, coalesce(s.external_id, ''), coalesce(s.event_id, 0))
         p_c.id, 'events', s.code, s.severity, coalesce(s.external_id, ''), s.event_id,
         CASE WHEN s.detail ~ '^[a-z0-9_]{1,40}$' THEN s.detail END, p_run, p_run
    FROM seen s
   ORDER BY s.code, coalesce(s.external_id, ''), coalesce(s.event_id, 0)
  ON CONFLICT (connection, kind, code, external_id, (coalesce(member_id, 0)),
               (coalesce(other_member_id, 0)), (coalesce(event_id, 0)))
  DO UPDATE SET last_run = p_run, last_seen_at = now(), detail = EXCLUDED.detail,
                severity = EXCLUDED.severity, resolved_at = NULL,
                first_run = CASE WHEN i.resolved_at IS NOT NULL THEN p_run ELSE i.first_run END,
                first_seen_at = CASE WHEN i.resolved_at IS NOT NULL THEN now() ELSE i.first_seen_at END;
  GET DIAGNOSTICS v_noted = ROW_COUNT;

  UPDATE public.integration_issues i SET resolved_at = now()
   WHERE i.connection = p_c.id AND i.kind = 'events' AND i.resolved_at IS NULL
     AND i.last_run IS DISTINCT FROM p_run
     AND (i.code = 'event_gone_kept'
          OR (i.code IN ('invalid_event', 'invalid_value', 'unknown_participant', 'id_conflict', 'write_failed')
              AND (v_complete
                   OR EXISTS (SELECT 1 FROM public.integration_records r
                               WHERE r.run_id = p_run
                                 AND CASE WHEN i.code = 'unknown_participant'
                                          THEN r.target_id = i.event_id
                                               AND jsonb_typeof(r.data->'participants') = 'array'
                                          ELSE r.external_id = i.external_id END))));
  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  RETURN jsonb_build_object(
    'noted', v_noted,
    'resolved', v_resolved,
    'open', (SELECT count(*) FROM public.integration_issues
              WHERE connection = p_c.id AND resolved_at IS NULL AND dismissed_at IS NULL));
END;
$$;

-----------------
-- apply / finish
-----------------

-- A count from the options: a non-negative integer, else NULL
CREATE OR REPLACE FUNCTION public.integration_count_option(p jsonb, p_key text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN public.integration_text(p->p_key) ~ '^\d{1,6}$'
              THEN (public.integration_text(p->p_key))::integer END;
$$;

-- Applies the run's staged records in one transaction. p_options (all
-- optional): accept_gone, accept_status_drop, accept_status_gain,
-- accept_events_gone: the exact numbers a refusal reported, after checking
-- the provider. A refused or dry apply writes nothing but its run row (and
-- new catalog rows). Returns {run, status: applied|refused|failed, dry_run,
-- result, guard, accepted, error, hint}.
CREATE OR REPLACE FUNCTION public.integration_apply(p_run bigint, p_options jsonb DEFAULT '{}')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run public.integration_runs%ROWTYPE;
  v_c public.integration_connections%ROWTYPE;
  v_options jsonb := CASE WHEN jsonb_typeof(p_options) = 'object' THEN p_options ELSE '{}'::jsonb END;
  v_now timestamptz := now();
  v_plan jsonb;
  v_before jsonb;
  v_sg jsonb;
  v_n integer;
  v_new integer;
  v_guard jsonb := '{}';
  v_result jsonb := '{}';
  v_accepted jsonb := '{}';
  v_refused text;
  v_hint text;
  v_status text;
  v_error text;
  v_constraint text;
BEGIN
  SELECT * INTO v_run FROM public.integration_runs WHERE id = p_run FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  PERFORM public.integration_authorize(v_run.connection, true, v_run.started_by);
  IF v_run.status <> 'running' OR v_run.applied_at IS NOT NULL THEN
    RAISE EXCEPTION 'RUN_NOT_OPEN' USING ERRCODE = 'PT409';
  END IF;
  -- One apply or mapping change per connection at a time
  PERFORM pg_advisory_xact_lock(hashtext('integration_apply:' || v_run.connection));
  SELECT * INTO v_c FROM public.integration_connections WHERE id = v_run.connection;

  IF v_run.kind = 'members' THEN
    v_new := public.integration_register_groups(p_run, v_c);
  ELSE
    v_new := public.integration_register_calendars(p_run, v_c);
  END IF;
  v_guard := jsonb_build_object('new_catalog_rows', v_new);

  BEGIN
    IF v_run.kind = 'members' THEN
      v_before := public.integration_status_snapshot(v_c, p_run);
      v_plan := public.integration_plan_members(p_run, v_c);
      v_guard := v_guard || jsonb_build_object('members', v_plan);
      v_n := (v_plan->>'to_gone')::integer + (v_plan->>'former')::integer;
      IF (v_plan->>'complete')::boolean AND (v_plan->>'staged')::integer = 0 THEN
        v_refused := 'empty_snapshot';
      ELSIF v_n > (v_plan->>'limit')::integer THEN
        IF public.integration_count_option(v_options, 'accept_gone') IS DISTINCT FROM v_n THEN
          v_refused := 'members_gone';
          v_hint := 'accept_gone=' || v_n;
        ELSE
          v_accepted := v_accepted || jsonb_build_object('gone', v_n);
        END IF;
      END IF;

      IF v_refused IS NULL THEN
        v_result := public.integration_write_members(p_run, v_c, v_now);
        v_sg := public.integration_status_guard(v_c, v_before, v_now);
        v_guard := v_guard || jsonb_build_object('status', v_sg);
        IF (v_sg->>'over_drop')::boolean THEN
          IF public.integration_count_option(v_options, 'accept_status_drop')
             IS DISTINCT FROM (v_sg->>'dropping')::integer THEN
            v_refused := 'status_drop';
            v_hint := 'accept_status_drop=' || (v_sg->>'dropping');
          ELSE
            v_accepted := v_accepted || jsonb_build_object('status_drop', (v_sg->>'dropping')::integer);
          END IF;
        END IF;
        IF v_refused IS NULL AND (v_sg->>'over_gain')::boolean THEN
          IF public.integration_count_option(v_options, 'accept_status_gain')
             IS DISTINCT FROM (v_sg->>'gaining')::integer THEN
            v_refused := 'status_gain';
            v_hint := 'accept_status_gain=' || (v_sg->>'gaining');
          ELSE
            v_accepted := v_accepted || jsonb_build_object('status_gain', (v_sg->>'gaining')::integer);
          END IF;
        END IF;
        IF v_refused IS NULL THEN
          v_result := v_result || jsonb_build_object('issues', public.integration_note_member_issues(p_run, v_c));
        END IF;
      END IF;
    ELSE
      v_plan := public.integration_plan_events(p_run, v_c);
      v_guard := v_guard || jsonb_build_object('events', v_plan);
      v_n := (v_plan->>'to_gone')::integer;
      IF v_n > (v_plan->>'limit')::integer THEN
        IF public.integration_count_option(v_options, 'accept_events_gone') IS DISTINCT FROM v_n THEN
          v_refused := 'events_gone';
          v_hint := 'accept_events_gone=' || v_n;
        ELSE
          v_accepted := v_accepted || jsonb_build_object('events_gone', v_n);
        END IF;
      END IF;
      IF v_refused IS NULL THEN
        v_result := public.integration_write_events(p_run, v_c, v_now);
        v_result := v_result || jsonb_build_object('issues', public.integration_note_event_issues(p_run, v_c));
      END IF;
    END IF;

    v_status := CASE WHEN v_refused IS NOT NULL THEN 'refused' ELSE 'applied' END;
    -- A refused or dry run leaves no trace but its run row
    IF v_refused IS NOT NULL OR v_run.dry_run THEN
      RAISE EXCEPTION USING ERRCODE = 'PTDRY', MESSAGE = 'rolled back';
    END IF;
  EXCEPTION
    WHEN SQLSTATE 'PTDRY' THEN
      NULL;
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      v_error := lower(SQLSTATE) || CASE WHEN v_constraint ~ '^[a-z0-9_]{1,60}$' THEN ' ' || v_constraint ELSE '' END;
      v_status := 'failed';
  END;

  IF v_refused IS NOT NULL THEN
    v_guard := v_guard || jsonb_build_object('refused', v_refused);
  END IF;
  UPDATE public.integration_runs
     SET status = CASE WHEN v_status = 'failed' THEN 'running' ELSE v_status END,
         applied_at = CASE WHEN v_status = 'failed' THEN NULL ELSE now() END,
         result = v_result, guard = v_guard, accepted = v_accepted, error = v_error
   WHERE id = p_run;

  RETURN jsonb_build_object('run', p_run, 'status', v_status, 'dry_run', v_run.dry_run,
                            'result', v_result, 'guard', v_guard, 'accepted', v_accepted,
                            'error', v_error, 'hint', v_hint);
END;
$$;

-- Closes the run with what the adapter reports: {"errors": n (records it
-- could not fetch), "counters": {name: n}, "error": code}. Final status:
-- ok; warning (applied, but the adapter had errors, or records the run
-- could not write: invalid members, conflicts, held back, failed writes;
-- info issues such as an unset event date do not count); refused; failed
-- (never applied). Staged records are deleted.
CREATE OR REPLACE FUNCTION public.integration_finish(p_run bigint, p_report jsonb DEFAULT '{}')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run public.integration_runs%ROWTYPE;
  v_report jsonb := CASE WHEN jsonb_typeof(p_report) = 'object' THEN p_report ELSE '{}'::jsonb END;
  v_errors integer;
  v_problems integer;
  v_status text;
  v_adapter jsonb;
  v_error text;
BEGIN
  SELECT * INTO v_run FROM public.integration_runs WHERE id = p_run FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  PERFORM public.integration_authorize(v_run.connection, true, v_run.started_by);
  IF v_run.status NOT IN ('running', 'applied', 'refused') OR v_run.finished_at IS NOT NULL THEN
    RAISE EXCEPTION 'RUN_NOT_OPEN' USING ERRCODE = 'PT409';
  END IF;

  v_errors := coalesce(public.integration_count_option(v_report, 'errors'), 0);
  v_adapter := jsonb_build_object(
    'errors', v_errors,
    'counters', (SELECT coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
                   FROM jsonb_each(CASE WHEN jsonb_typeof(v_report->'counters') = 'object'
                                        THEN v_report->'counters' ELSE '{}'::jsonb END) e(k, v)
                  WHERE k ~ '^[a-z][a-z0-9_]{0,39}$' AND jsonb_typeof(v) = 'number'));
  v_error := CASE WHEN v_report->>'error' ~ '^[a-z0-9_]{1,40}$' THEN v_report->>'error'
                  WHEN v_report ? 'error' AND v_report->'error' <> 'null'::jsonb THEN 'adapter_error' END;
  v_problems := coalesce((v_run.result->>'invalid')::integer, 0) * (CASE WHEN v_run.kind = 'members' THEN 1 ELSE 0 END)
              + coalesce((v_run.result->>'conflicts')::integer, 0)
              + coalesce((v_run.result->>'held')::integer, 0)
              + coalesce((v_run.result->>'write_failed')::integer, 0);
  v_status := CASE v_run.status
                WHEN 'applied' THEN CASE WHEN v_errors > 0 OR v_problems > 0 OR v_error IS NOT NULL
                                         THEN 'warning' ELSE 'ok' END
                WHEN 'refused' THEN 'refused'
                ELSE 'failed' END;

  UPDATE public.integration_runs
     SET status = v_status, finished_at = now(), adapter = v_adapter,
         error = coalesce(error, v_error)
   WHERE id = p_run;
  DELETE FROM public.integration_records WHERE run_id = p_run;

  RETURN jsonb_build_object('run', p_run, 'status', v_status, 'dry_run', v_run.dry_run,
                            'result', v_run.result, 'guard', v_run.guard, 'accepted', v_run.accepted,
                            'error', coalesce(v_run.error, v_error));
END;
$$;

-----------------
-- Admin: mapping, issues, status
-----------------

-- Changes what groups and calendars map to. p_changes: {"groups": [{id,
-- status?, rank?, hidden?, role?}], "calendars": [{id, target?, section?,
-- closed_max_days?}]} (catalog row ids; a key left out stays; a row
-- listed is marked reviewed). Statuses are derived again at once under
-- the same guards as a run; calendars take effect at the next events run
-- (a calendar set to 'ignore' or 'break' lets its events go, under the
-- events gone guard). p_options: {dry_run, accept_status_drop,
-- accept_status_gain}. Logged as a 'config' run. Identity, owned fields
-- and guard limits are not changed here (migration only).
CREATE OR REPLACE FUNCTION public.integration_set_mapping(
  p_connection text,
  p_changes jsonb,
  p_options jsonb DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_c public.integration_connections%ROWTYPE;
  v_options jsonb := CASE WHEN jsonb_typeof(p_options) = 'object' THEN p_options ELSE '{}'::jsonb END;
  v_dry boolean := coalesce(v_options->>'dry_run' = 'true', false);
  v_now timestamptz := now();
  v_item jsonb;
  v_before jsonb;
  v_sg jsonb;
  v_groups integer := 0;
  v_calendars integer := 0;
  v_changed integer := 0;
  v_refused text;
  v_hint text;
  v_accepted jsonb := '{}';
  v_run bigint;
BEGIN
  IF NOT (public.integration_is_service() OR public.is_admin()) THEN
    RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_c FROM public.integration_connections WHERE id = p_connection;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNKNOWN_CONNECTION' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p_changes) IS DISTINCT FROM 'object'
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_changes) k WHERE k NOT IN ('groups', 'calendars'))
     OR jsonb_typeof(coalesce(p_changes->'groups', '[]')) <> 'array'
     OR jsonb_typeof(coalesce(p_changes->'calendars', '[]')) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_MAPPING: changes' USING ERRCODE = '22023';
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_changes->'groups', '[]')) LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_item) k WHERE k NOT IN ('id', 'status', 'rank', 'hidden', 'role'))
       OR NOT EXISTS (SELECT 1 FROM public.integration_member_groups g
                       WHERE g.connection = p_connection AND g.id::text = public.integration_text(v_item->'id'))
       OR (v_item ? 'status' AND v_item->'status' <> 'null'::jsonb
           AND coalesce(v_item->>'status', '') NOT IN ('trial', 'active', 'passive', 'non_member', 'left'))
       OR (v_item ? 'rank' AND coalesce(public.integration_text(v_item->'rank'), '') !~ '^\d{1,3}$')
       OR (v_item ? 'hidden' AND jsonb_typeof(v_item->'hidden') <> 'boolean')
       OR (v_item ? 'role' AND v_item->'role' <> 'null'::jsonb AND coalesce(v_item->>'role', '') NOT IN ('trainer')) THEN
      RAISE EXCEPTION 'INVALID_MAPPING: group' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_changes->'calendars', '[]')) LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_item) k WHERE k NOT IN ('id', 'target', 'section', 'closed_max_days'))
       OR NOT EXISTS (SELECT 1 FROM public.integration_calendars ic
                       WHERE ic.connection = p_connection AND ic.id::text = public.integration_text(v_item->'id'))
       OR (v_item ? 'target' AND coalesce(v_item->>'target', '') NOT IN ('event', 'break', 'ignore'))
       OR (v_item ? 'section' AND v_item->'section' <> 'null'::jsonb
           AND (jsonb_typeof(v_item->'section') <> 'string' OR btrim(v_item->>'section') = ''
                OR length(v_item->>'section') > 40))
       OR (v_item ? 'closed_max_days' AND v_item->'closed_max_days' <> 'null'::jsonb
           AND coalesce(public.integration_text(v_item->'closed_max_days'), '') !~ '^\d{1,3}$') THEN
      RAISE EXCEPTION 'INVALID_MAPPING: calendar' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  PERFORM pg_advisory_xact_lock(hashtext('integration_apply:' || p_connection));
  v_before := public.integration_status_snapshot(v_c, NULL);

  BEGIN
    UPDATE public.integration_member_groups g
       SET status = CASE WHEN ch ? 'status' THEN ch->>'status' ELSE g.status END,
           rank = CASE WHEN ch ? 'rank' THEN (ch->>'rank')::integer ELSE g.rank END,
           hidden = CASE WHEN ch ? 'hidden' THEN (ch->>'hidden')::boolean ELSE g.hidden END,
           role = CASE WHEN ch ? 'role' THEN ch->>'role' ELSE g.role END,
           reviewed = true, updated_at = v_now
      FROM jsonb_array_elements(coalesce(p_changes->'groups', '[]')) ch
     WHERE g.connection = p_connection AND g.id::text = public.integration_text(ch->'id');
    GET DIAGNOSTICS v_groups = ROW_COUNT;

    UPDATE public.integration_calendars ic
       SET target = CASE WHEN ch ? 'target' THEN ch->>'target' ELSE ic.target END,
           section = CASE WHEN ch ? 'section' THEN btrim(ch->>'section') ELSE ic.section END,
           closed_max_days = CASE WHEN ch ? 'closed_max_days' THEN (ch->>'closed_max_days')::integer
                                  ELSE ic.closed_max_days END,
           reviewed = true, updated_at = v_now
      FROM jsonb_array_elements(coalesce(p_changes->'calendars', '[]')) ch
     WHERE ic.connection = p_connection AND ic.id::text = public.integration_text(ch->'id');
    GET DIAGNOSTICS v_calendars = ROW_COUNT;

    -- The BEFORE trigger derives each status again
    UPDATE public.members m SET membership_status = public.member_status_for(m.id, m.labels)
     WHERE m.id IN (SELECT e.key::integer FROM jsonb_each(v_before) e)
       AND m.membership_status IS DISTINCT FROM public.member_status_for(m.id, m.labels);
    GET DIAGNOSTICS v_changed = ROW_COUNT;

    v_sg := public.integration_status_guard(v_c, v_before, v_now);
    IF (v_sg->>'over_drop')::boolean THEN
      IF public.integration_count_option(v_options, 'accept_status_drop') IS DISTINCT FROM (v_sg->>'dropping')::integer THEN
        v_refused := 'status_drop';
        v_hint := 'accept_status_drop=' || (v_sg->>'dropping');
      ELSE
        v_accepted := v_accepted || jsonb_build_object('status_drop', (v_sg->>'dropping')::integer);
      END IF;
    END IF;
    IF v_refused IS NULL AND (v_sg->>'over_gain')::boolean THEN
      IF public.integration_count_option(v_options, 'accept_status_gain') IS DISTINCT FROM (v_sg->>'gaining')::integer THEN
        v_refused := 'status_gain';
        v_hint := 'accept_status_gain=' || (v_sg->>'gaining');
      ELSE
        v_accepted := v_accepted || jsonb_build_object('status_gain', (v_sg->>'gaining')::integer);
      END IF;
    END IF;
    IF v_refused IS NOT NULL OR v_dry THEN
      RAISE EXCEPTION USING ERRCODE = 'PTDRY', MESSAGE = 'rolled back';
    END IF;
  EXCEPTION WHEN SQLSTATE 'PTDRY' THEN
    NULL;
  END;

  INSERT INTO public.integration_runs (connection, kind, scope, trigger, dry_run, status, applied_at,
                                       finished_at, result, guard, accepted)
  VALUES (p_connection, 'config', '{}',
          CASE WHEN public.integration_is_service() THEN 'manual' ELSE 'app' END, v_dry,
          CASE WHEN v_refused IS NOT NULL THEN 'refused' ELSE 'ok' END, v_now, v_now,
          jsonb_build_object('groups', v_groups, 'calendars', v_calendars, 'statuses_changed', v_changed),
          jsonb_build_object('status', v_sg) || CASE WHEN v_refused IS NOT NULL
                                                     THEN jsonb_build_object('refused', v_refused) ELSE '{}'::jsonb END,
          v_accepted)
  RETURNING id INTO v_run;

  RETURN jsonb_build_object('run', v_run,
                            'status', CASE WHEN v_refused IS NOT NULL THEN 'refused'
                                           WHEN v_dry THEN 'dry_run' ELSE 'ok' END,
                            'groups', v_groups, 'calendars', v_calendars, 'statuses_changed', v_changed,
                            'guard', v_sg, 'accepted', v_accepted, 'hint', v_hint);
END;
$$;

-- An admin decides an issue is fine (e.g. not a duplicate): it stays closed
-- while runs keep observing it; p_dismiss false reopens it
CREATE OR REPLACE FUNCTION public.integration_dismiss_issue(p_issue bigint, p_dismiss boolean DEFAULT true)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  UPDATE public.integration_issues
     SET dismissed_at = CASE WHEN p_dismiss THEN coalesce(dismissed_at, now()) END,
         dismissed_by = CASE WHEN p_dismiss THEN coalesce(dismissed_by, auth.uid()) END
   WHERE id = p_issue;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$$;

-- Per connection, for the Integrations page and the navigation's warning
-- dot (admins): links, holidays, catalog rows to review, the latest run
-- and the latest success per kind, open issues by severity
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
                        WHERE ic.connection = c.id AND NOT ic.reviewed)),
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

-----------------
-- Function privileges (new functions are executable by PUBLIC, and on
-- Supabase by anon and authenticated, through the default privileges).
-- API: the four run functions for the sync and app-run admins; mapping,
-- issues and status for admins. Everything else is internal. The two
-- validators used in CHECK constraints stay callable (pure).
-----------------
REVOKE EXECUTE ON FUNCTION
  public.integration_member_status(jsonb, text, text),
  public.member_status_for(integer, jsonb),
  public.trigger_guard_provider_event(),
  public.trigger_guard_provider_break(),
  public.trigger_guard_participant_source(),
  public.trigger_participant_source_follows_notes(),
  public.integration_iso_date(text, date, date),
  public.integration_hhmm(text),
  public.integration_text(jsonb),
  public.integration_normalize_member(jsonb),
  public.integration_normalize_event(jsonb),
  public.integration_pick(text, boolean, text, text, boolean),
  public.integration_is_service(),
  public.integration_authorize(text, boolean, uuid),
  public.integration_group_label(text, text, text, bigint),
  public.integration_register_groups(bigint, public.integration_connections),
  public.integration_register_calendars(bigint, public.integration_connections),
  public.integration_status_snapshot(public.integration_connections, bigint),
  public.integration_status_guard(public.integration_connections, jsonb, timestamptz),
  public.integration_plan_members(bigint, public.integration_connections),
  public.integration_write_member(public.integration_connections, public.integration_records, timestamptz),
  public.integration_write_members(bigint, public.integration_connections, timestamptz),
  public.integration_note_member_issues(bigint, public.integration_connections),
  public.integration_plan_events(bigint, public.integration_connections),
  public.integration_write_event(public.integration_connections, public.integration_records, timestamptz),
  public.integration_write_events(bigint, public.integration_connections, timestamptz),
  public.integration_note_event_issues(bigint, public.integration_connections),
  public.integration_count_option(jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION
  public.integration_field_policy_ok(jsonb),
  public.integration_settings_ok(jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.integration_field_policy_ok(jsonb),
  public.integration_settings_ok(jsonb)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION
  public.integration_begin(text, text, jsonb),
  public.integration_stage(bigint, jsonb),
  public.integration_apply(bigint, jsonb),
  public.integration_finish(bigint, jsonb),
  public.integration_set_mapping(text, jsonb, jsonb),
  public.integration_dismiss_issue(bigint, boolean),
  public.integration_status()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.integration_begin(text, text, jsonb),
  public.integration_stage(bigint, jsonb),
  public.integration_apply(bigint, jsonb),
  public.integration_finish(bigint, jsonb),
  public.integration_set_mapping(text, jsonb, jsonb),
  public.integration_status()
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.integration_dismiss_issue(bigint, boolean) TO authenticated;

-----------------
-- No status changes: the seeded catalog is the old rule. A promotion that
-- would flip any member's status fails here instead.
-----------------
DO $$
DECLARE
  v_diff bigint;
BEGIN
  SELECT count(*) INTO v_diff FROM public.members m
   WHERE m.membership_status IS DISTINCT FROM public.member_status_for(m.id, m.labels);
  IF v_diff > 0 THEN
    RAISE EXCEPTION 'integration layer: % members would change their membership status', v_diff;
  END IF;
END;
$$;
