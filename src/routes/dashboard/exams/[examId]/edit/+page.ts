import { redirect } from '@sveltejs/kit';
import { supabaseClient } from '$lib/supabase';
import { loadEventOptions } from '../../events';
import type { PageLoad } from './$types';

// Exam days are set by the TK; everybody else browses them
export const load: PageLoad = async ({ parent, params }) => {
  const { canManageExams, exam } = await parent();
  if (!canManageExams) {
    redirect(303, `/dashboard/exams/${params.examId}`);
  }
  const [events, { count }] = await Promise.all([
    loadEventOptions(exam.event_id),
    supabaseClient
      .from('exam_candidates')
      .select('id', { count: 'exact', head: true })
      .eq('exam_id', exam.id)
  ]);
  // Candidates are registered for grades of the section (the database enforces it too)
  return { events, sectionLocked: (count ?? 0) > 0 };
};
