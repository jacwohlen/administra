-- Admins delete accounts that never should have been there
--
-- The one-time code sign-in creates the auth user as soon as someone asks
-- for a code, so a mistyped address (name@bluewin.ch.ch) shows up as a
-- waiting account that nobody can ever confirm, and the users page had no
-- way to remove it. Two functions for that page:
--
--   unconfirmed_user_ids()      the accounts whose e-mail was never
--                               confirmed (no code entered, no Google
--                               sign-in), marked on the page
--   delete_user_account(id)     deletes a waiting or disabled account: the
--                               auth user, and with it (ON DELETE CASCADE)
--                               its profile, calendar feed and own rows
--
-- Approved accounts are disabled first, so a click never removes someone who
-- is in; the caller's own account and the last admin stay
-- (protect_last_admin). Both are for admins only (is_admin()).

CREATE OR REPLACE FUNCTION public.unconfirmed_user_ids()
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admins only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT u.id FROM auth.users u WHERE u.email_confirmed_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_user_account(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status public.user_status;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admins only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'OWN_ACCOUNT' USING ERRCODE = '22023',
      HINT = 'Admins cannot delete their own account.';
  END IF;

  SELECT status INTO v_status FROM public.user_profiles WHERE user_id = p_user_id;
  IF v_status = 'approved' THEN
    RAISE EXCEPTION 'ACCOUNT_APPROVED' USING ERRCODE = '22023',
      HINT = 'Disable the account before deleting it.';
  END IF;

  -- The only reference to auth.users without ON DELETE (lesson plans keep
  -- their plan, like every other created_by does).
  UPDATE public.lesson_plans SET created_by = NULL WHERE created_by = p_user_id;
  DELETE FROM auth.users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account not found' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.unconfirmed_user_ids()      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_user_account(uuid)   FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.unconfirmed_user_ids()      TO authenticated;
GRANT  EXECUTE ON FUNCTION public.delete_user_account(uuid)   TO authenticated;
