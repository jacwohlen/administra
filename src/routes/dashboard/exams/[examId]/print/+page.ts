import { supabaseClient } from '$lib/supabase';
import { error as err } from '@sveltejs/kit';
import type { ExamCandidate } from '$lib/models';
import { CANDIDATE_COLUMNS } from '../../queries';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent }) => {
  const { exam } = await parent();
  const { data, error } = await supabaseClient
    .from('exam_candidates')
    .select(CANDIDATE_COLUMNS)
    .eq('exam_id', exam.id)
    .neq('status', 'withdrawn')
    .returns<ExamCandidate[]>();
  if (error) {
    throw err(500, error.message);
  }
  return { candidates: data ?? [] };
};
