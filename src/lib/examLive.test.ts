import { describe, it, expect } from 'vitest';
import { applyCandidateChange, applyExaminerChange, applyScoreChange } from './examLive';
import type { ExamCandidate, ExamScore } from './models';

function score(candidateId: number, itemKey: string, extra: Partial<ExamScore> = {}): ExamScore {
  return {
    candidate_id: candidateId,
    item_key: itemKey,
    left_points: null,
    right_points: null,
    points: null,
    note: null,
    ...extra
  };
}

function candidate(id: number, extra: Partial<ExamCandidate> = {}): ExamCandidate {
  return {
    id,
    exam_id: 1,
    member_id: 100 + id,
    section: 'Judo',
    grade: '5. Kyu',
    status: 'invited',
    min_points: null,
    started_at: null,
    result: null,
    total_points: null,
    max_points: null,
    completed_at: null,
    registered_at: '2026-10-01T10:00:00Z',
    member: { id: 100 + id, firstname: 'A', lastname: 'B' },
    examiners: [],
    ...extra
  };
}

describe('applyScoreChange', () => {
  it('adds a new row and replaces an existing one in place', () => {
    const before = [score(1, 'nage-1', { left_points: 1 }), score(1, 'nage-2')];
    const inserted = applyScoreChange(before, {
      eventType: 'INSERT',
      new: score(2, 'nage-1', { points: 2 }),
      old: {}
    });
    expect(inserted).toHaveLength(3);
    expect(inserted[2]).toMatchObject({ candidate_id: 2, points: 2 });

    const updated = applyScoreChange(before, {
      eventType: 'UPDATE',
      new: score(1, 'nage-1', { left_points: 2, right_points: 1 }),
      old: { candidate_id: 1, item_key: 'nage-1' }
    });
    expect(updated.map((s) => s.item_key)).toEqual(['nage-1', 'nage-2']);
    expect(updated[0]).toMatchObject({ left_points: 2, right_points: 1 });
  });

  it('removes a deleted row by its key', () => {
    const before = [score(1, 'nage-1'), score(2, 'nage-1')];
    const after = applyScoreChange(before, {
      eventType: 'DELETE',
      new: {},
      old: { candidate_id: 1, item_key: 'nage-1' }
    });
    expect(after).toEqual([score(2, 'nage-1')]);
  });
});

describe('applyCandidateChange', () => {
  it('takes the row columns and keeps member and examiners', () => {
    const examiners = [{ candidate_id: 1, user_id: 'u1', name: 'Eva' }];
    const before = [candidate(1, { examiners }), candidate(2)];
    const after = applyCandidateChange(before, {
      eventType: 'UPDATE',
      new: { id: 1, result: 'passed', total_points: 50, started_at: '2026-10-24T09:00:00Z' },
      old: { id: 1 }
    });
    expect(after[0]).toMatchObject({ result: 'passed', total_points: 50, examiners });
    expect(after[0].member).toEqual(before[0].member);
    expect(after[1]).toBe(before[1]);
  });

  it('leaves inserts and deletes to a reload', () => {
    const before = [candidate(1)];
    expect(applyCandidateChange(before, { eventType: 'DELETE', new: {}, old: { id: 1 } })).toBe(
      before
    );
  });
});

describe('applyExaminerChange', () => {
  it('signs an examiner on once and off again', () => {
    const before = [candidate(1), candidate(2)];
    const row = { candidate_id: 1, user_id: 'u1', name: 'Eva' };
    const on = applyExaminerChange(before, { eventType: 'INSERT', new: row, old: {} });
    expect(on[0].examiners).toEqual([row]);
    expect(on[1]).toBe(before[1]);
    // The echo of one's own sign-on, already added locally, is not doubled
    expect(
      applyExaminerChange(on, { eventType: 'INSERT', new: row, old: {} })[0].examiners
    ).toEqual([row]);
    const off = applyExaminerChange(on, {
      eventType: 'DELETE',
      new: {},
      old: { candidate_id: 1, user_id: 'u1' }
    });
    expect(off[0].examiners).toEqual([]);
  });
});
