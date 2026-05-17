export const ssr = false;
import { redirect } from '@sveltejs/kit';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ parent }) => {
  const { session, userProfile } = await parent();
  if (!session) {
    redirect(303, '/');
  }
  if (!userProfile || userProfile.status !== 'approved') {
    redirect(303, '/pending');
  }
  return {
    session,
    userProfile
  };
};
