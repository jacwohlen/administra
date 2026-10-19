-- The bootstrap admin (is_bootstrap_admin()) was approved as admin as soon
-- as an auth user with that email was created, before anyone proved they own
-- the address. With email confirmations off (as in supabase/config.toml until
-- now), signing up with that email and any password gave instant admin on
-- every environment where the account did not exist yet.
--
-- Now the bootstrap email only becomes admin once auth.users has
-- email_confirmed_at: right away for Google sign-in, and after the one-time
-- code for email sign-in. Until then the profile is pending like any other.
--
-- Same body as 20260926090100_member_self_service.sql, except for the
-- bootstrap check. CREATE OR REPLACE keeps the existing grants.
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
    CASE WHEN v_is_admin THEN 'admin'::public.user_role    ELSE 'viewer'::public.user_role  END,
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
