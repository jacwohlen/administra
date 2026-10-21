import { supabaseClient } from '$lib/supabase';
import { error as err } from '@sveltejs/kit';
import { getGradeDefinitions } from '$lib/referenceData';
import type { ExamProgram } from '$lib/models';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, url, parent, depends }) => {
  depends('app:exam-program');
  const { canWrite } = await parent();
  const [programResult, gradeDefinitions] = await Promise.all([
    supabaseClient
      .from('exam_programs')
      .select('*')
      .eq('id', params.programId)
      .maybeSingle<ExamProgram>(),
    getGradeDefinitions()
  ]);
  if (programResult.error || !programResult.data) {
    throw err(404, programResult.error?.message ?? 'Program not found');
  }
  const program = programResult.data;
  return {
    program,
    grade: gradeDefinitions.find((g) => g.section === program.section && g.grade === program.grade),
    // A freshly created program opens straight in the editor
    startEditing: canWrite && url.searchParams.has('edit')
  };
};
