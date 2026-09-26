export const ssr = false;
import { redirect } from '@sveltejs/kit';
import { homePath, isApproved, isStaff } from '$lib/roles';
import type { LayoutLoad } from './$types';

// Personal club area: every approved account (members and staff) may enter.
export const load: LayoutLoad = async ({ parent }) => {
  const { session, userProfile } = await parent();
  if (!session) {
    redirect(303, '/');
  }
  if (!userProfile || !isApproved(userProfile)) {
    redirect(303, homePath(userProfile));
  }

  return {
    session,
    userProfile,
    isStaff: isStaff(userProfile)
  };
};
