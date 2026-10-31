import { supabaseClient } from '$lib/supabase';
import { error as err, redirect } from '@sveltejs/kit';
import { getGradeDefinitions } from '$lib/referenceData';
import type { ExamCandidate, ExamProgram, ExamScore } from '$lib/models';
import { CANDIDATE_COLUMNS } from '../../queries';
import type { PageLoad } from './$types';

// The sheet for one or more candidates: /dashboard/exams/[examId]/sheet?c=12,13
export const load: PageLoad = async ({ params, parent, url, depends }) => {
  const ids = [
    ...new Set(
      (url.searchParams.get('c') ?? '')
        .split(',')
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0)
    )
  ];
  if (ids.length === 0) {
    redirect(303, `/dashboard/exams/${params.examId}`);
  }
  depends('app:exam-sheet');

  // Opened on the phone straight from a link: candidates and scores are
  // asked while the layouts still load, the programs once the exam's section
  // is known
  const [{ exam, programResult }, candidateResult, scoreResult, gradeDefinitions] =
    await Promise.all([
      parent().then(async ({ exam }) => ({
        exam,
        programResult: await supabaseClient
          .from('exam_programs')
          .select('*')
          .eq('section', exam.section)
          .returns<ExamProgram[]>()
      })),
      supabaseClient
        .from('exam_candidates')
        .select(`program, ${CANDIDATE_COLUMNS}`)
        .eq('exam_id', params.examId)
        .in('id', ids)
        .returns<ExamCandidate[]>(),
      supabaseClient.from('exam_scores').select('*').in('candidate_id', ids).returns<ExamScore[]>(),
      getGradeDefinitions()
    ]);
  if (candidateResult.error) {
    throw err(500, candidateResult.error.message);
  }

  const byId = new Map((candidateResult.data ?? []).map((c) => [c.id, c]));
  return {
    // In the order of the link, so pairs stay side by side
    candidates: ids.map((id) => byId.get(id)).filter((c): c is ExamCandidate => !!c),
    scores: scoreResult.data ?? [],
    programs: programResult.data ?? [],
    ladder: gradeDefinitions.filter((g) => g.section === exam.section)
  };
};
