import { error } from '@sveltejs/kit';
import { supabaseClient } from '$lib/supabase';
import { getGradeDefinitions } from '$lib/referenceData';
import type { ExamProgram } from '$lib/models';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => {
  const [{ data: program }, gradeDefinitions] = await Promise.all([
    supabaseClient
      .from('exam_programs')
      .select('*')
      .eq('id', params.programId)
      .maybeSingle<ExamProgram>(),
    getGradeDefinitions()
  ]);
  if (!program) error(404, 'Program not found');
  return {
    program,
    grade: gradeDefinitions.find((g) => g.section === program.section && g.grade === program.grade)
  };
};
