import { supabaseClient } from '$lib/supabase';
import { error as err } from '@sveltejs/kit';
import { getGradeDefinitions } from '$lib/referenceData';
import type { ExamProgram } from '$lib/models';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ depends }) => {
  depends('app:exam-programs');
  const [programResult, gradeDefinitions] = await Promise.all([
    supabaseClient.from('exam_programs').select('*').returns<ExamProgram[]>(),
    getGradeDefinitions()
  ]);
  if (programResult.error) {
    throw err(500, programResult.error.message);
  }
  return { programs: programResult.data ?? [], gradeDefinitions };
};
