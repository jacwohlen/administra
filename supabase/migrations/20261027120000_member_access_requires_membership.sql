-- Member accounts need an active or passive membership (integrations phase 1b).
--
-- Decision (docs/INTEGRATIONS.md): an account with the role 'member' may use
-- Administra only while at least one of its member records counts: active or
-- passive, not archived and not a trial candidate (member_grants_access()).
-- Its records are the member an admin linked (user_profiles.member_id) and
-- every member carrying the account's e-mail. Non-members, people who left
-- and trial candidates get nothing, also when an admin approved the account
-- by hand or linked it to a member. Staff (viewer, trainer, admin; exam roles
-- only exist on top of these) keep their access from the role.
--
-- The rule is checked whenever a query runs, never stored. The Webling sync
-- changes membership_status at any time, and several of those changes (a
-- link gone or revived, archiving, deleting a member, a new e-mail) reach no
-- trigger on user_profiles; a stored flag would also race with them.
-- user_profiles.status keeps meaning what an admin (or the automatic
-- approval) decided: nobody is set back to "Ausstehend", and access comes
-- back by itself once a record counts again.
--
-- * is_approved_user() (9 policies, 10 functions) and my_member_ids() (the
--   *_read_own policies and the member exam functions) apply the rule to
--   'member' accounts. Staff never read members there.
-- * get_member_directory() lists only members whose membership counts.
-- * grant_member_access() approves only for a record that counts and only
--   accounts waiting as 'member', and now also runs when a member's status
--   or archive date changes (a revived link used to wait for the next night).
-- * New accounts wait as 'member' instead of 'viewer': approving one by hand
--   no longer makes the person staff unless an admin picks a staff role.
-- * A member the Webling sync has just inserted counts as coming from
--   Webling before its link is written, so one without a status group is a
--   non-member from the start instead of active for the rest of the run.
-- * member_access_report(): member accounts (approved or waiting) none of
--   whose records counts, with the reason per record.
-- * my_access(): whether the signed-in account is let in (the same check as
--   RLS) and the reason per record, for routing and the pending page.

-----------------
-- The rule
-----------------

-- Whether one member record lets a 'member' account in. The only place the
-- rule lives. Trial candidates are excluded on top of the status: the public
-- trial form lets anyone create a member row with any e-mail, and a Webling
-- member in Aktiv may still carry the legacy Probetraining group.
-- No SET search_path (every name is qualified, like is_bootstrap_admin()):
-- only then can Postgres inline it, so the directory checks the status
-- before it calls has_trial_label() on each row.
CREATE OR REPLACE FUNCTION public.member_grants_access(
  p_status text,
  p_archived_at timestamptz,
  p_labels jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(p_status IN ('active', 'passive'), false)
     AND p_archived_at IS NULL
     AND NOT public.has_trial_label(p_labels);
$$;

COMMENT ON FUNCTION public.member_grants_access(text, timestamptz, jsonb) IS
  'A member record lets a member account in: active or passive, not archived, no trial label (phase 1b).';

-- Why a record does or does not let its account in, for the pending page and
-- the admin report: the status, except for an active or passive record that
-- does not count, which is 'trial' (trial label) or 'archived'. A raw
-- 'active' next to "no access" would leave both guessing.
CREATE OR REPLACE FUNCTION public.member_access_status(
  p_status text,
  p_archived_at timestamptz,
  p_labels jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.member_grants_access(p_status, p_archived_at, p_labels) THEN p_status
    WHEN p_status IN ('active', 'passive') AND public.has_trial_label(p_labels) THEN 'trial'
    WHEN p_status IN ('active', 'passive') THEN 'archived'
    ELSE p_status
  END;
$$;

-- Whether a 'member' account with this link and e-mail has a record that
-- counts. Two EXISTS so each one uses its index (members_pkey, and
-- idx_members_email_normalized, whose predicate needs the IS NOT NULL).
-- For the SECURITY DEFINER functions below only: through the API it would
-- tell anyone whether an address belongs to a member.
CREATE OR REPLACE FUNCTION public.member_account_has_access(p_member_id integer, p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
           SELECT 1 FROM public.members m
           WHERE m.id = p_member_id
             AND public.member_grants_access(m.membership_status, m."archivedAt", m.labels)
         )
      OR EXISTS (
           SELECT 1 FROM public.members m
           WHERE m.email IS NOT NULL
             AND public.normalize_email(m.email) = public.normalize_email(p_email)
             AND public.member_grants_access(m.membership_status, m."archivedAt", m.labels)
         );
$$;

-----------------
-- RLS helpers
-----------------

-- May use Administra now: approved staff by their role, an approved member
-- account only while one of its records counts. Every policy and function
-- that lets members read club data goes through this or my_member_ids(),
-- so the rule needs no change there. The role check comes first: staff
-- never pay for the member lookup.
CREATE OR REPLACE FUNCTION public.is_approved_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.user_id = auth.uid()
      AND p.status = 'approved'
      AND (
        p.role <> 'member'
        OR public.member_account_has_access(p.member_id, p.email)
      )
  );
$$;

COMMENT ON FUNCTION public.is_approved_user() IS
  'May use Administra now: approved staff, or an approved member account with a member record that counts (member_grants_access). Not the same as user_profiles.status = ''approved''.';

-- The signed-in account's member records (backs the *_read_own policies and
-- the member exam functions). A member account only gets the records that
-- count: a parent no longer sees or registers a child who left. Staff keep
-- all of theirs, for "Mein Profil" of a trainer who is no member in Webling.
-- Same two-branch UNION as 20261001180000_speed_up_rls_and_badge_triggers.sql;
-- the new checks only look at the member row already found.
CREATE OR REPLACE FUNCTION public.my_member_ids()
RETURNS SETOF integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id
  FROM public.user_profiles p
  JOIN public.members m ON m.id = p.member_id
  WHERE p.user_id = auth.uid()
    AND p.status = 'approved'
    AND (
      p.role <> 'member'
      OR public.member_grants_access(m.membership_status, m."archivedAt", m.labels)
    )
  UNION
  SELECT m.id
  FROM public.user_profiles p
  JOIN public.members m
    ON public.normalize_email(m.email) = public.normalize_email(p.email)
   AND m.email IS NOT NULL
  WHERE p.user_id = auth.uid()
    AND p.status = 'approved'
    AND NOT public.has_trial_label(m.labels)
    AND (
      p.role <> 'member'
      OR public.member_grants_access(m.membership_status, m."archivedAt", m.labels)
    );
$$;

-----------------
-- Member directory
-----------------

-- Same as 20260926090100_member_self_service.sql, except that the listing
-- (besides the caller's own records) holds only members whose membership
-- counts: non-members and people who left are no longer shown to members.
CREATE OR REPLACE FUNCTION public.get_member_directory()
RETURNS TABLE (
  id integer,
  firstname text,
  lastname text,
  img text,
  "imgUploaded" timestamptz,
  sections text[],
  "isMine" boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH mine AS (
    SELECT public.my_member_ids() AS id
  ),
  window_start AS (
    SELECT to_char(max(date)::date - 365, 'YYYY-MM-DD') AS d
    FROM public.logs
    WHERE date ~ '^\d{4}-\d{2}-\d{2}$'
  ),
  active AS (
    SELECT
      l."memberId" AS id,
      coalesce(
        array_agg(DISTINCT t.section ORDER BY t.section) FILTER (WHERE t.section IS NOT NULL),
        '{}'
      ) AS sections
    FROM public.logs l
    LEFT JOIN public.trainings t ON t.id = l."trainingId"
    WHERE l."memberId" IS NOT NULL
      AND l.date >= (SELECT d FROM window_start)
    GROUP BY l."memberId"
  )
  SELECT
    m.id,
    m.firstname,
    m.lastname,
    m.img,
    m."imgUploaded",
    coalesce(a.sections, '{}'),
    m.id IN (SELECT id FROM mine)
  FROM public.members m
  LEFT JOIN active a ON a.id = m.id
  WHERE public.is_approved_user()
    AND (
      m.id IN (SELECT id FROM mine)
      OR (
        a.id IS NOT NULL
        AND public.member_grants_access(m.membership_status, m."archivedAt", m.labels)
      )
    )
  ORDER BY m.firstname, m.lastname;
$$;

-----------------
-- Automatic approval
-----------------

-- Approve the accounts waiting as 'member' whose confirmed e-mail is p_email,
-- provided a member with that e-mail counts. Accounts an admin already gave a
-- staff role wait for the admin (the approval used to turn them into members
-- and drop their exam role); disabled accounts stay disabled. Never revokes:
-- an account whose records stop counting is refused at query time instead.
CREATE OR REPLACE FUNCTION public.grant_member_access(p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := public.normalize_email(p_email);
BEGIN
  IF v_email IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.email IS NOT NULL
      AND public.normalize_email(m.email) = v_email
      AND public.member_grants_access(m.membership_status, m."archivedAt", m.labels)
  ) THEN
    RETURN;
  END IF;

  UPDATE public.user_profiles p
     SET status      = 'approved',
         approved_at = now(),
         approved_by = NULL
    FROM auth.users u
   WHERE u.id = p.user_id
     AND p.status = 'pending'
     AND p.role = 'member'
     AND u.email_confirmed_at IS NOT NULL
     AND public.normalize_email(u.email) = v_email;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_grant_member_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NOT NULL
     AND public.member_grants_access(NEW.membership_status, NEW."archivedAt", NEW.labels) THEN
    PERFORM public.grant_member_access(NEW.email);
  END IF;
  RETURN NEW;
END;
$$;

-- The old trigger fired on UPDATE OF email, labels: never for a status that
-- trigger_link_changed_status sets (link gone or revived) or an archive date,
-- but for every member in every nightly upsert, labels unchanged or not.
-- WHEN compares the final row, so it also sees the status the BEFORE trigger
-- derives from the labels, and skips the upserts that change nothing.
DROP TRIGGER IF EXISTS grant_member_access_on_member_change ON public.members;

CREATE TRIGGER grant_member_access_on_member_insert
  AFTER INSERT ON public.members
  FOR EACH ROW
  WHEN (NEW.email IS NOT NULL)
  EXECUTE FUNCTION public.trigger_grant_member_access();

CREATE TRIGGER grant_member_access_on_member_change
  AFTER UPDATE ON public.members
  FOR EACH ROW
  WHEN (
    NEW.email IS NOT NULL
    AND (
      OLD.email IS DISTINCT FROM NEW.email
      OR OLD.labels IS DISTINCT FROM NEW.labels
      OR OLD.membership_status IS DISTINCT FROM NEW.membership_status
      OR OLD."archivedAt" IS DISTINCT FROM NEW."archivedAt"
    )
  )
  EXECUTE FUNCTION public.trigger_grant_member_access();

-----------------
-- New Webling members before their link exists
-----------------

-- The sync upserts every member first and writes the links afterwards
-- (write_links), so for the length of a run a member Webling has just
-- added had no link and counted as created in Administra: active without
-- any status group, enough for the automatic approval and for access. Rows
-- in the Webling id range (1'000 to 10'000'000, see
-- 20261025220000_fence_member_event_ids.sql and sync_rules.py) are never
-- created in the app any more, and the sync records every unlinked one as
-- gone, so treating them as Webling's is only ever right. Same as
-- 20261025230000_membership_status_and_member_links.sql otherwise.
CREATE OR REPLACE FUNCTION public.trigger_set_membership_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.membership_status := public.member_status_from_labels(
    NEW.labels,
    coalesce(
      public.provider_link_state(NEW.id),
      CASE WHEN NEW.id >= 1000 AND NEW.id < 10000000 THEN 'active' END
    )
  );
  RETURN NEW;
END;
$$;

-- Expected to touch no row (prod and seed link every row in the range); the
-- BEFORE trigger derives the status again
UPDATE public.members m
   SET membership_status = m.membership_status
 WHERE m.id >= 1000 AND m.id < 10000000
   AND NOT EXISTS (SELECT 1 FROM public.member_links l WHERE l.member_id = m.id);

-----------------
-- New accounts wait as 'member'
-----------------

-- Approving a waiting account by hand used to make it a viewer (staff, with
-- contact data and children's records) unless the admin changed the role.
-- After this migration non-members and people who left all wait in
-- "Ausstehend", so a habitual click must give member access, which then
-- follows the membership. Staff roles are picked on purpose.
ALTER TABLE public.user_profiles ALTER COLUMN role SET DEFAULT 'member';

-- Same as 20261019130000_bootstrap_admin_requires_confirmed_email.sql, except
-- that new profiles get the role 'member' instead of 'viewer'.
CREATE OR REPLACE FUNCTION public.handle_auth_user_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean := public.is_bootstrap_admin(NEW.email)
                        AND NEW.email_confirmed_at IS NOT NULL;
BEGIN
  INSERT INTO public.user_profiles (
    user_id, email, full_name, avatar_url, status, role, approved_at
  )
  VALUES (
    NEW.id,
    coalesce(NEW.email, ''),
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url',
    CASE WHEN v_is_admin THEN 'approved'::public.user_status ELSE 'pending'::public.user_status END,
    CASE WHEN v_is_admin THEN 'admin'::public.user_role    ELSE 'member'::public.user_role  END,
    CASE WHEN v_is_admin THEN now() ELSE NULL END
  )
  ON CONFLICT (user_id) DO UPDATE SET
    email      = EXCLUDED.email,
    full_name  = coalesce(EXCLUDED.full_name,  public.user_profiles.full_name),
    avatar_url = coalesce(EXCLUDED.avatar_url, public.user_profiles.avatar_url);

  -- The bootstrap email was confirmed after the profile was created: promote
  -- the waiting profile now. Disabled profiles stay disabled.
  IF v_is_admin THEN
    UPDATE public.user_profiles
       SET status = 'approved', role = 'admin', approved_at = now()
     WHERE user_id = NEW.id
       AND status = 'pending';
  END IF;

  IF NEW.email_confirmed_at IS NOT NULL THEN
    PERFORM public.grant_member_access(NEW.email);
  END IF;
  RETURN NEW;
END;
$$;

-- Accounts waiting today got 'viewer' only as the old default. One an admin
-- gave an exam role was meant as staff and stays a viewer.
UPDATE public.user_profiles
   SET role = 'member'
 WHERE status = 'pending'
   AND role = 'viewer'
   AND exam_role IS NULL;

-----------------
-- Admin report and own access
-----------------

-- Member accounts none of whose records counts: approved ones have no access
-- now, waiting ones would get none if approved as members. The users page
-- marks both; statuses gives the reason per record (member_access_status).
-- Same columns as 20261025230000_membership_status_and_member_links.sql.
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
    coalesce(
      array_agg(DISTINCT public.member_access_status(m.membership_status, m."archivedAt", m.labels))
        FILTER (WHERE m.id IS NOT NULL),
      '{}'
    )
  FROM public.user_profiles p
  LEFT JOIN public.members m
    ON m.id = p.member_id
    OR (
      m.email IS NOT NULL
      AND public.normalize_email(m.email) = public.normalize_email(p.email)
    )
  WHERE public.is_admin()
    AND p.status IN ('approved', 'pending')
    AND p.role = 'member'
  GROUP BY p.user_id, p.email, p.full_name
  HAVING NOT coalesce(
    bool_or(public.member_grants_access(m.membership_status, m."archivedAt", m.labels)),
    false
  )
  ORDER BY p.email;
$$;

-- The signed-in account's access, for the app: has_access is
-- is_approved_user() itself, so routing can never disagree with RLS;
-- member_statuses gives the reason per record (linked or by e-mail, trial
-- candidates included), so the pending page can say why. Only the caller's
-- own records, without names or ids, found through its confirmed e-mail:
-- an unconfirmed address would tell anyone whether it belongs to a member.
CREATE OR REPLACE FUNCTION public.my_access()
RETURNS TABLE (has_access boolean, member_statuses text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT p.member_id,
           CASE WHEN u.email_confirmed_at IS NOT NULL THEN p.email END AS email
    FROM public.user_profiles p
    JOIN auth.users u ON u.id = p.user_id
    WHERE p.user_id = auth.uid()
  ),
  records AS (
    SELECT m.id, m.membership_status, m."archivedAt", m.labels
    FROM me
    JOIN public.members m ON m.id = me.member_id
    UNION
    SELECT m.id, m.membership_status, m."archivedAt", m.labels
    FROM me
    JOIN public.members m
      ON public.normalize_email(m.email) = public.normalize_email(me.email)
     AND m.email IS NOT NULL
  )
  SELECT
    public.is_approved_user(),
    coalesce(
      (SELECT array_agg(DISTINCT public.member_access_status(r.membership_status, r."archivedAt", r.labels))
       FROM records r),
      '{}'
    );
$$;

-----------------
-- Function privileges (Supabase grants EXECUTE to anon/authenticated on new
-- functions, see 20260913140000_relock_security_definer_functions.sql).
-- CREATE OR REPLACE keeps the privileges of the functions that existed.
-----------------
REVOKE EXECUTE ON FUNCTION public.member_grants_access(text, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.member_access_status(text, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.member_account_has_access(integer, text)       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.my_access()                                    FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.my_access()                                    TO authenticated;
