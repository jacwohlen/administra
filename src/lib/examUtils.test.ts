import { describe, it, expect } from 'vitest';
import {
  applyScore,
  candidateState,
  defaultMinPoints,
  evaluateExam,
  examinerName,
  groupCandidates,
  itemMaxPoints,
  newItemKey,
  newPartKey,
  programMaxPoints,
  programProblems,
  registrableGrades,
  sheetGroups
} from './examUtils';
import type { ExamCandidate, ExamPart, ExamScore, GradeDefinition } from './models';

// Excerpt of the Halbgelbgurt sheet: two-sided throws with a part minimum,
// single-scored tasks without one.
const parts: ExamPart[] = [
  {
    key: 'nage',
    title: 'Nage-waza',
    minPoints: 6,
    items: [
      { key: 'nage-1', name: 'O-soto-gari', sides: 2 },
      { key: 'nage-2', name: 'Hiza-guruma', sides: 2 }
    ]
  },
  {
    key: 'theorie',
    title: 'Theorie',
    items: [{ key: 'theorie-1', name: 'Thema Ippon', sides: 1 }]
  }
];

const score = (item_key: string, s: Partial<ExamScore>): ExamScore => ({
  candidate_id: 1,
  item_key,
  left_points: null,
  right_points: null,
  points: null,
  note: null,
  ...s
});

describe('points', () => {
  it('counts two points per scored side', () => {
    expect(itemMaxPoints({ sides: 2 })).toBe(4);
    expect(itemMaxPoints({ sides: 1 })).toBe(2);
    expect(programMaxPoints(parts)).toBe(10);
  });

  it('suggests three quarters of the maximum, rounded down like the sheets', () => {
    expect([42, 66, 58, 92, 104, 118, 140, 156].map(defaultMinPoints)).toEqual([
      31, 49, 43, 69, 78, 88, 105, 117
    ]);
  });
});

describe('evaluateExam', () => {
  it('is empty and not passed without scores', () => {
    const e = evaluateExam(parts, 7, []);
    expect(e).toMatchObject({ points: 0, max: 10, scored: 0, sides: 5, complete: false });
    expect(e.passed).toBe(false);
  });

  it('adds left, right and single points', () => {
    const e = evaluateExam(parts, 7, [
      score('nage-1', { left_points: 2, right_points: 1 }),
      score('nage-2', { left_points: 2, right_points: 2 }),
      score('theorie-1', { points: 1 })
    ]);
    expect(e.points).toBe(8);
    expect(e.parts.map((p) => [p.key, p.points, p.max])).toEqual([
      ['nage', 7, 8],
      ['theorie', 1, 2]
    ]);
    expect(e.complete).toBe(true);
    expect(e.passed).toBe(true);
  });

  it('fails when a part misses its minimum, even above the overall minimum', () => {
    const e = evaluateExam(parts, 5, [
      score('nage-1', { left_points: 2, right_points: 2 }),
      score('nage-2', { left_points: 1, right_points: 0 }),
      score('theorie-1', { points: 2 })
    ]);
    expect(e.points).toBe(7);
    expect(e.parts[0]).toMatchObject({ points: 5, minPoints: 6, met: false });
    expect(e.passed).toBe(false);
  });

  it('ignores scores of items that are not on the sheet', () => {
    const e = evaluateExam(parts, 0, [score('gone-1', { points: 2 })]);
    expect(e.points).toBe(0);
  });

  it('counts a zero as scored', () => {
    const e = evaluateExam(parts, 0, [score('theorie-1', { points: 0 })]);
    expect(e.scored).toBe(1);
  });
});

describe('applyScore', () => {
  it('adds a row for a new item', () => {
    const next = applyScore([], 3, 'nage-1', 'left_points', 2);
    expect(next).toEqual([
      {
        candidate_id: 3,
        item_key: 'nage-1',
        left_points: 2,
        right_points: null,
        points: null,
        note: null
      }
    ]);
  });

  it('changes one column and keeps the others', () => {
    const before = [score('nage-1', { left_points: 2 })];
    const next = applyScore(before, 1, 'nage-1', 'right_points', 1);
    expect(next[0]).toMatchObject({ left_points: 2, right_points: 1 });
    expect(before[0].right_points).toBeNull();
  });

  it('keeps candidates apart', () => {
    const next = applyScore([score('nage-1', { left_points: 2 })], 2, 'nage-1', 'left_points', 0);
    expect(next).toHaveLength(2);
  });
});

describe('candidateState', () => {
  const base = { status: 'registered' as const, started_at: null, result: null };

  it('follows the candidate from registration to result', () => {
    expect(candidateState(base)).toBe('registered');
    expect(candidateState({ ...base, status: 'invited' })).toBe('invited');
    expect(candidateState({ ...base, status: 'invited', started_at: '2026-11-21' })).toBe(
      'grading'
    );
    expect(candidateState({ ...base, started_at: '2026-11-21', result: 'passed' })).toBe('passed');
    expect(candidateState({ ...base, status: 'withdrawn' })).toBe('withdrawn');
  });
});

describe('registrableGrades', () => {
  const def = (grade: string, gradeRank: number, isDan = false): GradeDefinition => ({
    section: 'Judo',
    grade,
    gradeRank,
    beltColor: '#000',
    isDan
  });
  const ladder = [def('5. Kyu', 3), def('6. Kyu', 1), def('5.5 Kyu', 2), def('1. Dan', 10, true)];

  it('offers the kyu grades above the current one, lowest first', () => {
    expect(registrableGrades(ladder, '5.5 Kyu').map((g) => g.grade)).toEqual(['5. Kyu']);
  });

  it('offers every kyu grade without a current one', () => {
    expect(registrableGrades(ladder).map((g) => g.grade)).toEqual(['6. Kyu', '5.5 Kyu', '5. Kyu']);
  });
});

const candidate = (
  id: number,
  lastname: string,
  extra: Partial<ExamCandidate> = {}
): ExamCandidate => ({
  id,
  exam_id: 1,
  member_id: id,
  section: 'Judo',
  grade: '5. Kyu',
  status: 'invited',
  program: null,
  min_points: null,
  started_at: null,
  result: null,
  total_points: null,
  max_points: null,
  completed_at: null,
  registered_at: '2026-10-01T10:00:00Z',
  member: { id, firstname: 'A', lastname },
  ...extra
});

describe('groupCandidates', () => {
  it('orders groups by call-up time and puts unassigned candidates last', () => {
    const groups = groupCandidates([
      candidate(1, 'Zuber'),
      candidate(2, 'Meier', { group_name: 'Erwachsene', call_time: '14:45' }),
      candidate(3, 'Albrecht', { group_name: 'Kinder Halbgelb', call_time: '08:30' }),
      candidate(4, 'Bauer', { group_name: 'Kinder Halbgelb', call_time: '08:30' })
    ]);
    expect(groups.map((g) => g.name)).toEqual(['Kinder Halbgelb', 'Erwachsene', null]);
    expect(groups[0].candidates.map((c) => c.member?.lastname)).toEqual(['Albrecht', 'Bauer']);
  });
});

describe('sheetGroups', () => {
  it('puts candidates of the same grade on one sheet', () => {
    const groups = sheetGroups([
      candidate(1, 'A'),
      candidate(2, 'B', { grade: '4. Kyu' }),
      candidate(3, 'C')
    ]);
    expect(groups.map((g) => g.map((c) => c.id))).toEqual([[1, 3], [2]]);
  });
});

describe('program editing', () => {
  it('finds a free item key', () => {
    expect(newItemKey({ key: 'nage' }, parts)).toBe('nage-3');
  });

  it('derives part keys from titles', () => {
    expect(newPartKey('Kansetsu-waza Hebel', parts)).toBe('kansetsu-waza-hebel');
    expect(newPartKey('Theorie', parts)).toBe('theorie-2');
    expect(newPartKey('Übergänge', parts)).toBe('ubergange');
  });

  it('accepts a sound program', () => {
    expect(programProblems(parts, 7)).toEqual([]);
  });

  it('reports what keeps a program from being saved', () => {
    expect(programProblems([], 0)).toEqual(['noParts']);
    const broken: ExamPart[] = [
      { key: 'a', title: ' ', minPoints: 9, items: [{ key: 'x', name: '', sides: 1 }] },
      { key: 'b', title: 'B', items: [{ key: 'x', name: 'Dup', sides: 2 }] },
      { key: 'c', title: 'C', items: [] }
    ];
    expect(programProblems(broken, 50).sort()).toEqual(
      [
        'emptyPartTitle',
        'partMinTooHigh',
        'emptyItemName',
        'duplicateKey',
        'emptyPart',
        'minTooHigh'
      ].sort()
    );
  });
});

describe('examinerName', () => {
  it('prefers the full name and falls back to the e-mail', () => {
    expect(examinerName({ full_name: 'Monika O.', email: 'm@example.com' })).toBe('Monika O.');
    expect(examinerName({ full_name: ' ', email: 'monika@example.com' })).toBe('monika');
  });
});
