import { describe, expect, it } from 'vitest';
import type { PlanRow } from './trainingPlanUtils';
import {
  acceptedOnRow,
  canHandOver,
  mailRecipient,
  openRequestsBySlot,
  renderRequestMail,
  requestErrorCode,
  requestOnRow,
  requestStillValid,
  swapCandidates,
  swapResult,
  type PlanRequest,
  type RequestMailData
} from './trainingPlanRequests';

const TODAY = '2026-11-02';
const MONDAY = { id: 1, title: 'Randori', weekday: 'Monday', dateFrom: '18:30', section: 'Judo' };
const WEDNESDAY = {
  id: 2,
  title: 'Technik',
  weekday: 'Wednesday',
  dateFrom: '19:00',
  section: 'Judo'
};

function row(training: typeof MONDAY, date: string, trainerId: number | null, cancelled = false) {
  return { training, date, trainerId, cancelled } as unknown as PlanRow;
}

function request(over: Partial<PlanRequest> = {}): PlanRequest {
  return {
    id: 1,
    kind: 'substitute',
    training_id: 1,
    date: '2026-11-16',
    other_training_id: null,
    other_date: null,
    from_member_id: 10,
    to_member_id: 20,
    message: null,
    move_note: true,
    other_move_note: true,
    status: 'open',
    created_at: '2026-11-02T10:00:00Z',
    answered_at: null,
    ...over
  };
}

const SWAP = request({ kind: 'swap', other_training_id: 2, other_date: '2026-11-25' });

describe('requestErrorCode', () => {
  it('maps the database messages, anything else is failed', () => {
    expect(requestErrorCode('NOT_YOUR_DATE')).toBe('not_your_date');
    expect(requestErrorCode('BUSY')).toBe('busy');
    expect(requestErrorCode('duplicate key value')).toBe('failed');
    expect(requestErrorCode(null)).toBe('failed');
  });
});

describe('open requests on the rows', () => {
  it('a swap holds both dates, closed requests none', () => {
    const map = openRequestsBySlot([
      SWAP,
      request({ id: 2, date: '2026-11-23', status: 'declined' })
    ]);
    expect(requestOnRow(row(MONDAY, '2026-11-16', 10), map)).toBe(SWAP);
    expect(requestOnRow(row(WEDNESDAY, '2026-11-25', 20), map)).toBe(SWAP);
    expect(requestOnRow(row(MONDAY, '2026-11-23', 10), map)).toBeNull();
  });
});

describe('requestStillValid', () => {
  const rows = [row(MONDAY, '2026-11-16', 10), row(WEDNESDAY, '2026-11-25', 20)];

  it('holds while both still lead their held dates', () => {
    expect(requestStillValid(request(), rows, TODAY)).toBe(true);
    expect(requestStillValid(SWAP, rows, TODAY)).toBe(true);
  });

  it('not once a trainer changed, a date is cancelled or past', () => {
    expect(requestStillValid(request(), [row(MONDAY, '2026-11-16', 30)], TODAY)).toBe(false);
    expect(requestStillValid(request(), [row(MONDAY, '2026-11-16', 10, true)], TODAY)).toBe(false);
    expect(requestStillValid(request(), rows, '2026-11-17')).toBe(false);
    expect(requestStillValid(SWAP, [rows[0], row(WEDNESDAY, '2026-11-25', 30)], TODAY)).toBe(false);
    expect(requestStillValid(SWAP, [rows[0]], TODAY)).toBe(false);
  });
});

describe('canHandOver and swapCandidates', () => {
  const mine = new Set([10]);

  it('only the account’s own held dates from today on', () => {
    expect(canHandOver(row(MONDAY, '2026-11-16', 10), mine, TODAY)).toBe(true);
    expect(canHandOver(row(MONDAY, '2026-10-26', 10), mine, TODAY)).toBe(false);
    expect(canHandOver(row(MONDAY, '2026-11-16', 10, true), mine, TODAY)).toBe(false);
    expect(canHandOver(row(MONDAY, '2026-11-16', 20), mine, TODAY)).toBe(false);
    expect(canHandOver(row(MONDAY, '2026-11-16', null), mine, TODAY)).toBe(false);
  });

  it('offers the other person’s upcoming held dates that are free', () => {
    const rows = [
      row(WEDNESDAY, '2026-10-28', 20),
      row(WEDNESDAY, '2026-11-04', 20),
      row(WEDNESDAY, '2026-11-11', 20, true),
      row(WEDNESDAY, '2026-11-18', 20),
      row(MONDAY, '2026-11-23', 30)
    ];
    expect(
      swapCandidates(rows, 20, TODAY, (r) => r.date === '2026-11-18').map((r) => r.date)
    ).toEqual(['2026-11-04']);
  });
});

describe('swapResult', () => {
  const a = { topic: 'Uchi-mata', notes: 'Annas Notiz' };
  const b = { topic: 'Kansetsu', notes: ' Max Notiz ' };

  it('the topics trade places, the notes as chosen', () => {
    expect(swapResult(a, b, true, true)).toEqual({
      a: { topic: 'Kansetsu', notes: 'Max Notiz' },
      b: { topic: 'Uchi-mata', notes: 'Annas Notiz' }
    });
    expect(swapResult(a, b, true, false)).toEqual({
      a: { topic: 'Kansetsu', notes: null },
      b: { topic: 'Uchi-mata', notes: 'Max Notiz · Annas Notiz' }
    });
    expect(swapResult(a, { topic: null, notes: null }, false, true)).toEqual({
      a: { topic: null, notes: 'Annas Notiz' },
      b: { topic: 'Uchi-mata', notes: null }
    });
  });
});

describe('acceptedOnRow', () => {
  const accepted = request({ status: 'accepted', answered_at: '2026-11-03T08:00:00Z' });
  const swapped = {
    ...SWAP,
    id: 3,
    status: 'accepted' as const,
    answered_at: '2026-11-04T08:00:00Z'
  };

  it('a substitute stands in while the plan still shows them', () => {
    expect(acceptedOnRow(row(MONDAY, '2026-11-16', 20), [accepted])).toEqual({
      kind: 'substitute',
      for: 10
    });
    expect(acceptedOnRow(row(MONDAY, '2026-11-16', 30), [accepted])).toBeNull();
  });

  it('a swap shows on both dates, the newest request wins', () => {
    expect(acceptedOnRow(row(MONDAY, '2026-11-16', 20), [accepted, swapped])).toEqual({
      kind: 'swap',
      with: 10
    });
    expect(acceptedOnRow(row(WEDNESDAY, '2026-11-25', 10), [swapped])).toEqual({
      kind: 'swap',
      with: 20
    });
    expect(acceptedOnRow(row(WEDNESDAY, '2026-11-25', 20), [swapped])).toBeNull();
  });
});

describe('renderRequestMail', () => {
  const person = (id: number, name: string, firstname: string) => ({
    id,
    name,
    firstname,
    email: `${firstname.toLowerCase()}@test.ch`,
    optout: false
  });
  const data: RequestMailData = {
    id: 7,
    kind: 'substitute',
    status: 'open',
    message: 'Matten liegen bereit',
    from: person(10, 'Anna Muster', 'Anna'),
    to: person(20, 'Max Meier', 'Max'),
    date: {
      training_id: 1,
      date: '2026-11-16',
      title: 'Randori',
      weekday: 'Monday',
      time_from: '18:30',
      time_to: '20:00',
      topic: 'Uchi-mata'
    },
    other_date: null
  };
  const ctx = { locale: 'de' as const, clubName: 'JAC', origin: 'https://app.test/' };

  it('asks the person asked, with date, topic, message and the link', () => {
    expect(mailRecipient('asked', data)).toBe(data.to);
    const mail = renderRequestMail('asked', data, ctx);
    expect(mail.subject).toBe('JAC – Vertretung gesucht: Mo 16.11.2026');
    expect(mail.text).toBe(
      [
        'Hallo Max',
        'Anna Muster fragt dich, ob du dieses Training übernehmen kannst:\n- Mo 16.11.2026, Randori, 18:30–20:00\n- Thema: Uchi-mata',
        'Nachricht: Matten liegen bereit',
        'Bitte sag in der App zu oder ab: https://app.test/dashboard/training-plan\nDer Plan ändert sich erst, wenn du zusagst.',
        'JAC'
      ].join('\n\n') + '\n'
    );
  });

  it('a swap names both dates with the topic each brings', () => {
    const swap: RequestMailData = {
      ...data,
      kind: 'swap',
      message: null,
      other_date: {
        training_id: 2,
        date: '2026-11-25',
        title: 'Technik',
        weekday: 'Wednesday',
        time_from: '19:00',
        time_to: null,
        topic: 'Kansetsu'
      }
    };
    const mail = renderRequestMail('asked', swap, { ...ctx, locale: 'en' });
    expect(mail.subject).toBe('JAC – Swap request: Mon 16 Nov 2026');
    expect(mail.text).toContain(
      '- You lead: Mon 16 Nov 2026, Randori, 18:30–20:00, with your topic (Kansetsu)\n' +
        '- Anna Muster leads: Wed 25 Nov 2026, Technik, 19:00, with their own topic (Uchi-mata)'
    );
    expect(renderRequestMail('accepted', swap, ctx).text).toContain(
      'Max Meier hat den Tausch bestätigt. Du leitest neu am Mi 25.11.2026, Max Meier am Mo 16.11.2026.'
    );
  });

  it('answers go to the asker, a withdrawal to the person asked', () => {
    expect(mailRecipient('accepted', data)).toBe(data.from);
    expect(mailRecipient('declined', data)).toBe(data.from);
    expect(mailRecipient('withdrawn', data)).toBe(data.to);
    expect(
      renderRequestMail('declined', data, ctx).text.startsWith('Hallo Anna\n\nMax Meier kann')
    ).toBe(true);
    expect(renderRequestMail('withdrawn', data, ctx).subject).toBe(
      'JAC – Anfrage zurückgezogen: Mo 16.11.2026'
    );
  });
});
