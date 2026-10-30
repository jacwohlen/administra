export const ssr = false;
import { redirect } from '@sveltejs/kit';
import { canUseClub, homePath, isStaff } from '$lib/roles';
import type { LayoutLoad } from './$types';

// Personal club area: staff, and member accounts while a member record is an
// active or passive membership (my_access(), loaded by the root layout).
export const load: LayoutLoad = async ({ parent }) => {
  const { session, userProfile, access } = await parent();
  if (!session) {
    redirect(303, '/');
  }
  if (!userProfile || !canUseClub(userProfile, access)) {
    redirect(303, homePath(userProfile, access));
  }

  return {
    session,
    userProfile,
    isStaff: isStaff(userProfile)
  };
};
