import { describe, expect, it } from 'vitest';
import type { LessonPlan } from '$lib/models';
import {
  CONTENT_MAX,
  buildLessonPlanWrite,
  defaultTitle,
  initialInput,
  lessonPlanLines,
  lessonPlanTarget,
  normalizeContent,
  proposalToContent,
  reviewLessonPlan,
  sameTarget,
  toExistingPlan,
  type ExistingLessonPlan,
  type LessonPlanInput,
  type LessonPlanReviewContext
} from './lessonPlan';
import type { LessonPlanProposal } from './types';

// A trainer's handwritten plan as the model reads it
const proposal: LessonPlanProposal = {
  date: '2026-11-02',
  title: 'Fallschule und O-soto-gari',
  sections: [
    { heading: 'Aufwärmen', items: ['Einlaufen, 5 Min.', 'Rollen vorwärts und rückwärts'] },
    {
      heading: 'Hauptteil',
      items: ['O-soto-gari im Stand', 'O-soto-gari aus der Bewegung', 'Randori 3 × 2 Min.']
    },
    { heading: 'Ausklang', items: ['Dehnen', 'Angrüssen'] }
  ],
  warnings: []
};

const CONTENT = [
  '## Aufwärmen',
  '- Einlaufen, 5 Min.',
  '- Rollen vorwärts und rückwärts',
  '',
  '## Hauptteil',
  '- O-soto-gari im Stand',
  '- O-soto-gari aus der Bewegung',
  '- Randori 3 × 2 Min.',
  '',
  '## Ausklang',
  '- Dehnen',
  '- Angrüssen'
].join('\n');

const textPlan: ExistingLessonPlan = {
  id: '6f1c2a54-9a1e-4d8b-8f3e-2b7d0c9a1e11',
  title: 'Bodenarbeit',
  content: '## Aufwärmen\n- Krebsfangis\n\n## Hauptteil\n- Kesa-gatame\n- Befreiungen\n',
  fileName: null,
  filePath: null,
  updatedAt: '2026-10-28T19:42:07.123456+00:00'
};

const filePlan: ExistingLessonPlan = {
  id: '0b9d7e3c-5f42-4a6e-9c1d-7e8f2a3b4c55',
  title: 'Kata-Training',
  content: '',
  fileName: 'Lektion Nage-no-kata.pdf',
  filePath: '28/2026-11-02/1761680527000.pdf',
  updatedAt: '2026-10-28T19:42:07.123456+00:00'
};

const context = (existing: ExistingLessonPlan | null = null): LessonPlanReviewContext => ({
  trainingId: 28,
  date: '2026-11-02',
  existing
});

function input(values: Partial<LessonPlanInput> = {}): LessonPlanInput {
  return { ...initialInput(proposal, null), ...values };
}

describe('text format', () => {
  it('writes the proposal like the default template', () => {
    expect(proposalToContent(proposal)).toBe(CONTENT);
  });

  it('drops bullet signs, heading marks and colons the model kept', () => {
    expect(
      proposalToContent({
        sections: [
          { heading: '## Aufwärmen:', items: ['- Seilspringen', '• Hampelmann', '* Liegestütze'] },
          { heading: 'Spiele', items: ['–', '  ', 'Schwänzchenfangis'] }
        ]
      })
    ).toBe(
      '## Aufwärmen\n- Seilspringen\n- Hampelmann\n- Liegestütze\n\n## Spiele\n- Schwänzchenfangis'
    );
  });

  it('keeps parts without heading or without items', () => {
    expect(
      proposalToContent({
        sections: [
          { heading: '', items: ['Matten auslegen'] },
          { heading: 'Notizen', items: [] },
          { heading: '', items: [] }
        ]
      })
    ).toBe('- Matten auslegen\n\n## Notizen');
    expect(proposalToContent({ sections: [] })).toBe('');
  });

  it('keeps numbered items and text that only looks like markup', () => {
    expect(
      proposalToContent({
        sections: [{ heading: 'Hauptteil', items: ['1. Uchi-mata', '#2 Tai-otoshi'] }]
      })
    ).toBe('## Hauptteil\n- 1. Uchi-mata\n- #2 Tai-otoshi');
  });

  it('normalizes like the editor saves', () => {
    expect(normalizeContent('\r\n## Aufwärmen\r\n- Einlaufen\r\n\n')).toBe(
      '## Aufwärmen\n- Einlaufen'
    );
  });

  it('splits the text into the lines the card shows', () => {
    expect(
      lessonPlanLines(
        '# Lektion 12\n## Aufwärmen\n### Spiele\n- Fangis\nMatten bereit\n-ohne Abstand'
      )
    ).toEqual([
      { kind: 'h1', text: 'Lektion 12' },
      { kind: 'h2', text: 'Aufwärmen' },
      { kind: 'h3', text: 'Spiele' },
      { kind: 'item', text: 'Fangis' },
      { kind: 'text', text: 'Matten bereit' },
      { kind: 'text', text: '-ohne Abstand' }
    ]);
  });
});

describe('target and saved plan', () => {
  it('accepts only a real training id and date', () => {
    expect(lessonPlanTarget('28', '2026-11-02')).toEqual({ trainingId: 28, date: '2026-11-02' });
    expect(lessonPlanTarget(28, '2026-11-02')).toEqual({ trainingId: 28, date: '2026-11-02' });
    expect(lessonPlanTarget('28', '2026-02-30')).toBeNull();
    expect(lessonPlanTarget('28', '02.11.2026')).toBeNull();
    expect(lessonPlanTarget('', '2026-11-02')).toBeNull();
    expect(lessonPlanTarget('0', '2026-11-02')).toBeNull();
    expect(lessonPlanTarget('2.5', '2026-11-02')).toBeNull();
    expect(lessonPlanTarget('1e3', '2026-11-02')).toBeNull();
    expect(lessonPlanTarget('40000', '2026-11-02')).toBeNull();
  });

  it('tells whether a plan belongs to the training and date', () => {
    const target = { trainingId: 28, date: '2026-11-02' };
    const loaded: LessonPlan = {
      id: textPlan.id,
      trainingId: 28,
      date: '2026-11-02',
      createdAt: '2026-10-28T19:42:07.123456+00:00',
      updatedAt: '2026-10-28T19:42:07.123456+00:00'
    };
    expect(sameTarget(loaded, target)).toBe(true);
    expect(sameTarget(target, lessonPlanTarget('28', '2026-11-02'))).toBe(true);
    // Still the plan of last Monday's training while the new date loads
    expect(sameTarget({ ...loaded, date: '2026-10-26' }, target)).toBe(false);
    expect(sameTarget({ ...loaded, trainingId: 30 }, target)).toBe(false);
    expect(sameTarget(null, target)).toBe(false);
    expect(sameTarget(target, null)).toBe(false);
  });

  it('maps the loaded plan', () => {
    const plan: LessonPlan = {
      id: filePlan.id,
      trainingId: 28,
      date: '2026-11-02',
      title: '',
      content: '',
      fileName: 'Lektion Nage-no-kata.pdf',
      filePath: '28/2026-11-02/1761680527000.pdf',
      fileType: 'application/pdf',
      fileSize: 48213,
      createdAt: '2026-10-28T19:42:07.123456+00:00',
      updatedAt: '2026-10-28T19:42:07.123456+00:00'
    };
    expect(toExistingPlan(plan)).toEqual({ ...filePlan, title: '' });
    expect(toExistingPlan(null)).toBeNull();
  });

  it('picks the title per mode', () => {
    expect(defaultTitle('replace', proposal, textPlan)).toBe('Fallschule und O-soto-gari');
    expect(defaultTitle('replace', { title: '' }, textPlan)).toBe('Bodenarbeit');
    expect(defaultTitle('append', proposal, textPlan)).toBe('Bodenarbeit');
    expect(defaultTitle('append', proposal, { ...textPlan, title: '' })).toBe(
      'Fallschule und O-soto-gari'
    );
    expect(defaultTitle('replace', { title: '' }, null)).toBe('');
  });
});

describe('review', () => {
  it('offers a new plan for an empty date', () => {
    const review = reviewLessonPlan(proposal, input(), context());
    expect(review).toEqual({
      status: 'new',
      mode: 'replace',
      title: 'Fallschule und O-soto-gari',
      content: CONTENT,
      writtenDate: null,
      previousTitle: null,
      replacesFile: false,
      errors: [],
      ready: true
    });
  });

  it('replaces a saved text plan by default and names the old title', () => {
    const start = initialInput(proposal, textPlan);
    expect(start.mode).toBe('replace');
    const review = reviewLessonPlan(proposal, start, context(textPlan));
    expect(review.status).toBe('changed');
    expect(review.content).toBe(CONTENT);
    expect(review.previousTitle).toBe('Bodenarbeit');
    expect(review.ready).toBe(true);
  });

  it('appends below the saved text', () => {
    const review = reviewLessonPlan(
      proposal,
      input({ mode: 'append', title: 'Bodenarbeit' }),
      context(textPlan)
    );
    expect(review.status).toBe('changed');
    expect(review.content).toBe(
      `## Aufwärmen\n- Krebsfangis\n\n## Hauptteil\n- Kesa-gatame\n- Befreiungen\n\n${CONTENT}`
    );
    expect(review.previousTitle).toBeNull();
    expect(review.ready).toBe(true);
  });

  it('writes nothing when the plan is saved exactly like this', () => {
    const saved = { ...textPlan, title: 'Fallschule und O-soto-gari', content: `${CONTENT}\n` };
    const review = reviewLessonPlan(proposal, input(), context(saved));
    expect(review.status).toBe('exists');
    expect(review.ready).toBe(false);
    // Another title is a change
    expect(reviewLessonPlan(proposal, input({ title: 'Fallschule' }), context(saved)).status).toBe(
      'changed'
    );
  });

  it('does not append the same text twice', () => {
    const twice = { ...textPlan, content: `${textPlan.content}\n${CONTENT}` };
    const review = reviewLessonPlan(proposal, input({ mode: 'append' }), context(twice));
    expect(review.status).toBe('duplicate');
    expect(review.ready).toBe(false);
    // A line that only starts like one of the saved lines is new
    const partly = reviewLessonPlan(
      proposal,
      input({ mode: 'append', content: '- Kesa' }),
      context(textPlan)
    );
    expect(partly.status).toBe('changed');
  });

  it('asks before a saved file is replaced, and only for that file', () => {
    const blocked = reviewLessonPlan(proposal, input({ mode: 'append' }), context(filePlan));
    // There is no text to append to
    expect(blocked.mode).toBe('replace');
    expect(blocked.status).toBe('changed');
    expect(blocked.replacesFile).toBe(true);
    expect(blocked.errors).toEqual(['fileNotConfirmed']);
    expect(blocked.ready).toBe(false);

    const confirmed = reviewLessonPlan(
      proposal,
      input({ replaceFile: filePlan.filePath }),
      context(filePlan)
    );
    expect(confirmed.errors).toEqual([]);
    expect(confirmed.ready).toBe(true);
    expect(confirmed.content).toBe(CONTENT);

    // Another file was uploaded meanwhile: the tick no longer counts
    const swapped = { ...filePlan, filePath: '28/2026-11-02/1761689999000.jpg' };
    expect(
      reviewLessonPlan(proposal, input({ replaceFile: filePlan.filePath }), context(swapped)).errors
    ).toEqual(['fileNotConfirmed']);
  });

  it('asks before saving for another date than the document names', () => {
    const other = { ...proposal, date: '2026-10-26' };
    const review = reviewLessonPlan(other, input(), context());
    expect(review.writtenDate).toBe('2026-10-26');
    expect(review.status).toBe('new');
    expect(review.errors).toEqual(['dateNotConfirmed']);
    expect(review.ready).toBe(false);
    expect(reviewLessonPlan(other, input({ otherDate: true }), context()).ready).toBe(true);
    // No date on the document: nothing to confirm
    expect(reviewLessonPlan({ ...proposal, date: '' }, input(), context()).writtenDate).toBeNull();
  });

  it('blocks an empty or overlong plan', () => {
    const empty = reviewLessonPlan(proposal, input({ content: '  \n ' }), context(textPlan));
    expect(empty.status).toBe('invalid');
    expect(empty.errors).toEqual(['empty']);
    expect(empty.ready).toBe(false);
    // Appending nothing is no change either
    expect(
      reviewLessonPlan(proposal, input({ mode: 'append', content: '' }), context(textPlan)).status
    ).toBe('invalid');

    const long = reviewLessonPlan(
      proposal,
      input({ content: `- ${'Uchi-mata '.repeat(CONTENT_MAX / 10)}` }),
      context()
    );
    expect(long.errors).toEqual(['tooLong']);
    expect(long.ready).toBe(false);
  });

  it('blocks a page without a valid training or date', () => {
    const review = reviewLessonPlan(proposal, input(), { ...context(), date: '2026-13-01' });
    expect(review.status).toBe('invalid');
    expect(review.errors).toContain('target');
    expect(reviewLessonPlan(proposal, input(), { ...context(), trainingId: 0 }).ready).toBe(false);
  });

  it('cleans the title and the content', () => {
    const review = reviewLessonPlan(
      proposal,
      input({ title: '  =Fallschule   und  Rollen ', content: '\r\n- Rolle vorwärts\r\n' }),
      context()
    );
    expect(review.title).toBe('Fallschule und Rollen');
    expect(review.content).toBe('- Rolle vorwärts');
  });
});

describe('write', () => {
  const user = '3d1f8a2e-7b6c-4e5d-9a8b-1c2d3e4f5a6b';

  it('inserts a new plan with the editor columns', () => {
    expect(buildLessonPlanWrite(proposal, input(), context(), user)).toEqual({
      action: 'insert',
      row: {
        trainingId: 28,
        date: '2026-11-02',
        title: 'Fallschule und O-soto-gari',
        content: CONTENT,
        created_by: user
      }
    });
    // Without a title or a known user, like the editor
    const write = buildLessonPlanWrite(proposal, input({ title: ' ' }), context(), null);
    expect(write).toEqual({
      action: 'insert',
      row: { trainingId: 28, date: '2026-11-02', title: null, content: CONTENT }
    });
  });

  it('updates the reviewed row only and clears the file columns', () => {
    expect(
      buildLessonPlanWrite(proposal, input({ mode: 'append' }), context(textPlan), user)
    ).toEqual({
      action: 'update',
      match: {
        id: textPlan.id,
        trainingId: 28,
        date: '2026-11-02',
        updatedAt: textPlan.updatedAt,
        filePath: null
      },
      row: {
        title: 'Fallschule und O-soto-gari',
        content: `${normalizeContent(textPlan.content)}\n\n${CONTENT}`,
        file_name: null,
        file_path: null,
        file_type: null,
        file_size: null
      },
      removeFile: null
    });
  });

  it('removes a replaced file only after it was confirmed', () => {
    expect(buildLessonPlanWrite(proposal, input(), context(filePlan), user)).toBeNull();
    const write = buildLessonPlanWrite(
      proposal,
      input({ replaceFile: filePlan.filePath }),
      context(filePlan),
      user
    );
    expect(write?.action).toBe('update');
    if (write?.action !== 'update') return;
    expect(write.match.filePath).toBe(filePlan.filePath);
    expect(write.removeFile).toBe(filePlan.filePath);
    expect(write.row.content).toBe(CONTENT);
  });

  it('writes nothing that is not ready', () => {
    const saved = { ...textPlan, title: 'Fallschule und O-soto-gari', content: CONTENT };
    expect(buildLessonPlanWrite(proposal, input(), context(saved), user)).toBeNull();
    expect(buildLessonPlanWrite(proposal, input({ content: '' }), context(), user)).toBeNull();
    expect(
      buildLessonPlanWrite({ ...proposal, date: '2026-10-26' }, input(), context(), user)
    ).toBeNull();
    expect(
      buildLessonPlanWrite(proposal, input(), { ...context(), trainingId: 0 }, user)
    ).toBeNull();
  });
});
