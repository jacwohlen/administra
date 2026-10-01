import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// Viewers may browse events but not create them
export const load: PageLoad = async ({ parent }) => {
  const { canWrite } = await parent();
  if (!canWrite) {
    redirect(303, '/dashboard/events');
  }
};
