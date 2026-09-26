import { redirect } from '@sveltejs/kit';
import { homePath, isApproved } from '$lib/roles';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent }) => {
  const { session, userProfile } = await parent();
  if (!session) {
    redirect(303, '/');
  }
  if (isApproved(userProfile)) {
    redirect(303, homePath(userProfile));
  }
  return {};
};
