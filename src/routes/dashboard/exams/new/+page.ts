import { redirect } from '@sveltejs/kit';
import { loadEventOptions } from '../events';
import type { PageLoad } from './$types';

// Viewers may browse exam days but not create them
export const load: PageLoad = async ({ parent }) => {
  const { canWrite } = await parent();
  if (!canWrite) {
    redirect(303, '/dashboard/exams');
  }
  return { events: await loadEventOptions() };
};
