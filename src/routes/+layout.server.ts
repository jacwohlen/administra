import type { LayoutServerLoad } from './$types';
import type { MyAccess, UserProfile } from '$lib/models';
import { followsMembership } from '$lib/roles';

export const load: LayoutServerLoad = async ({ locals: { safeGetSession, supabase } }) => {
  const { session, user } = await safeGetSession();

  let userProfile: UserProfile | null = null;
  let access: MyAccess | null = null;
  if (user) {
    const { data } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    userProfile = data ?? null;
  }

  // A member account may use Administra only while a member record counts,
  // which the nightly Webling sync can change at any time: ask whenever this
  // load runs (page load, invalidateAll, the hourly token refresh). Staff get
  // in by their role and skip the call. On an error access stays null and
  // routing goes by the status alone; the database still refuses every query.
  if (userProfile && followsMembership(userProfile)) {
    const { data, error } = await supabase.rpc('my_access').maybeSingle<MyAccess>();
    access = error ? null : (data ?? null);
  }

  return {
    session,
    userProfile,
    access
  };
};
