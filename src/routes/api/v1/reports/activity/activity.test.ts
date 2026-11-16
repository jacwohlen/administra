import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';
import type { ApiActivityReportData } from '#lib/publicApi.ts';

const key = 'alleda_' + '0123456789abcdef'.repeat(3);

// Anna leads training 1 with Ben as assistant, Ben leads training 2 and
// coaches half a day at the Q-Prüfung; training 2 on 12 March was held
// without a main trainer
const data = (member: ApiActivityReportData['member'] = null): ApiActivityReportData => ({
  allowed_origins: [],
  member,
  members: [
    { id: 1, firstname: 'Anna', lastname: 'Muster' },
    { id: 2, firstname: 'Ben', lastname: 'Beispiel' }
  ],
  trainings: [
    { id: 1, title: 'Kinder', section: 'Judo', weekday: 'Tuesday', dateFrom: '18:00' },
    {
      id: 2,
      title: 'Erwachsene',
      section: 'Judo',
      weekday: 'Thursday',
      dateFrom: '20:00',
      mainTrainerId: 2
    }
  ],
  planned_ids: [2],
  trainer_logs: [
    { date: '2026-03-03', trainingId: 1, memberId: 1, trainerRole: 'main_trainer' },
    { date: '2026-03-03', trainingId: 1, memberId: 2, trainerRole: 'assistant' },
    { date: '2026-03-05', trainingId: 2, memberId: 2, trainerRole: 'main_trainer' }
  ],
  held: [
    {
      date: '2026-03-03',
      trainingId: 1,
      count: 12,
      mainTrainerCount: 1,
      totalTrainerCount: 2,
      hasLessonPlan: true
    },
    { date: '2026-03-05', trainingId: 2, count: 8, mainTrainerCount: 1, totalTrainerCount: 1 },
    { date: '2026-03-12', trainingId: 2, count: 7, mainTrainerCount: 0, totalTrainerCount: 0 }
  ],
  events: [{ id: 11, title: 'Q-Prüfung', date: '2026-03-14', date_to: null, section: 'Judo' }],
  event_logs: [
    { eventId: 11, memberId: 7, isCoach: false },
    { eventId: 11, memberId: 2, isCoach: true, coachDay: 'half' }
  ],
  sessions: [],
  breaks: []
});

function rpcReturning(result: { data?: unknown; error: unknown } | Error) {
  const abortSignal = vi.fn(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
  );
  return vi.fn(() => ({ abortSignal }));
}

async function call(
  path: string,
  rpc: ReturnType<typeof rpcReturning>,
  opts: { auth?: string | null; origin?: string } = {}
) {
  const url = new URL(`https://admin.example${path}`);
  const headers = new Headers();
  const auth = opts.auth === undefined ? `Bearer ${key}` : opts.auth;
  if (auth) headers.set('authorization', auth);
  if (opts.origin) headers.set('origin', opts.origin);
  const response = await GET({
    url,
    params: {},
    request: new Request(url, { headers }),
    locals: { supabase: { rpc } }
  } as unknown as Parameters<typeof GET>[0]);
  return { status: response.status, headers: response.headers, body: await response.json() };
}

describe('GET /api/v1/reports/activity', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});

  it('computes the report like the admin page, never cached', async () => {
    const rpc = rpcReturning({ data: data(), error: null });
    const { status, headers, body } = await call(
      '/api/v1/reports/activity?from=2026-03-01&to=2026-03-31',
      rpc
    );
    expect(status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('api_activity_report', {
      p_key: key,
      p_from: '2026-03-01',
      p_to: '2026-03-31',
      p_member_id: null
    });
    expect(headers.get('cache-control')).toBe('no-store');
    expect(body.member).toBeNull();
    expect(body.people).toEqual([
      {
        memberId: 2,
        firstname: 'Ben',
        lastname: 'Beispiel',
        mainTrainer: 1,
        assistant: 1,
        coachingDays: 0.5
      },
      {
        memberId: 1,
        firstname: 'Anna',
        lastname: 'Muster',
        mainTrainer: 1,
        assistant: 0,
        coachingDays: 0
      }
    ]);
    expect(body.totals).toEqual({ mainTrainer: 2, assistant: 1, coachingDays: 0.5 });
    expect(body.trainings[0]).toEqual({
      date: '2026-03-03',
      trainingId: 1,
      title: 'Kinder',
      section: 'Judo',
      mainTrainers: [{ memberId: 1, firstname: 'Anna', lastname: 'Muster' }],
      assistants: [{ memberId: 2, firstname: 'Ben', lastname: 'Beispiel' }],
      participants: 10,
      lessonPlan: true
    });
    expect(body.coaching).toEqual([
      {
        eventId: 11,
        title: 'Q-Prüfung',
        from: '2026-03-14',
        to: '2026-03-14',
        participants: 1,
        coaches: [{ memberId: 2, firstname: 'Ben', lastname: 'Beispiel', days: 0.5 }]
      }
    ]);
    // Planned, held without a main trainer: the plan names Ben
    expect(body.checks.map((c: { date: string; reason: string }) => [c.date, c.reason])).toEqual([
      ['2026-03-12', 'no_main_trainer']
    ]);
  });

  it("shows only one person's trainings, coaching and checks", async () => {
    const anna = { id: 1, firstname: 'Anna', lastname: 'Muster' };
    const rpc = rpcReturning({ data: data(anna), error: null });
    const { status, body } = await call(
      '/api/v1/reports/activity?from=2026-03-01&to=2026-03-31&member=1',
      rpc
    );
    expect(status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      'api_activity_report',
      expect.objectContaining({ p_member_id: 1 })
    );
    expect(body.member).toEqual({ memberId: 1, firstname: 'Anna', lastname: 'Muster' });
    expect(body.people.map((p: { memberId: number }) => p.memberId)).toEqual([1]);
    expect(body.totals).toEqual({ mainTrainer: 1, assistant: 0, coachingDays: 0 });
    expect(body.trainings.map((t: { date: string }) => t.date)).toEqual(['2026-03-03']);
    expect(body.coaching).toEqual([]);
    expect(body.checks).toEqual([]);
  });

  it('lists a person without activity with zeros', async () => {
    const zoe = { id: 9, firstname: 'Zoe', lastname: 'Leer' };
    const { body } = await call(
      '/api/v1/reports/activity?from=2026-03-01&to=2026-03-31&member=9',
      rpcReturning({ data: data(zoe), error: null })
    );
    expect(body.people).toEqual([
      {
        memberId: 9,
        firstname: 'Zoe',
        lastname: 'Leer',
        mainTrainer: 0,
        assistant: 0,
        coachingDays: 0
      }
    ]);
    expect(body.trainings).toEqual([]);
  });

  it('defaults to the calendar year of from', async () => {
    const rpc = rpcReturning({ data: data(), error: null });
    await call('/api/v1/reports/activity?from=2025-01-01', rpc);
    expect(rpc).toHaveBeenCalledWith(
      'api_activity_report',
      expect.objectContaining({ p_from: '2025-01-01', p_to: '2025-12-31' })
    );
  });

  it('refuses bad requests, keys, browsers and unknown members', async () => {
    const ok = () => rpcReturning({ data: data(), error: null });
    expect((await call('/api/v1/reports/activity', ok(), { auth: null })).status).toBe(401);
    expect((await call('/api/v1/reports/activity?from=2026-13-01', ok())).status).toBe(400);
    expect((await call('/api/v1/reports/activity?member=abc', ok())).status).toBe(400);
    expect(
      (await call('/api/v1/reports/activity?from=2025-01-01&to=2026-06-30', ok())).status
    ).toBe(400);
    expect(
      (await call('/api/v1/reports/activity', rpcReturning({ data: null, error: null }))).status
    ).toBe(401);
    expect(
      (await call('/api/v1/reports/activity', ok(), { origin: 'https://www.example.ch' })).body
        .error.code
    ).toBe('origin_not_allowed');
    const missing = await call('/api/v1/reports/activity?member=99', ok());
    expect([missing.status, missing.body.error.code]).toEqual([404, 'not_found']);
    expect((await call('/api/v1/reports/activity', rpcReturning(new Error('down')))).status).toBe(
      503
    );
  });
});
