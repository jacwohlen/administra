import { supabaseClient } from '$lib/supabase';
import { error as err } from '@sveltejs/kit';
import type { Exam } from '$lib/models';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ params, depends }) => {
  depends('app:exam');
  const { data, error } = await supabaseClient
    .from('exams')
    .select('*')
    .eq('id', params.examId)
    .maybeSingle<Exam>();
  if (error || !data) {
    throw err(404, error?.message ?? 'Exam not found');
  }
  return { exam: data };
};
