import { redirect } from '@sveltejs/kit';
import { homePath } from '$lib/roles';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent }) => {
  const { session, userProfile, access } = await parent();
  if (!session) {
    redirect(303, '/');
  }
  // Same rule as the club and dashboard guards, so they never send an
  // account back and forth
  const home = homePath(userProfile, access);
  if (home !== '/pending') {
    redirect(303, home);
  }
  return {};
};
