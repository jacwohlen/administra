import { supabaseClient } from '$lib/supabase';
import type { ExamCandidate } from '$lib/models';

/** Candidate columns for lists: everything but the program snapshot. */
export const CANDIDATE_COLUMNS =
  'id, exam_id, member_id, section, grade, belt_length_cm, trainer, note, status, group_name, ' +
  'call_time, min_points, started_at, result, total_points, max_points, completed_at, ' +
  'registered_at, member:members(id, firstname, lastname, birthday, img), ' +
  'examiners:exam_examiners(candidate_id, user_id, name)';

/** Put the signed-in examiner on these candidates (no-op where already on). */
export async function assignExaminer(
  candidates: Pick<ExamCandidate, 'id' | 'examiners'>[],
  userId: string,
  name: string
) {
  const rows = candidates
    .filter((c) => !c.examiners?.some((e) => e.user_id === userId))
    .map((c) => ({ candidate_id: c.id, user_id: userId, name }));
  if (rows.length === 0) return { error: null };
  return supabaseClient
    .from('exam_examiners')
    .upsert(rows, { onConflict: 'candidate_id,user_id', ignoreDuplicates: true });
}
