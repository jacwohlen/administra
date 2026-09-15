import type { LayoutServerLoad } from './$types';
import type { UserProfile } from '$lib/models';

export const load: LayoutServerLoad = async ({ locals: { safeGetSession, supabase } }) => {
  const { session, user } = await safeGetSession();

  let userProfile: UserProfile | null = null;
  if (user) {
    const { data } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    userProfile = data ?? null;
  }

  return {
    session,
    userProfile
  };
};
