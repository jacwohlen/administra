import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, type FeedTraining } from '$lib/calendarFeed';
import type { TrainingPlanSession } from '$lib/models';
import {
  MAIL_DAYS_AHEAD,
  computeNotices,
  fingerprint,
  type MailPlanData,
  type MailScope,
  type MemberNotice
} from '$lib/trainingPlanMail';
import { renderMail } from '$lib/trainingPlanMailText';

const sendMail = vi.fn();
const planMailMode = vi.fn(() => 'smtp');
vi.mock('$lib/server/mailer', () => ({ sendMail, planMailMode }));
vi.mock('$lib/server/trialMailContext', () => ({
  loadMailSettings: vi.fn(async () => ({
    club: { name: 'Testclub', contactEmail: 'club@test.ch' },
    values: {}
  }))
}));
const loadMailScope = vi.fn();
const loadMailPlan = vi.fn();
vi.mock('$lib/trainingPlanMailData', () => ({ loadMailScope, loadMailPlan }));

const { GET, POST } = await import('./+server');

const TODAY = '2026-11-02';
const TK: MailScope = { all: true, trainingIds: [] };
const monday = (week: number) => addDays(TODAY, 7 * week);

const training: FeedTraining = {
  id: 1,
  title: 'Judo Montag',
  weekday: 'Monday',
  dateFrom: '18:00',
  dateTo: '19:30',
  section: 'Judo',
  mainTrainerId: 10
};

const session = (week: number, trainerId: number): TrainingPlanSession => ({
  id: week,
  training_id: 1,
  date: monday(week),
  trainer_id: trainerId,
  topic: null,
  notes: null,
  cancelled: null,
  updated_at: ''
});

// 10 main trainer; 20 and 30 a family; 40 a test address, 50 opted out,
// 60 without an address; 70 the sender's own member
const DATA: MailPlanData = {
  today: TODAY,
  to: addDays(TODAY, MAIL_DAYS_AHEAD),
  trainings: [training],
  sessions: [
    session(1, 20),
    session(2, 30),
    session(3, 40),
    session(4, 50),
    session(5, 60),
    session(6, 70)
  ],
  breaks: [],
  toldTrainings: [],
  toldDates: [],
  optOuts: [50],
  ownMemberIds: [70],
  members: [
    { id: 10, firstname: 'Max', lastname: 'Muster' },
    { id: 20, firstname: 'Anna', lastname: 'Aebi' },
    { id: 30, firstname: 'Ben', lastname: 'Aebi' },
    { id: 40, firstname: 'Tom', lastname: 'Test' },
    { id: 50, firstname: 'Eva', lastname: 'Zaugg' },
    { id: 60, firstname: 'Nina', lastname: 'Ohne' },
    { id: 70, firstname: 'Tina', lastname: 'Planer' }
  ],
  addresses: [
    { member_id: 10, email: 'max@test.ch', source: 'account' },
    { member_id: 20, email: 'familie@test.ch', source: 'member' },
    { member_id: 30, email: ' Familie@Test.ch ', source: 'member' },
    { member_id: 40, email: 'member-40@example.invalid', source: 'member' },
    { member_id: 50, email: 'eva@test.ch', source: 'member' },
    { member_id: 60, email: null, source: null },
    { member_id: 70, email: 'tina@test.ch', source: 'account' }
  ],
  pendingMails: []
};

const SET = computeNotices(DATA, TK);
const notice = (id: number) => SET.members.find((m) => m.memberId === id) as MemberNotice;
const own = SET.own.find((m) => m.memberId === 70) as MemberNotice;
const family = [notice(20), notice(30)];

interface Db {
  insertError?: { code: string } | null;
  updateError?: { code: string } | null;
  toldError?: { code: string } | null;
  session?: boolean;
}

function fakeLocals(db: Db = {}) {
  const inserts: Record<string, unknown>[][] = [];
  const updates: { patch: Record<string, unknown>; ids: number[] }[] = [];
  const rpc = vi.fn(async (fn: string) =>
    fn === 'training_plan_set_told'
      ? { data: db.toldError ? null : 1, error: db.toldError ?? null }
      : { data: null, error: { code: 'XX000' } }
  );
  const from = (table: string) => {
    if (table === 'user_profiles') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { full_name: ' Tina Planer ' }, error: null })
          })
        })
      };
    }
    if (table === 'training_plan_mails') {
      return {
        insert: (rows: Record<string, unknown>[]) => {
          inserts.push(rows);
          const error = db.insertError ?? null;
          return {
            select: async () => ({
              data: error ? null : rows.map((_, i) => ({ id: i + 1 })),
              error
            }),
            then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error }).then(resolve)
          };
        },
        update: (patch: Record<string, unknown>) => ({
          in: async (_column: string, ids: number[]) => {
            updates.push({ patch, ids });
            return { error: db.updateError ?? null };
          }
        })
      };
    }
    throw new Error(`unexpected table ${table}`);
  };
  const signedIn = db.session !== false;
  return {
    inserts,
    updates,
    rpc,
    locals: {
      safeGetSession: async () =>
        signedIn
          ? { session: { user: {} }, user: { id: 'u-1', email: 'tk@test.ch' } }
          : { session: null, user: null },
      supabase: { rpc, from }
    }
  };
}

type Fake = ReturnType<typeof fakeLocals>;

async function post(body: unknown, fake: Fake, contentType = 'application/json') {
  const request = new Request('http://localhost/api/training-plan/notify', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
  const response = await POST({
    request,
    locals: fake.locals,
    url: new URL(request.url)
  } as unknown as Parameters<typeof POST>[0]);
  return { status: response.status, body: await response.json() };
}

function sendBody(members: MemberNotice[], key: string | null, over: object = {}) {
  return {
    action: 'send',
    memberIds: members.map((m) => m.memberId),
    fingerprint: fingerprint(members, key),
    locale: 'de',
    ...over
  };
}

function markBody(members: MemberNotice[], over: object = {}) {
  return sendBody(members, null, { action: 'mark', ...over });
}

const told = (fake: Fake) => fake.rpc.mock.calls.filter(([fn]) => fn === 'training_plan_set_told');

beforeEach(() => {
  sendMail.mockReset();
  sendMail.mockResolvedValue({ status: 'sent' });
  planMailMode.mockReturnValue('smtp');
  loadMailScope.mockReset();
  loadMailScope.mockResolvedValue(TK);
  loadMailPlan.mockReset();
  loadMailPlan.mockResolvedValue(DATA);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/training-plan/notify', () => {
  it('needs a session and answers the mode', async () => {
    const out = await GET({ locals: fakeLocals({ session: false }).locals } as never);
    expect(out.status).toBe(401);
    expect(await out.json()).toEqual({ code: 'not_signed_in' });
    planMailMode.mockReturnValue('demo');
    const res = await GET({ locals: fakeLocals().locals } as never);
    expect(await res.json()).toEqual({ mode: 'demo' });
  });
});

describe('POST /api/training-plan/notify', () => {
  it('needs a session', async () => {
    const fake = fakeLocals({ session: false });
    expect(await post(sendBody(family, 'familie@test.ch'), fake)).toEqual({
      status: 401,
      body: { code: 'not_signed_in' }
    });
  });

  it('refuses bad requests', async () => {
    const fake = fakeLocals();
    const good = sendBody(family, 'familie@test.ch');
    const bad = [
      [good, 'text/plain'],
      ['{nope', 'application/json'],
      [{ ...good, memberIds: [] }],
      [{ ...good, memberIds: undefined }],
      [{ ...good, memberIds: [20, 1.5] }],
      [{ ...good, memberIds: ['20'] }],
      [{ ...good, memberIds: Array.from({ length: 501 }, (_, i) => i + 1) }],
      [{ ...good, memberIds: [20, 20] }],
      [{ ...good, action: 'delete' }],
      [{ ...good, fingerprint: '' }],
      [{ ...good, fingerprint: 'x'.repeat(33) }]
    ] as const;
    for (const [body, type] of bad) {
      expect(await post(body, fake, type)).toEqual({ status: 400, body: { code: 'bad_request' } });
    }
    expect(loadMailPlan).not.toHaveBeenCalled();
  });

  it('refuses accounts that plan nothing', async () => {
    loadMailScope.mockResolvedValue(null);
    expect(await post(sendBody(family, 'familie@test.ch'), fakeLocals())).toEqual({
      status: 403,
      body: { code: 'not_allowed' }
    });
  });

  it('refuses to send without mail, but still marks', async () => {
    planMailMode.mockReturnValue('off');
    expect(await post(sendBody(family, 'familie@test.ch'), fakeLocals())).toEqual({
      status: 503,
      body: { code: 'mail_off' }
    });
    const fake = fakeLocals();
    expect(await post(markBody([notice(60)]), fake)).toEqual({
      status: 200,
      body: { status: 'marked', simulated: false, toldSaved: true }
    });
  });

  it('answers 409 for a stale preview, a member not pending or an own member', async () => {
    const fake = fakeLocals();
    const stale = await post(sendBody(family, 'familie@test.ch', { fingerprint: 'abc' }), fake);
    expect(stale).toEqual({ status: 409, body: { code: 'stale' } });
    // The address is part of the fingerprint
    expect(await post(sendBody(family, 'other@test.ch'), fake)).toEqual(stale);
    expect(await post(markBody(family, { memberIds: [20, 999] }), fake)).toEqual(stale);
    expect(await post(markBody([own]), fake)).toEqual(stale);
    // Told since the preview: nothing pending any more
    loadMailPlan.mockResolvedValue({ ...DATA, sessions: [] });
    expect(await post(sendBody([notice(20)], 'familie@test.ch'), fake)).toEqual(stale);
    expect(sendMail).not.toHaveBeenCalled();
    expect(told(fake)).toEqual([]);
  });

  it('sends one mail to the address it looks up, logs it and saves what was told', async () => {
    const fake = fakeLocals();
    const out = await post(
      sendBody(family, 'familie@test.ch', { to: 'evil@test.ch', subject: 'X', text: 'Y' }),
      fake
    );
    expect(out).toEqual({
      status: 200,
      body: { status: 'sent', simulated: false, toldSaved: true }
    });
    const mail = renderMail(family, {
      locale: 'de',
      clubName: 'Testclub',
      origin: 'http://localhost',
      senderName: 'Tina Planer'
    });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith({
      to: 'familie@test.ch',
      subject: mail.subject,
      text: mail.text,
      replyTo: 'tk@test.ch'
    });
    expect(mail.subject).toBe('Testclub – Trainingsplan: Übersicht für Anna und Ben');
    expect(fake.inserts).toEqual([
      [20, 30].map((id) => ({
        member_id: id,
        to_email: 'familie@test.ch',
        subject: mail.subject,
        body: mail.text,
        status: 'pending'
      }))
    ]);
    expect(fake.updates).toEqual([
      {
        patch: { status: 'sent', error: null, sent_at: expect.any(String) },
        ids: [1, 2]
      }
    ]);
    expect(told(fake)).toEqual([
      ['training_plan_set_told', { p_states: [notice(20).told, notice(30).told, own.told] }]
    ]);
  });

  it('sends to one address per request, never to unreachable members', async () => {
    const fake = fakeLocals();
    const both = [notice(10), notice(20)];
    expect(await post(sendBody(both, 'max@test.ch'), fake)).toEqual({
      status: 400,
      body: { code: 'several_addresses' }
    });
    for (const id of [40, 50, 60]) {
      expect(await post(sendBody([notice(id)], null), fake)).toEqual({
        status: 400,
        body: { code: 'unreachable' }
      });
    }
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('simulates in the demo: told, logged as skipped', async () => {
    planMailMode.mockReturnValue('demo');
    sendMail.mockResolvedValue({
      status: 'skipped',
      error: 'Demo: no mail is sent',
      reason: 'demo'
    });
    const fake = fakeLocals();
    expect(await post(sendBody([notice(10)], 'max@test.ch'), fake)).toEqual({
      status: 200,
      body: { status: 'skipped', simulated: true, toldSaved: true, error: 'Demo: no mail is sent' }
    });
    expect(fake.updates[0].patch).toEqual({
      status: 'skipped',
      error: 'Demo: no mail is sent',
      sent_at: null
    });
    expect(told(fake)).toHaveLength(1);
  });

  it('simulates outside production: never asks the mailer, told, logged as skipped', async () => {
    planMailMode.mockReturnValue('test');
    expect(await (await GET({ locals: fakeLocals().locals } as never)).json()).toEqual({
      mode: 'test'
    });
    const fake = fakeLocals();
    const error = 'Test environment: plan mails leave only in production (PUBLIC_MODE=PROD)';
    expect(await post(sendBody([notice(10)], 'max@test.ch'), fake)).toEqual({
      status: 200,
      body: { status: 'skipped', simulated: true, toldSaved: true, error }
    });
    expect(sendMail).not.toHaveBeenCalled();
    expect(fake.inserts[0]).toMatchObject([{ member_id: 10, status: 'pending' }]);
    expect(fake.updates[0].patch).toEqual({ status: 'skipped', error, sent_at: null });
    expect(told(fake)).toHaveLength(1);
  });

  it('answers 409 when a mail to the member may be under way since the preview', async () => {
    // Another planner's send: its log row is still pending
    loadMailPlan.mockResolvedValue({
      ...DATA,
      pendingMails: [{ member_id: 10, created_at: '2026-11-02T09:00:00+00:00' }]
    });
    const fake = fakeLocals();
    expect(await post(sendBody([notice(10)], 'max@test.ch'), fake)).toEqual({
      status: 409,
      body: { code: 'stale' }
    });
    expect(sendMail).not.toHaveBeenCalled();
    // Sent again on purpose, from a preview that shows it: goes out
    const unclear = computeNotices(
      { ...DATA, pendingMails: [{ member_id: 10, created_at: '2026-11-02T09:00:00+00:00' }] },
      TK
    ).members.find((m) => m.memberId === 10)!;
    expect(unclear.unclearSince).toBe('2026-11-02T09:00:00+00:00');
    expect((await post(sendBody([unclear], 'max@test.ch'), fake)).body).toMatchObject({
      status: 'sent'
    });
  });

  it('keeps the told state when the mail failed or was skipped', async () => {
    sendMail.mockResolvedValue({ status: 'failed', error: '550 <max@test.ch> rejected' });
    const fake = fakeLocals();
    expect(await post(sendBody([notice(10)], 'max@test.ch'), fake)).toEqual({
      status: 200,
      body: {
        status: 'failed',
        simulated: false,
        toldSaved: false,
        error: '550 <[email]> rejected'
      }
    });
    expect(fake.updates[0].patch).toEqual({
      status: 'failed',
      error: '550 <[email]> rejected',
      sent_at: null
    });
    expect(told(fake)).toEqual([]);

    sendMail.mockResolvedValue({
      status: 'skipped',
      error: 'SMTP is not configured',
      reason: 'not_configured'
    });
    const skipped = fakeLocals();
    const out = await post(sendBody([notice(10)], 'max@test.ch'), skipped);
    expect(out.body).toMatchObject({ status: 'skipped', simulated: false, toldSaved: false });
    expect(told(skipped)).toEqual([]);
  });

  it('says so when the mail left but the told state was not saved', async () => {
    const fake = fakeLocals({ toldError: { code: '42501' }, updateError: { code: '42501' } });
    expect(await post(sendBody([notice(10)], 'max@test.ch'), fake)).toEqual({
      status: 200,
      body: { status: 'sent', simulated: false, toldSaved: false }
    });
  });

  it('sends nothing when the log refuses the row', async () => {
    const fake = fakeLocals({ insertError: { code: '42501' } });
    expect(await post(sendBody([notice(10)], 'max@test.ch'), fake)).toEqual({
      status: 403,
      body: { code: 'not_allowed' }
    });
    expect(sendMail).not.toHaveBeenCalled();
    expect(told(fake)).toEqual([]);
  });

  it('marks without a mail, also unreachable members, and logs it', async () => {
    const fake = fakeLocals();
    const members = [notice(40), notice(50), notice(60), notice(10)];
    expect(await post(markBody(members), fake)).toEqual({
      status: 200,
      body: { status: 'marked', simulated: false, toldSaved: true }
    });
    expect(sendMail).not.toHaveBeenCalled();
    // In the order of the set (by name), whatever the order asked for
    const sorted = SET.members.filter((m) => members.includes(m));
    expect(sorted.map((m) => m.memberId)).toEqual([10, 60, 40, 50]);
    expect(told(fake)).toEqual([
      ['training_plan_set_told', { p_states: [...sorted.map((m) => m.told), own.told] }]
    ]);
    expect(
      fake.inserts[0].map((row) => [row.member_id, row.status, row.to_email, row.subject])
    ).toEqual([
      [10, 'marked', null, null],
      [60, 'marked', null, null],
      [40, 'marked', null, null],
      [50, 'marked', null, null]
    ]);
    // Each row with that member's own lines
    expect(fake.inserts[0][0].body).toContain('Hallo Max\n');
    expect(fake.inserts[0][1].body).toContain('Hallo Nina\n');
    expect(fake.inserts[0][1].body).not.toContain('Hallo Max');

    const refused = fakeLocals({ toldError: { code: '42501' } });
    expect(await post(markBody([notice(10)]), refused)).toEqual({
      status: 403,
      body: { code: 'not_allowed' }
    });
    expect(refused.inserts).toEqual([]);
    const failed = fakeLocals({ toldError: { code: '23503' } });
    expect(await post(markBody([notice(10)]), failed)).toEqual({
      status: 500,
      body: { code: 'save_failed' }
    });
  });

  it('writes in the language asked for, German unless English', async () => {
    await post(sendBody([notice(10)], 'max@test.ch', { locale: 'en' }), fakeLocals());
    expect(sendMail.mock.calls[0][0].text).toContain('Hello Max');
    expect(sendMail.mock.calls[0][0].subject).toBe('Testclub – Training plan: overview for Max');
    await post(sendBody([notice(10)], 'max@test.ch', { locale: 'fr' }), fakeLocals());
    expect(sendMail.mock.calls[1][0].text).toContain('Hallo Max');
  });

  it('answers 500 when the plan cannot be loaded', async () => {
    loadMailPlan.mockRejectedValue(new Error('timeout for max@test.ch'));
    const out = await post(sendBody([notice(10)], 'max@test.ch'), fakeLocals());
    expect(out).toEqual({ status: 500, body: { code: 'load_failed' } });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('max@test.ch');
    loadMailScope.mockRejectedValue(new Error('down'));
    expect(await post(sendBody([notice(10)], 'max@test.ch'), fakeLocals())).toEqual(out);
  });

  it('loads with the user’s client and a time limit', async () => {
    const fake = fakeLocals();
    await post(sendBody([notice(10)], 'max@test.ch'), fake);
    expect(loadMailScope).toHaveBeenCalledWith(fake.locals.supabase);
    expect(loadMailPlan).toHaveBeenCalledWith(fake.locals.supabase, TK, {
      signal: expect.any(AbortSignal)
    });
  });
});
