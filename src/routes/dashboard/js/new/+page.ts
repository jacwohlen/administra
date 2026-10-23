import { redirect } from '@sveltejs/kit';
import { loadTrainingOptions } from '../trainingOptions';
import type { PageLoad } from './$types';

// Viewers may export courses but not create them
export const load: PageLoad = async ({ parent }) => {
  const { canWrite } = await parent();
  if (!canWrite) {
    redirect(303, '/dashboard/js');
  }
  return { trainings: await loadTrainingOptions() };
};
