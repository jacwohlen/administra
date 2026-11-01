import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadMailPlan, loadMailScope } from './trainingPlanMailData';
import { computeNotices, type MailScope } from './trainingPlanMail';

type Call = [string, ...unknown[]];
interface Query {
  /** Table name, or `rpc:<function>` */
  target: string;
  calls: Call[];
}
type Answer = { data: unknown; error: unknown };

/**
 * A stand-in for the Supabase client: every builder method is recorded, a
 * query resolves with the rows given for its table (sliced by `.range()`), or
 * with the error given for the table or function
 */
function fakeClient(
  tables: Record<string, unknown[]> = {},
  rpcs: Record<string, unknown> = {},
  errors: Record<string, unknown> = {}
) {
  const queries: Query[] = [];
  const builder = (target: string, answer: () => Answer, args?: unknown) => {
    const query: Query = { target, calls: args === undefined ? [] : [['args', args]] };
    queries.push(query);
    let range: [number, number] | null = null;
    const b: Record<string, unknown> = {};
    for (const method of ['select', 'gte', 'lte', 'in', 'eq', 'order', 'abortSignal', 'returns']) {
      b[method] = (...rest: unknown[]) => {
        query.calls.push([method, ...rest]);
        return b;
      };
    }
    b.range = (from: number, to: number) => {
      query.calls.push(['range', from, to]);
      range = [from, to];
      return b;
    };
    b.then = (resolve: (value: Answer) => unknown, reject?: (reason: unknown) => unknown) => {
      const result = answer();
      const data =
        range && Array.isArray(result.data)
          ? result.data.slice(range[0], range[1] + 1)
          : result.data;
      return Promise.resolve({ ...result, data }).then(resolve, reject);
    };
    return b;
  };
  const client = {
    from: (table: string) =>
      builder(table, () =>
        errors[table]
          ? { data: null, error: errors[table] }
          : { data: tables[table] ?? [], error: null }
      ),
    rpc: (fn: string, args?: unknown) =>
      builder(
        `rpc:${fn}`,
        () => (errors[fn] ? { data: null, error: errors[fn] } : { data: rpcs[fn], error: null }),
        args
      )
  };
  const of = (target: string) => queries.filter((q) => q.target === target);
  return { client: client as unknown as SupabaseClient, queries, of };
}

const has = (q: Query, ...call: Call) =>
  q.calls.some((c) => JSON.stringify(c) === JSON.stringify(call));

describe('loadMailScope', () => {
  it('gives the TK every training without asking for main trainings', async () => {
    const fake = fakeClient({}, { is_exam_manager: true, my_main_training_ids: [27] });
    expect(await loadMailScope(fake.client)).toEqual({ all: true, trainingIds: [] });
    expect(fake.of('rpc:my_main_training_ids')).toHaveLength(0);
  });

  it('gives a main trainer their own trainings', async () => {
    const fake = fakeClient(
      {},
      { is_exam_manager: false, my_main_training_ids: [27, '23', 0, null] }
    );
    expect(await loadMailScope(fake.client)).toEqual({ all: false, trainingIds: [27, 23] });
  });

  it('gives nobody else a scope', async () => {
    for (const own of [[], null]) {
      const fake = fakeClient({}, { is_exam_manager: false, my_main_training_ids: own });
      expect(await loadMailScope(fake.client)).toBeNull();
    }
  });

  it('throws when a check fails', async () => {
    const denied = { code: '42501' };
    await expect(
      loadMailScope(fakeClient({}, {}, { is_exam_manager: denied }).client)
    ).rejects.toBe(denied);
    await expect(
      loadMailScope(
        fakeClient({}, { is_exam_manager: false }, { my_main_training_ids: denied }).client
      )
    ).rejects.toBe(denied);
  });
});

describe('loadMailPlan', () => {
  // 23:30 UTC on 2 Nov is already 3 Nov in Zurich
  const now = new Date('2026-11-02T23:30:00Z');
  const training = (id: number, mainTrainerId: number | null) => ({
    training: {
      id,
      title: `T${id}`,
      weekday: 'Monday',
      dateFrom: '18:00',
      dateTo: '19:30',
      section: 'Judo',
      mainTrainerId
    }
  });
  const session = (id: number, trainingId: number, date: string, trainerId: number | null) => ({
    id,
    training_id: trainingId,
    date,
    trainer_id: trainerId,
    topic: null,
    cancelled: null
  });

  it('loads from today (Zurich) for 400 days, never selecting notes', async () => {
    const fake = fakeClient({
      training_plan_trainings: [training(1, 10)],
      training_plan_sessions: [session(5, 1, '2026-11-09', 20)],
      members: [
        { id: 10, firstname: 'Mia', lastname: 'Main' },
        { id: 20, firstname: 'Sam', lastname: 'Sub' }
      ]
    });
    const data = await loadMailPlan(fake.client, { all: true, trainingIds: [] }, { now });
    expect(data.today).toBe('2026-11-03');
    expect(data.to).toBe('2027-12-08');
    expect(data.sessions).toEqual([
      { ...session(5, 1, '2026-11-09', 20), notes: null, updated_at: '' }
    ]);
    const sessions = fake.of('training_plan_sessions')[0];
    expect(has(sessions, 'select', 'id, training_id, date, trainer_id, topic, cancelled')).toBe(
      true
    );
    expect(has(sessions, 'gte', 'date', '2026-11-03')).toBe(true);
    expect(has(sessions, 'lte', 'date', '2027-12-08')).toBe(true);
    const breaks = fake.of('training_plan_breaks')[0];
    expect(has(breaks, 'gte', 'date_to', '2026-11-03')).toBe(true);
    expect(has(breaks, 'lte', 'date_from', '2027-12-08')).toBe(true);
    expect(has(fake.of('training_plan_told')[0], 'gte', 'date', '2026-11-03')).toBe(true);
    expect(JSON.stringify(fake.queries)).not.toContain('notes');
  });

  it('reads every page of sessions and told rows', async () => {
    const many = Array.from({ length: 2300 }, (_, i) => session(i, 1, '2026-11-09', null));
    const told = Array.from({ length: 1000 }, (_, i) => ({
      member_id: 30,
      training_id: 1,
      date: `2027-01-${String((i % 28) + 1).padStart(2, '0')}`,
      state: 'lead'
    }));
    const fake = fakeClient({ training_plan_sessions: many, training_plan_told: told });
    const data = await loadMailPlan(fake.client, { all: true, trainingIds: [] }, { now });
    expect(data.sessions).toHaveLength(2300);
    expect(
      fake.of('training_plan_sessions').map((q) => q.calls.find((c) => c[0] === 'range'))
    ).toEqual([
      ['range', 0, 999],
      ['range', 1000, 1999],
      ['range', 2000, 2999]
    ]);
    // A full last page needs one more request to know it was the last
    expect(data.toldDates).toHaveLength(1000);
    expect(fake.of('training_plan_told')).toHaveLength(2);
    for (const q of fake.of('training_plan_sessions')) expect(has(q, 'order', 'date')).toBe(true);
  });

  it('limits a main trainer to their trainings and the people in them', async () => {
    const signal = new AbortController().signal;
    const fake = fakeClient(
      {
        training_plan_trainings: [training(1, 10), training(2, 11), { training: null }],
        training_plan_sessions: [session(1, 1, '2026-11-09', 20)],
        training_plan_told_trainings: [
          {
            member_id: 30,
            training_id: 1,
            is_main: false,
            title: 'T1',
            weekday: 'Monday',
            time_from: '18:00',
            time_to: '19:30',
            told_at: '2026-10-01T10:00:00Z'
          }
        ],
        training_plan_told: [{ member_id: 30, training_id: 1, date: '2026-11-16', state: 'lead' }],
        training_plan_mail_optouts: [{ member_id: 30 }],
        // Newest first, as asked for
        training_plan_mails: [
          { member_id: 20, created_at: '2026-11-02T10:00:00+00:00' },
          { member_id: 20, created_at: '2026-11-01T10:00:00+00:00' }
        ],
        members: [
          { id: 10, firstname: 'Mia', lastname: 'Main' },
          { id: 20, firstname: 'Sam', lastname: 'Sub' },
          { id: 30, firstname: 'Tom', lastname: 'Told' }
        ]
      },
      {
        my_member_ids: ['10'],
        training_plan_mail_addresses: [{ member_id: 20, email: 'sam@test.ch', source: 'member' }]
      }
    );
    const data = await loadMailPlan(fake.client, { all: false, trainingIds: [1] }, { now, signal });

    // Trainings come unfiltered (the engine scopes them); null joins are dropped
    expect(data.trainings.map((t) => t.id)).toEqual([1, 2]);
    for (const table of [
      'training_plan_sessions',
      'training_plan_told_trainings',
      'training_plan_told'
    ]) {
      expect(has(fake.of(table)[0], 'in', 'training_id', [1])).toBe(true);
    }
    for (const table of [
      'training_plan_trainings',
      'training_plan_breaks',
      'training_plan_mail_optouts'
    ]) {
      expect(fake.of(table)[0].calls.some((c) => c[0] === 'in')).toBe(false);
    }
    // Main trainer 11 of training 2 is outside the scope: not looked up
    expect(has(fake.of('members')[0], 'in', 'id', [10, 20, 30])).toBe(true);
    expect(fake.of('rpc:training_plan_mail_addresses')[0].calls[0]).toEqual([
      'args',
      { p_member_ids: [10, 20, 30] }
    ]);
    expect(data.members.map((m) => m.id)).toEqual([10, 20, 30]);
    expect(data.addresses).toEqual([{ member_id: 20, email: 'sam@test.ch', source: 'member' }]);
    // Mails whose outcome is unknown: the newest pending row per member
    const mails = fake.of('training_plan_mails');
    expect(mails).toHaveLength(1);
    expect(has(mails[0], 'select', 'member_id, created_at')).toBe(true);
    expect(has(mails[0], 'eq', 'status', 'pending')).toBe(true);
    expect(has(mails[0], 'in', 'member_id', [10, 20, 30])).toBe(true);
    expect(has(mails[0], 'order', 'created_at', { ascending: false })).toBe(true);
    expect(data.pendingMails).toEqual([{ member_id: 20, created_at: '2026-11-02T10:00:00+00:00' }]);
    expect(data.optOuts).toEqual([30]);
    expect(data.ownMemberIds).toEqual([10]);
    expect(data.toldTrainings).toHaveLength(1);
    expect(data.toldDates).toHaveLength(1);
    // Every request can be aborted
    expect(
      fake.queries.every((q) => q.calls.some((c) => c[0] === 'abortSignal' && c[1] === signal))
    ).toBe(true);

    // What the engine makes of it: the own member is never mailed
    const scope: MailScope = { all: false, trainingIds: [1] };
    const set = computeNotices(data, scope);
    expect(set.members.map((m) => m.memberId)).toEqual([20, 30]);
    expect(set.own.map((m) => m.memberId)).toEqual([10]);
    expect(set.groups.map((g) => g.key)).toEqual(['sam@test.ch']);
    expect(set.unreachable.map((u) => [u.member.memberId, u.reason])).toEqual([[30, 'opted_out']]);
    expect(set.members.map((m) => [m.memberId, m.unclearSince])).toEqual([
      [20, '2026-11-02T10:00:00+00:00'],
      [30, null]
    ]);
  });

  it('looks members up in chunks and asks for addresses once', async () => {
    const sessions = Array.from({ length: 320 }, (_, i) => session(i, 1, '2026-11-09', 1000 + i));
    const fake = fakeClient(
      { training_plan_trainings: [training(1, null)], training_plan_sessions: sessions },
      { training_plan_mail_addresses: [] }
    );
    await loadMailPlan(fake.client, { all: true, trainingIds: [] }, { now });
    const chunks = fake
      .of('members')
      .map((q) => (q.calls.find((c) => c[0] === 'in')?.[2] as number[]).length);
    expect(chunks).toEqual([150, 150, 20]);
    expect(fake.of('rpc:training_plan_mail_addresses')).toHaveLength(1);
    expect(fake.of('training_plan_mails')).toHaveLength(3);
  });

  it('asks for no names or addresses when nobody is involved, and nothing at all without trainings', async () => {
    const fake = fakeClient(
      { training_plan_trainings: [training(1, null)] },
      { my_member_ids: [] }
    );
    const data = await loadMailPlan(fake.client, { all: true, trainingIds: [] }, { now });
    expect(fake.of('members')).toHaveLength(0);
    expect(fake.of('rpc:training_plan_mail_addresses')).toHaveLength(0);
    expect(fake.of('training_plan_mails')).toHaveLength(0);
    expect(data.members).toEqual([]);
    expect(data.addresses).toEqual([]);
    expect(data.pendingMails).toEqual([]);

    const none = fakeClient();
    const empty = await loadMailPlan(none.client, { all: false, trainingIds: [] }, { now });
    expect(none.queries).toEqual([]);
    expect(empty).toMatchObject({ today: '2026-11-03', to: '2027-12-08', trainings: [] });
  });

  it('throws on any error, also of a later page or a lookup', async () => {
    const denied = { code: '42501', message: 'permission denied' };
    const all = { all: true, trainingIds: [] };
    await expect(
      loadMailPlan(fakeClient({}, {}, { training_plan_told: denied }).client, all, { now })
    ).rejects.toBe(denied);
    await expect(
      loadMailPlan(fakeClient({}, {}, { training_plan_trainings: denied }).client, all, { now })
    ).rejects.toBe(denied);
    await expect(
      loadMailPlan(fakeClient({}, {}, { my_member_ids: denied }).client, all, { now })
    ).rejects.toBe(denied);
    const involved = {
      training_plan_trainings: [training(1, 10)],
      members: [{ id: 10, firstname: 'Mia', lastname: 'Main' }]
    };
    await expect(
      loadMailPlan(fakeClient(involved, {}, { members: denied }).client, all, { now })
    ).rejects.toBe(denied);
    await expect(
      loadMailPlan(fakeClient(involved, {}, { training_plan_mail_addresses: denied }).client, all, {
        now
      })
    ).rejects.toBe(denied);
    await expect(
      loadMailPlan(fakeClient(involved, {}, { training_plan_mails: denied }).client, all, { now })
    ).rejects.toBe(denied);
  });
});
