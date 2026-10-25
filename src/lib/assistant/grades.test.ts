import { describe, expect, it } from 'vitest';
import type { GradeDefinition, MemberGrade } from '$lib/models';
import { gradesBySection } from '$lib/gradeUtils';
import {
  buildGradeWrites,
  checkHolder,
  formatPassDate,
  gradesByColour,
  gradesByNumber,
  initialInputs,
  initialSection,
  mapGrade,
  passNote,
  remapInputs,
  reviewGrades,
  summarizeGrades,
  writtenConflict,
  type GradeReviewContext,
  type GradeRowInput
} from './grades';
import type { GradeEntry, GradesProposal } from './types';

// The ladders as in grade_definitions (after the Q-Prüfungen rank shift)
const WHITE = '#f5f5f5';
const YELLOW = '#f4d03f';
const ORANGE = '#f0932b';
const GREEN = '#27ae60';
const BLACK = '#111111';
const judo: GradeDefinition[] = [
  ['6. Kyu', WHITE, null],
  ['5.5 Kyu', WHITE, YELLOW],
  ['5. Kyu', YELLOW, null],
  ['4.5 Kyu', YELLOW, ORANGE],
  ['4. Kyu', ORANGE, null],
  ['3.5 Kyu', ORANGE, GREEN],
  ['3. Kyu', GREEN, null],
  ['2. Kyu', '#2e86de', null],
  ['1. Kyu', '#7b4a2d', null],
  ['1. Dan', BLACK, null],
  ['2. Dan', BLACK, null],
  ['3. Dan', BLACK, null],
  ['4. Dan', BLACK, null],
  ['5. Dan', BLACK, null]
].map(([grade, beltColor, beltColor2], i) => ({
  section: 'Judo',
  grade: grade!,
  gradeRank: i + 1,
  beltColor: beltColor!,
  beltColor2,
  isDan: grade!.endsWith('Dan')
}));
const aikido: GradeDefinition[] = [
  ...['6. Kyu', '5. Kyu', '4. Kyu', '3. Kyu', '2. Kyu', '1. Kyu'].map((grade) => ({
    grade,
    beltColor: WHITE,
    isDan: false
  })),
  ...['1. Dan', '2. Dan', '3. Dan', '4. Dan', '5. Dan'].map((grade) => ({
    grade,
    beltColor: BLACK,
    isDan: true
  }))
].map((d, i) => ({ ...d, section: 'Aikido', gradeRank: i + 1, beltColor2: null }));
const definitions = [...judo, ...aikido];

function entry(values: Partial<GradeEntry>): GradeEntry {
  return {
    grade: '',
    gradeAsWritten: '',
    beltColor: '',
    date: '',
    examiner: '',
    confidence: 'high',
    remark: '',
    ...values
  };
}

const grades = (list: GradeDefinition[] | null) => list?.map((d) => d.grade) ?? null;

// Lena Müller, *2012-03-14, with two gradings on record
const history: MemberGrade[] = [
  { id: 101, memberId: 4711, section: 'Judo', grade: '6. Kyu', examDate: '2019-06-15', note: null },
  {
    id: 102,
    memberId: 4711,
    section: 'Judo',
    grade: '5.5 Kyu',
    examDate: '2020-01-18',
    note: 'Q-Prüfung'
  }
];

const ctx: GradeReviewContext = {
  section: 'Judo',
  ladder: judo,
  history,
  birthday: '2012-03-14',
  today: '2026-10-25'
};

function inputs(...rows: Partial<GradeRowInput>[]): GradeRowInput[] {
  return rows.map((r) => ({
    grade: '',
    examDate: '',
    note: 'Judo-Pass',
    skip: false,
    correct: false,
    ...r
  }));
}

describe('reading the grade', () => {
  it('understands the usual ways to write a kyu or dan', () => {
    expect(grades(gradesByNumber('5. Kyu', judo))).toEqual(['5. Kyu']);
    expect(grades(gradesByNumber('5 Kyu', judo))).toEqual(['5. Kyu']);
    expect(grades(gradesByNumber('5.Kyu (gelb)', judo))).toEqual(['5. Kyu']);
    expect(grades(gradesByNumber('5,5 Kyu', judo))).toEqual(['5.5 Kyu']);
    expect(grades(gradesByNumber('4½ Kyū', judo))).toEqual(['4.5 Kyu']);
    expect(grades(gradesByNumber('1. Dan', judo))).toEqual(['1. Dan']);
    expect(grades(gradesByNumber('Shodan', judo))).toEqual(['1. Dan']);
    expect(grades(gradesByNumber('Nidan', aikido))).toEqual(['2. Dan']);
    expect(grades(gradesByNumber('Sankyu', judo))).toEqual(['3. Kyu']);
    expect(grades(gradesByNumber('Ikkyu', aikido))).toEqual(['1. Kyu']);
  });

  it('does not take the year of a date for a grade', () => {
    expect(grades(gradesByNumber('12.06.2015 5. Kyu', judo))).toEqual(['5. Kyu']);
  });

  it('tells "no grade written" from "a grade the ladder lacks"', () => {
    expect(gradesByNumber('Gelbgurt', judo)).toBeNull();
    expect(gradesByNumber('6. Dan', judo)).toEqual([]);
    expect(gradesByNumber('5.5 Kyu', aikido)).toEqual([]);
  });

  it('reads belt colours, also in compounds and as half belts', () => {
    expect(grades(gradesByColour('Gelbgurt', judo))).toEqual(['5. Kyu']);
    expect(grades(gradesByColour('gelb', judo))).toEqual(['5. Kyu']);
    expect(grades(gradesByColour('weiss', judo))).toEqual(['6. Kyu']);
    expect(grades(gradesByColour('Weiß-Gelb', judo))).toEqual(['5.5 Kyu']);
    expect(grades(gradesByColour('Halbgelbgurt', judo))).toEqual(['5.5 Kyu']);
    expect(grades(gradesByColour('gelb/orange', judo))).toEqual(['4.5 Kyu']);
    expect(grades(gradesByColour('Halbgrün', judo))).toEqual(['3.5 Kyu']);
    expect(grades(gradesByColour('Grüngurt', judo))).toEqual(['3. Kyu']);
    expect(grades(gradesByColour('brown', judo))).toEqual(['1. Kyu']);
  });

  it('gives several rungs when a colour is not unique, none for unknown belts', () => {
    expect(gradesByColour('schwarz', judo)).toHaveLength(5);
    expect(gradesByColour('weiss', aikido)).toHaveLength(6);
    expect(gradesByColour('rot-weiss', judo)).toEqual([]);
    expect(gradesByColour('Stempel Judo Club', judo)).toBeNull();
  });

  it('maps an entry: the model grade first, then the number, then the colour', () => {
    expect(mapGrade(entry({ grade: '4. Kyu', gradeAsWritten: 'Orangegurt' }), judo)).toBe('4. Kyu');
    expect(mapGrade(entry({ gradeAsWritten: '5 Kyu' }), judo)).toBe('5. Kyu');
    expect(mapGrade(entry({ gradeAsWritten: 'Gelbgurt' }), judo)).toBe('5. Kyu');
    expect(mapGrade(entry({ beltColor: 'weiss-gelb' }), judo)).toBe('5.5 Kyu');
    expect(mapGrade(entry({ gradeAsWritten: 'Schwarzgurt', beltColor: 'schwarz' }), judo)).toBe('');
    expect(mapGrade(entry({ gradeAsWritten: '1. Dan', beltColor: 'schwarz' }), judo)).toBe(
      '1. Dan'
    );
    expect(mapGrade(entry({ gradeAsWritten: 'Kyu-Prüfung', beltColor: 'weiss' }), aikido)).toBe('');
    // A grade of the other section's ladder is read again
    expect(mapGrade(entry({ grade: '5.5 Kyu', gradeAsWritten: '5.5 Kyu' }), aikido)).toBe('');
    expect(mapGrade(entry({ gradeAsWritten: 'unleserlich' }), judo)).toBe('');
  });

  it('notices when the written grade or colour does not fit the chosen grade', () => {
    const e = entry({ grade: '5.5 Kyu', gradeAsWritten: 'Gelbgurt', beltColor: 'gelb' });
    expect(writtenConflict(e, judo, '5.5 Kyu')).toBe('Gelbgurt');
    expect(writtenConflict(e, judo, '5. Kyu')).toBeNull();
    expect(writtenConflict(entry({ gradeAsWritten: '4. Kyu' }), judo, '5. Kyu')).toBe('4. Kyu');
    expect(writtenConflict(entry({ beltColor: 'weiss' }), aikido, '3. Kyu')).toBeNull();
  });
});

describe('starting the review', () => {
  const ladders = gradesBySection(definitions);
  const proposal: GradesProposal = {
    section: '',
    holder: { name: 'Lena Müller', birthday: '2012-03-14' },
    entries: [
      entry({ gradeAsWritten: 'Gelbgurt', date: '2021-05-08', examiner: 'H. Keller' }),
      entry({ gradeAsWritten: '4.5 Kyu', date: '2022' })
    ],
    warnings: []
  };

  it('picks the section of the pass, else the member current one, else the first', () => {
    expect(initialSection({ ...proposal, section: 'Judo' }, ladders, [])).toBe('Judo');
    const current = [{ section: 'Aikido' } as never];
    expect(initialSection(proposal, ladders, current)).toBe('Aikido');
    expect(initialSection(proposal, ladders, [])).toBe([...ladders.keys()][0]);
  });

  it('prefills grade, full dates and a short note', () => {
    expect(initialInputs(proposal, 'Judo', judo)).toEqual([
      {
        grade: '5. Kyu',
        examDate: '2021-05-08',
        note: 'Judo-Pass · H. Keller',
        skip: false,
        correct: false
      },
      { grade: '4.5 Kyu', examDate: '', note: 'Judo-Pass', skip: false, correct: false }
    ]);
    expect(passNote('', '')).toBe('Pass');
    expect(passNote('Judo', 'x'.repeat(200))).toHaveLength(100);
  });

  it('reads the grades again for another section, keeping those it has', () => {
    // Aikido has a 5. Kyu (white) but no half belts
    const toAikido = { from: 'Judo', to: 'Aikido', ladder: aikido };
    const remapped = remapInputs(proposal.entries, initialInputs(proposal, 'Judo', judo), toAikido);
    expect(remapped.map((i) => i.grade)).toEqual(['5. Kyu', '']);
    // … and the yellow belt of the pass then shows up as not fitting
    expect(writtenConflict(proposal.entries[0], aikido, '5. Kyu')).toBe('Gelbgurt');
    const kept = remapInputs(
      [entry({ gradeAsWritten: '3. Kyu' })],
      inputs({ grade: '3. Kyu', correct: true }),
      toAikido
    );
    expect(kept[0]).toMatchObject({ grade: '3. Kyu', correct: false });
  });

  it('moves an untouched note to the new section, keeps one the user wrote', () => {
    const notes = [
      { ...initialInputs(proposal, 'Judo', judo)[0] },
      { ...initialInputs(proposal, 'Judo', judo)[1], note: 'Nachgetragen von R. Huber' }
    ];
    const remapped = remapInputs(proposal.entries, notes, {
      from: 'Judo',
      to: 'Aikido',
      ladder: aikido
    });
    expect(remapped.map((i) => i.note)).toEqual([
      'Aikido-Pass · H. Keller',
      'Nachgetragen von R. Huber'
    ]);
  });
});

describe('reviewing the rows', () => {
  it('marks new, recorded and differently dated grades', () => {
    const entries = [
      entry({ gradeAsWritten: 'Weissgurt', date: '2019-06-15' }),
      entry({ gradeAsWritten: 'Halbgelb', date: '2020-01-25' }),
      entry({ gradeAsWritten: 'Gelbgurt', date: '2021-05-08' })
    ];
    const rows = reviewGrades(
      entries,
      inputs(
        { grade: '6. Kyu', examDate: '2019-06-15' },
        { grade: '5.5 Kyu', examDate: '2020-01-25' },
        { grade: '5. Kyu', examDate: '2021-05-08' }
      ),
      ctx
    );
    expect(rows.map((r) => [r.status, r.action])).toEqual([
      ['exists', null],
      ['changed', null],
      ['new', 'insert']
    ]);
    expect(rows[1].existing?.id).toBe(102);
    expect(summarizeGrades(rows)).toMatchObject({ inserts: 1, updates: 0, blocking: 0 });
  });

  it('corrects a recorded date only when asked to', () => {
    const entries = [entry({ gradeAsWritten: 'Halbgelb', date: '2020-01-25' })];
    const rows = reviewGrades(
      entries,
      inputs({ grade: '5.5 Kyu', examDate: '2020-01-25', correct: true }),
      ctx
    );
    expect(rows[0]).toMatchObject({ status: 'changed', action: 'update', blocking: false });
  });

  it('needs a full date to correct one', () => {
    const rows = reviewGrades(
      [entry({ gradeAsWritten: 'Halbgelb', date: '2021' })],
      inputs({ grade: '5.5 Kyu', correct: true }),
      ctx
    );
    expect(rows[0]).toMatchObject({ status: 'changed', action: null, blocking: true });
    expect(rows[0].errors).toEqual([{ code: 'partialDate', written: '2021' }]);
  });

  it('takes a partial or missing date that fits the record as recorded', () => {
    const rows = reviewGrades(
      [entry({ gradeAsWritten: '6. Kyu', date: '2019-06' }), entry({ gradeAsWritten: '5.5 Kyu' })],
      inputs({ grade: '6. Kyu' }, { grade: '5.5 Kyu' }),
      ctx
    );
    expect(rows.map((r) => r.status)).toEqual(['exists', 'exists']);
  });

  it('keeps the first of two rows with the same grade', () => {
    const entries = [
      entry({ gradeAsWritten: '4. Kyu', date: '2022-11-19' }),
      entry({ gradeAsWritten: '4. Kyu', date: '2022-11-19' })
    ];
    const both = inputs(
      { grade: '4. Kyu', examDate: '2022-11-19' },
      { grade: '4. Kyu', examDate: '2022-11-19' }
    );
    const rows = reviewGrades(entries, both, ctx);
    expect(rows.map((r) => [r.status, r.duplicateOf, r.action])).toEqual([
      ['new', null, 'insert'],
      ['duplicate', 0, null]
    ]);
    // Leaving out the first makes the second count
    const second = reviewGrades(entries, [{ ...both[0], skip: true }, both[1]], ctx);
    expect(second.map((r) => [r.status, r.action])).toEqual([
      ['new', null],
      ['new', 'insert']
    ]);
  });

  it('blocks rows without a ladder grade or a full date until fixed or skipped', () => {
    const entries = [
      entry({ gradeAsWritten: 'Schwarzgurt', date: '2025-03-01' }),
      entry({ gradeAsWritten: '3. Kyu', date: '2023-06' }),
      entry({ gradeAsWritten: '2. Kyu' })
    ];
    const rows = reviewGrades(
      entries,
      inputs({ examDate: '2025-03-01' }, { grade: '3. Kyu' }, { grade: '2. Kyu' }),
      ctx
    );
    expect(rows.map((r) => r.status)).toEqual(['invalid', 'invalid', 'invalid']);
    expect(rows.map((r) => r.errors)).toEqual([
      [{ code: 'noGrade' }],
      [{ code: 'partialDate', written: '06.2023' }],
      [{ code: 'noDate' }]
    ]);
    expect(summarizeGrades(rows).blocking).toBe(3);

    const skipped = reviewGrades(
      entries,
      inputs(
        { skip: true },
        { grade: '3. Kyu', examDate: '2023-06-24' },
        { skip: true, grade: '2. Kyu' }
      ),
      ctx
    );
    expect(summarizeGrades(skipped)).toMatchObject({ inserts: 1, blocking: 0 });
  });

  it('refuses dates in the future and impossible dates', () => {
    const rows = reviewGrades(
      [entry({ gradeAsWritten: '4. Kyu' }), entry({ gradeAsWritten: '3.5 Kyu' })],
      inputs(
        { grade: '4. Kyu', examDate: '2026-11-07' },
        { grade: '3.5 Kyu', examDate: '2023-02-30' }
      ),
      ctx
    );
    expect(rows.map((r) => r.errors)).toEqual([[{ code: 'futureDate' }], [{ code: 'badDate' }]]);
    expect(rows.every((r) => r.action === null && r.blocking)).toBe(true);
  });

  it('warns about dates before the birthday and grades out of order', () => {
    const rows = reviewGrades(
      [
        entry({ gradeAsWritten: '5. Kyu', date: '2011-05-08' }),
        entry({ gradeAsWritten: '4. Kyu', date: '2019-03-02' })
      ],
      inputs(
        { grade: '5. Kyu', examDate: '2011-05-08' },
        { grade: '4. Kyu', examDate: '2019-03-02' }
      ),
      ctx
    );
    expect(rows[0].warnings).toEqual([
      { code: 'beforeBirthday', birthday: '14.03.2012' },
      { code: 'beforeLower', grade: '6. Kyu', date: '15.06.2019' }
    ]);
    // 4. Kyu before the recorded 6. Kyu (2019-06-15) and 5.5 Kyu (2020-01-18)
    expect(rows[1].warnings).toEqual([
      { code: 'beforeLower', grade: '6. Kyu', date: '15.06.2019' }
    ]);
  });

  it('warns when a lower grade comes after a higher one', () => {
    const rows = reviewGrades(
      [entry({ gradeAsWritten: '6. Kyu', date: '2020-03-07' })],
      inputs({ grade: '6. Kyu', examDate: '2020-03-07' }),
      { ...ctx, history: [history[1]] }
    );
    expect(rows[0].warnings).toEqual([
      { code: 'afterHigher', grade: '5.5 Kyu', date: '18.01.2020' }
    ]);
  });

  it('checks the order against the dates as they will be after saving', () => {
    const rows = reviewGrades(
      [
        entry({ gradeAsWritten: '6. Kyu', date: '2019-06-15' }),
        entry({ gradeAsWritten: '5. Kyu' })
      ],
      inputs(
        { grade: '6. Kyu', examDate: '2019-06-15' },
        { grade: '5. Kyu', examDate: '2019-12-07' }
      ),
      { ...ctx, history: [history[1]] }
    );
    expect(rows[0].warnings).toEqual([]);
    // 5. Kyu before the recorded, lower 5.5 Kyu
    expect(rows[1].warnings).toEqual([
      { code: 'beforeLower', grade: '5.5 Kyu', date: '18.01.2020' }
    ]);
  });

  it('flags a dan grade and a pass that says something else', () => {
    const rows = reviewGrades(
      [
        entry({ grade: '1. Dan', gradeAsWritten: 'Shodan', date: '2025-11-29' }),
        entry({
          grade: '2. Kyu',
          gradeAsWritten: 'Blaugurt',
          beltColor: 'braun',
          date: '2024-06-01'
        })
      ],
      inputs(
        { grade: '1. Dan', examDate: '2025-11-29' },
        { grade: '2. Kyu', examDate: '2024-06-01' }
      ),
      { ...ctx, history: [] }
    );
    expect(rows[0].warnings).toEqual([{ code: 'dan', badge: true }]);
    expect(rows[1].warnings).toEqual([{ code: 'mismatch', written: 'braun' }]);
  });

  it('flags only the dan that becomes the top grade, the badge only for the first dan', () => {
    const shodan: MemberGrade = {
      id: 201,
      memberId: 4711,
      section: 'Judo',
      grade: '1. Dan',
      examDate: '2018-11-24',
      note: null
    };
    const nidan: MemberGrade = { ...shodan, id: 202, grade: '2. Dan', examDate: '2022-12-03' };
    const entries = [entry({ gradeAsWritten: '2. Dan', date: '2022-12-03' })];
    const second = inputs({ grade: '2. Dan', examDate: '2022-12-03' });
    // 1. Dan on record: the 2. Dan becomes the belt, the badge is there already
    expect(reviewGrades(entries, second, { ...ctx, history: [shodan] })[0].warnings).toEqual([
      { code: 'dan', badge: false }
    ]);
    // 3. Dan on record: a 2. Dan changes neither
    const sandan = { ...nidan, id: 203, grade: '3. Dan', examDate: '2025-11-29' };
    expect(reviewGrades(entries, second, { ...ctx, history: [sandan] })[0].warnings).toEqual([]);
    // Two new dan rows: only the higher one becomes the belt
    const both = reviewGrades(
      [entry({ gradeAsWritten: '1. Dan' }), ...entries],
      inputs({ grade: '1. Dan', examDate: '2018-11-24' }, second[0]),
      { ...ctx, history: [] }
    );
    expect(both.map((r) => r.warnings)).toEqual([[], [{ code: 'dan', badge: true }]]);
  });
});

describe('the pass holder', () => {
  const lena = { firstname: 'Lena', lastname: 'Müller', birthday: '2012-03-14' };

  it('accepts the member name in any order and spelling', () => {
    expect(checkHolder({ name: 'MUELLER Lena', birthday: '2012-03-14' }, lena)).toMatchObject({
      nameFits: true,
      birthdayFits: true
    });
  });

  it('flags a sibling pass and another birthday', () => {
    expect(checkHolder({ name: 'Lukas Müller', birthday: '2014-08-02' }, lena)).toMatchObject({
      nameFits: false,
      birthdayFits: false
    });
  });

  it('has nothing to compare when the pass or the record lacks a value', () => {
    expect(checkHolder({ name: '', birthday: '' }, lena)).toMatchObject({
      nameFits: null,
      birthdayFits: null
    });
    expect(
      checkHolder({ name: 'Lena Müller', birthday: '2012-03-14' }, { ...lena, birthday: null })
    ).toMatchObject({ nameFits: true, birthdayFits: null });
  });
});

describe('what is written', () => {
  const entries = [
    entry({ gradeAsWritten: 'Halbgelb', date: '2020-01-25' }),
    entry({ gradeAsWritten: 'Gelbgurt', date: '2021-05-08' }),
    entry({ gradeAsWritten: 'Gelbgurt', date: '2021-05-08' }),
    entry({ gradeAsWritten: '4.5 Kyu' })
  ];
  const rowInputs = inputs(
    { grade: '5.5 Kyu', examDate: '2020-01-25', correct: true },
    { grade: '5. Kyu', examDate: '2021-05-08', note: '  Judo-Pass · H. Keller ' },
    { grade: '5. Kyu', examDate: '2021-05-08' },
    { grade: '4.5 Kyu', examDate: '', skip: true }
  );

  it('writes the whitelisted columns of new grades and corrects only opted-in dates', () => {
    const rows = reviewGrades(entries, rowInputs, ctx);
    const writes = buildGradeWrites(4711, rows, ctx);
    expect(writes.inserts).toEqual([
      {
        memberId: 4711,
        section: 'Judo',
        grade: '5. Kyu',
        examDate: '2021-05-08',
        note: 'Judo-Pass · H. Keller'
      }
    ]);
    expect(writes.corrections).toEqual([{ id: 102, examDate: '2020-01-25' }]);
    expect(Object.keys(writes.inserts[0]).sort()).toEqual(
      ['examDate', 'grade', 'memberId', 'note', 'section'].sort()
    );
  });

  it('writes an empty note as null', () => {
    const rows = reviewGrades(
      [entries[1]],
      inputs({ grade: '5. Kyu', examDate: '2021-05-08', note: ' ' }),
      ctx
    );
    expect(buildGradeWrites(4711, rows, ctx).inserts[0].note).toBeNull();
  });

  it('checks every row again before writing', () => {
    const rows = reviewGrades(entries, rowInputs, ctx);
    // Tampered rows: another section's grade, a future date, a foreign record
    // and a new row for a grade that is on record already
    const tampered = [
      { ...rows[1], definition: aikido[3] },
      { ...rows[1], input: { ...rows[1].input, examDate: '2027-01-01' } },
      { ...rows[0], existing: { ...history[1], id: 999 } },
      { ...rows[1], definition: judo[0] }
    ];
    expect(buildGradeWrites(4711, tampered, ctx)).toEqual({ inserts: [], corrections: [] });
    expect(buildGradeWrites(0, rows, ctx)).toEqual({ inserts: [], corrections: [] });
    expect(buildGradeWrites(4712, rows, ctx).corrections).toEqual([]);
  });
});

describe('formatPassDate', () => {
  it('shows full and partial dates the Swiss way', () => {
    expect(formatPassDate('2021-05-08')).toBe('08.05.2021');
    expect(formatPassDate('2021-05')).toBe('05.2021');
    expect(formatPassDate('2021')).toBe('2021');
  });
});
