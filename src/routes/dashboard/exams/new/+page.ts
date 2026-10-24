import { redirect } from '@sveltejs/kit';
import { loadEventOptions } from '../events';
import type { PageLoad } from './$types';

// Exam days are set by the TK; everybody else browses them
export const load: PageLoad = async ({ parent }) => {
  const { canManageExams } = await parent();
  if (!canManageExams) {
    redirect(303, '/dashboard/exams');
  }
  return { events: await loadEventOptions() };
};
