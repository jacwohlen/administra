import { supabaseClient } from '$lib/supabase';
import { error as err } from '@sveltejs/kit';
import type { ExamCandidate } from '$lib/models';
import { CANDIDATE_COLUMNS } from '../../queries';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, parent }) => {
  // Asked while the layouts still load; the exam (404) is the layout's
  const [, { data, error }] = await Promise.all([
    parent(),
    supabaseClient
      .from('exam_candidates')
      .select(CANDIDATE_COLUMNS)
      .eq('exam_id', params.examId)
      .neq('status', 'withdrawn')
      .returns<ExamCandidate[]>()
  ]);
  if (error) {
    throw err(500, error.message);
  }
  return { candidates: data ?? [] };
};
