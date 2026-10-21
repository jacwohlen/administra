import { error } from '@sveltejs/kit';
import { supabaseClient } from '$lib/supabase';
import type { Exam, ExamCandidate, ExamExaminer, ExamScore } from '$lib/models';
import type { PageLoad } from './$types';

type ResultCandidate = ExamCandidate & {
  exam: Pick<Exam, 'title' | 'date'> | null;
  member: { firstname: string; lastname: string } | null;
};

// A member's finished exam sheet. The database only returns the member's own
// sheets, and scores only once the result is in.
export const load: PageLoad = async ({ params }) => {
  const id = Number(params.candidateId);
  const [candidateResult, scoreResult, examinerResult] = await Promise.all([
    supabaseClient
      .from('exam_candidates')
      .select('*, exam:exams(title, date), member:members(firstname, lastname)')
      .eq('id', id)
      .not('result', 'is', null)
      .maybeSingle<ResultCandidate>(),
    supabaseClient.from('exam_scores').select('*').eq('candidate_id', id).returns<ExamScore[]>(),
    supabaseClient
      .from('exam_examiners')
      .select('candidate_id, user_id, name')
      .eq('candidate_id', id)
      .returns<ExamExaminer[]>()
  ]);
  if (!candidateResult.data) error(404, 'Exam sheet not found');

  return {
    candidate: candidateResult.data,
    scores: scoreResult.data ?? [],
    examiners: (examinerResult.data ?? []).map((e) => e.name)
  };
};
