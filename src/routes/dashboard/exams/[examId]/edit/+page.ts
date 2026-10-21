import { redirect } from '@sveltejs/kit';
import { loadEventOptions } from '../../events';
import type { PageLoad } from './$types';

// Viewers may browse exam days but not change them
export const load: PageLoad = async ({ parent, params }) => {
  const { canWrite, exam } = await parent();
  if (!canWrite) {
    redirect(303, `/dashboard/exams/${params.examId}`);
  }
  return { events: await loadEventOptions(exam.event_id) };
};
