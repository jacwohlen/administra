-- Bootstrap admins become data instead of code.
--
-- is_bootstrap_admin() had the JAC Wohlen admin's address hard-coded
-- (20260906130000_add_user_management.sql). Every database built from these
-- migrations therefore made that address an admin — fine while Administra
-- served one club, wrong once each club gets its own Supabase project from
-- the same migrations (docs/CLUB_INSTANCES.md): the JAC admin would be admin
-- of every other club's data.
--
-- The addresses now live in public.bootstrap_admins. This migration keeps
-- today's behavior on Prod, Dev and previews by inserting the JAC address;
-- scripts/club-instances/provision.mjs replaces the rows with the new club's
-- own admin before anyone can sign in to a fresh project.
--
-- Unchanged: the address only counts once auth.users.email_confirmed_at is
-- set (20261019130000_bootstrap_admin_requires_confirmed_email.sql), and only
-- on profile creation — removing a row later never demotes anyone.

CREATE TABLE public.bootstrap_admins (
  email text PRIMARY KEY CHECK (email = lower(email))
);

-- Nobody reads this through the API: RLS without policies, and no grants for
-- the API roles (default privileges from 20260915130000 grant them on every
-- new table, so revoke explicitly).
ALTER TABLE public.bootstrap_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bootstrap_admins FROM PUBLIC, anon, authenticated;

INSERT INTO public.bootstrap_admins (email) VALUES ('andreas.schmid@jacwohlen.ch');

-- STABLE instead of IMMUTABLE: the result now depends on table contents.
-- SECURITY DEFINER so it can read the locked table; it is only called from
-- handle_auth_user_change(), itself SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.is_bootstrap_admin(p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.bootstrap_admins
    WHERE email = lower(coalesce(p_email, ''))
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_bootstrap_admin(text) FROM PUBLIC, anon, authenticated;
