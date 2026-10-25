-- Membership status and provider links (integrations phase 1a).
--
-- Until now the app read meaning from Webling group titles in members.labels
-- and could not tell a member synced from Webling from one created in the
-- app. This adds both, without changing who may sign in yet:
--
-- * member_links: which provider record a member comes from. The Webling
--   sync writes one row per member (connection 'webling', external id = the
--   Webling member id); existing Webling members are backfilled here.
-- * members.membership_status: trial | active | passive | non_member | left,
--   derived from the labels (see member_status_from_labels) whenever they
--   change, and when a link is added or removed.
-- * Fields Webling owns (name, birthday, mobile, e-mail, labels, status)
--   cannot be changed through the API for linked members: they are edited in
--   Webling, otherwise the next sync would silently undo the change.
-- * member_access_report(): the approved member accounts that would lose
--   access once sign-in requires an active or passive membership. Nothing
--   is revoked yet; see docs/INTEGRATIONS.md.

-----------------
-- Provider links
-----------------

CREATE TABLE public.member_links (
  connection text NOT NULL CHECK (connection <> ''),
  external_id text NOT NULL CHECK (external_id <> ''),
  member_id integer NOT NULL REFERENCES public.members (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection, external_id),
  -- One record per member and provider; leading member_id serves lookups by member
  UNIQUE (member_id, connection)
);

COMMENT ON TABLE public.member_links IS
  'Provider record a member comes from (connection ''webling'': external_id = Webling member id). Written by the sync only.';

ALTER TABLE public.member_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_links FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.member_links FROM authenticated;
CREATE POLICY member_links_read ON public.member_links FOR SELECT TO authenticated
  USING ((SELECT public.is_staff()));

-- Webling ids were written into members.id by the sync. App ids are below
-- 1'000 (prod: 1-334) or from 10'000'001 on (20261025220000_fence_member_event_ids.sql),
-- Webling member ids lie in between (prod: 3'240-62'454). Previews and local
-- databases get theirs from seed.sql, which runs after the migrations.
INSERT INTO public.member_links (connection, external_id, member_id)
SELECT 'webling', id::text, id
FROM public.members
WHERE id >= 1000 AND id < 10000000
ON CONFLICT DO NOTHING;

-- For SECURITY DEFINER functions and triggers only (not callable through the
-- API: member_links is staff-only)
CREATE OR REPLACE FUNCTION public.is_provider_linked(p_member_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.member_links WHERE member_id = p_member_id);
$$;

-----------------
-- Membership status
-----------------

-- Status from the labels. Webling groups (exact titles) decide for members
-- that come from Webling; a linked member without one of these groups is
-- not a member. Members created in the app are active unless they are trial
-- candidates (the app's 'probetraining' label). 'Probetraining' with a
-- capital P is Webling's old trial group, which is no longer used: those
-- people never became members.
CREATE OR REPLACE FUNCTION public.member_status_from_labels(p_labels jsonb, p_linked boolean)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH l AS (
    SELECT CASE WHEN jsonb_typeof(p_labels) = 'array' THEN p_labels ELSE '[]'::jsonb END AS labels
  )
  SELECT CASE
    WHEN labels ? '03_Austritt' THEN 'left'
    WHEN labels ? 'Aktiv' THEN 'active'
    WHEN labels ? 'Passiv' OR labels ? 'Ehrenmitglieder' THEN 'passive'
    WHEN labels ? 'Nicht-Mitglieder' THEN 'non_member'
    WHEN labels ? 'probetraining' THEN 'trial'
    WHEN labels ? 'Probetraining' THEN 'non_member'
    WHEN p_linked THEN 'non_member'
    ELSE 'active'
  END
  FROM l;
$$;

ALTER TABLE public.members
  ADD COLUMN membership_status text NOT NULL DEFAULT 'active'
  CONSTRAINT members_membership_status_check
  CHECK (membership_status IN ('trial', 'active', 'passive', 'non_member', 'left'));

COMMENT ON COLUMN public.members.membership_status IS
  'trial | active | passive | non_member | left; derived from labels (member_status_from_labels), do not set directly';

-- SECURITY DEFINER: it only computes the status from NEW, and the callers
-- (staff, the sync, register_trial) need not be able to read member_links
CREATE OR REPLACE FUNCTION public.trigger_set_membership_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.membership_status := public.member_status_from_labels(
    NEW.labels, public.is_provider_linked(NEW.id)
  );
  RETURN NEW;
END;
$$;

-- Also on a direct write of membership_status, which is overridden: the
-- status always follows the labels
CREATE TRIGGER members_set_membership_status
  BEFORE INSERT OR UPDATE OF labels, membership_status ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_membership_status();

-- A link changes whether a member without a status group counts as a member
CREATE OR REPLACE FUNCTION public.trigger_link_changed_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id integer := CASE WHEN TG_OP = 'DELETE' THEN OLD.member_id ELSE NEW.member_id END;
BEGIN
  UPDATE public.members m
     SET membership_status = public.member_status_from_labels(
           m.labels, public.is_provider_linked(m.id)
         )
   WHERE m.id = v_member_id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER member_links_set_membership_status
  AFTER INSERT OR DELETE ON public.member_links
  FOR EACH ROW EXECUTE FUNCTION public.trigger_link_changed_status();

UPDATE public.members
   SET membership_status = public.member_status_from_labels(labels, public.is_provider_linked(id));

CREATE INDEX idx_members_membership_status ON public.members (membership_status);

-----------------
-- Fields owned by the provider
-----------------

-- Staff edit through the API as 'authenticated'. The sync (service_role),
-- migrations and SECURITY DEFINER functions are not restricted. Not SECURITY
-- DEFINER itself: it needs the caller's role. Only writers (staff) can update
-- members, and staff may read member_links.
CREATE OR REPLACE FUNCTION public.trigger_guard_provider_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.member_links WHERE member_id = OLD.id) THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.firstname IS DISTINCT FROM OLD.firstname
     OR NEW.lastname IS DISTINCT FROM OLD.lastname
     OR NEW.birthday IS DISTINCT FROM OLD.birthday
     OR NEW.mobile IS DISTINCT FROM OLD.mobile
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.labels IS DISTINCT FROM OLD.labels
     OR NEW.membership_status IS DISTINCT FROM OLD.membership_status THEN
    RAISE EXCEPTION 'MANAGED_BY_PROVIDER: member % is maintained in its provider (Webling)', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER members_guard_provider_fields
  BEFORE UPDATE ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.trigger_guard_provider_fields();

-----------------
-- Access report
-----------------

-- Approved 'member' accounts none of whose member records (explicitly linked
-- or matched by e-mail) is an active or passive, non-archived member. Once
-- sign-in requires that, these accounts lose access, also ones an admin
-- approved by hand. Staff accounts are not listed: their access comes from
-- their role.
CREATE OR REPLACE FUNCTION public.member_access_report()
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  member_ids integer[],
  statuses text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.user_id,
    p.email,
    p.full_name,
    coalesce(array_agg(DISTINCT m.id) FILTER (WHERE m.id IS NOT NULL), '{}'),
    coalesce(array_agg(DISTINCT m.membership_status) FILTER (WHERE m.id IS NOT NULL), '{}')
  FROM public.user_profiles p
  LEFT JOIN public.members m
    ON m.id = p.member_id
    OR (
      m.email IS NOT NULL
      AND public.normalize_email(m.email) = public.normalize_email(p.email)
    )
  WHERE public.is_admin()
    AND p.status = 'approved'
    AND p.role = 'member'
  GROUP BY p.user_id, p.email, p.full_name
  HAVING NOT coalesce(
    bool_or(m.membership_status IN ('active', 'passive') AND m."archivedAt" IS NULL),
    false
  )
  ORDER BY p.email;
$$;

-----------------
-- Check-in list: the membership status, shown as a chip on each card (the
-- status labels themselves are no longer shown). Same as
-- 20260104120000_add_trainer_roles.sql plus membership_status.
-----------------
DROP FUNCTION IF EXISTS public.get_checklist_members(text, integer);

CREATE FUNCTION public.get_checklist_members(d text, tid integer)
RETURNS TABLE (
  "trainingId"    smallint,
  "memberId"      integer,
  lastname        text,
  firstname       text,
  labels          jsonb,
  img             text,
  date            text,
  "trainerRole"   trainer_role,
  membership_status text
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p."trainingId",
    p."memberId",
    m.lastname,
    m.firstname,
    m.labels,
    m.img,
    l.date,
    COALESCE(l."trainerRole", 'attendee'::trainer_role) as "trainerRole",
    m.membership_status
  FROM public.participants AS p
  FULL OUTER JOIN public.logs AS l
    ON p."memberId" = l."memberId"
   AND l.date = d
   AND l."trainingId" = tid
  INNER JOIN public.members AS m
    ON m.id = p."memberId"
  WHERE p."trainingId" = tid;
END;
$$;

-----------------
-- Function privileges (Supabase grants EXECUTE to anon/authenticated on new
-- functions, see 20260913140000_relock_security_definer_functions.sql)
-----------------
REVOKE EXECUTE ON FUNCTION public.is_provider_linked(integer)             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.member_status_from_labels(jsonb, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trigger_set_membership_status()         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_link_changed_status()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_guard_provider_fields()         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.member_access_report()                  FROM PUBLIC, anon;
