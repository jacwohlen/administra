import type { ExamCandidate, ExamExaminer, ExamScore } from './models';

// Live sheets: changes by other examiners (and the echo of one's own writes)
// arrive as Supabase Realtime row changes and are merged into the sheet's
// local copies. They arrive in commit order, so the copies end up as the
// database has them.

/** A changed row as Supabase Realtime (postgres_changes) delivers it. */
export interface RowChange<T> {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Partial<T>;
  /** For DELETE only the primary key (the tables have row level security) */
  old: Partial<T>;
}

function changedRow<T>(change: RowChange<T>): Partial<T> {
  return change.eventType === 'DELETE' ? change.old : change.new;
}

/** The scores after a change to one item's row. */
export function applyScoreChange(scores: ExamScore[], change: RowChange<ExamScore>): ExamScore[] {
  const row = changedRow(change);
  const same = (s: ExamScore) => s.candidate_id === row.candidate_id && s.item_key === row.item_key;
  if (change.eventType === 'DELETE') return scores.filter((s) => !same(s));
  const next = row as ExamScore;
  return scores.some(same) ? scores.map((s) => (same(s) ? next : s)) : [...scores, next];
}

/**
 * The candidates after a change to one of their rows: the table's columns
 * (status, start, snapshot, result, totals ...); member and examiners are
 * embedded and stay as loaded. Other events need a reload.
 */
export function applyCandidateChange(
  candidates: ExamCandidate[],
  change: RowChange<ExamCandidate>
): ExamCandidate[] {
  if (change.eventType !== 'UPDATE') return candidates;
  return candidates.map((c) =>
    c.id === change.new.id ? { ...c, ...change.new, member: c.member, examiners: c.examiners } : c
  );
}

/** The candidates after an examiner signed on to or off a sheet. */
export function applyExaminerChange(
  candidates: ExamCandidate[],
  change: RowChange<ExamExaminer>
): ExamCandidate[] {
  const row = changedRow(change);
  return candidates.map((c) => {
    if (c.id !== row.candidate_id) return c;
    const examiners = c.examiners ?? [];
    const same = (e: ExamExaminer) => e.user_id === row.user_id;
    if (change.eventType === 'DELETE')
      return { ...c, examiners: examiners.filter((e) => !same(e)) };
    const next = row as ExamExaminer;
    return {
      ...c,
      examiners: examiners.some(same)
        ? examiners.map((e) => (same(e) ? next : e))
        : [...examiners, next]
    };
  });
}
