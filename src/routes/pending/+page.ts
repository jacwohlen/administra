import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent }) => {
  const { session, userProfile } = await parent();
  if (!session) {
    redirect(303, '/');
  }
  if (userProfile?.status === 'approved') {
    redirect(303, '/dashboard');
  }
  return {};
};
