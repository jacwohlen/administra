import { supabaseClient } from '$lib/supabase';
import { error as err } from '@sveltejs/kit';
import { getGradeDefinitions } from '$lib/referenceData';
import type { ExamCandidate, ExamProgram } from '$lib/models';
import { CANDIDATE_COLUMNS } from '../queries';
import type { PageLoad } from './$types';

export type ProgramSummary = Pick<ExamProgram, 'id' | 'grade' | 'title' | 'min_points'>;

export const load: PageLoad = async ({ params, parent, depends }) => {
  depends('app:exam-candidates');

  // The candidates need only the id: asked while the layouts still load
  const [{ exam, programResult }, candidateResult, gradeDefinitions] = await Promise.all([
    parent().then(async ({ exam }) => ({
      exam,
      programResult: await supabaseClient
        .from('exam_programs')
        .select('id, grade, title, min_points')
        .eq('section', exam.section)
        .returns<ProgramSummary[]>()
    })),
    supabaseClient
      .from('exam_candidates')
      .select(CANDIDATE_COLUMNS)
      .eq('exam_id', params.examId)
      .returns<ExamCandidate[]>(),
    getGradeDefinitions()
  ]);
  if (candidateResult.error) {
    throw err(500, candidateResult.error.message);
  }

  return {
    candidates: candidateResult.data ?? [],
    programs: programResult.data ?? [],
    ladder: gradeDefinitions
      .filter((g) => g.section === exam.section)
      .sort((a, b) => a.gradeRank - b.gradeRank)
  };
};
