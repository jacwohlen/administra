import { supabaseClient } from '$lib/supabase';
import { error as err } from '@sveltejs/kit';
import type { Exam, ExamCandidate } from '$lib/models';
import type { PageLoad } from './$types';

export type ExamListEntry = Exam & {
  candidates: Pick<ExamCandidate, 'status' | 'started_at' | 'result'>[];
};

export const load: PageLoad = async () => {
  const { data, error } = await supabaseClient
    .from('exams')
    .select('*, candidates:exam_candidates(status, started_at, result)')
    .order('date', { ascending: false })
    .returns<ExamListEntry[]>();
  if (error) {
    throw err(500, error.message);
  }
  return { exams: data ?? [] };
};
