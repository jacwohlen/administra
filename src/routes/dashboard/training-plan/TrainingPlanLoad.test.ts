import { describe, it, expect, vi, beforeEach } from 'vitest';

// Every table answers with its rows; the RPC as the test says
const { rpc, tables } = vi.hoisted(() => ({
  rpc: vi.fn(),
  tables: {} as Record<string, unknown[]>
}));
vi.mock('$lib/supabase', () => {
  const chain = (table: string): unknown =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void) =>
              resolve({ data: tables[table] ?? [], error: null });
          }
          return () => chain(table);
        }
      }
    );
  return {
    supabaseClient: { from: (table: string) => chain(table), rpc },
    // As the real one: the rows of a set-returning function
    rpcRows: async (fn: string, args?: Record<string, unknown>) => {
      const { data, error } = await rpc(fn, args);
      return { data: data ?? [], error };
    }
  };
});
vi.mock('./members', () => ({ loadPlanMembers: vi.fn(async () => []) }));

import { load } from './+page';

const trainings = [
  { id: 27, title: 'Judo Kampftraining', weekday: 'Monday', dateFrom: '20:00', section: 'Judo' },
  { id: 23, title: 'Judo Techniktraining', weekday: 'Friday', dateFrom: '20:00', section: 'Judo' }
];

type Flags = { canWrite: boolean; canPlanTrainings: boolean };
const tk = { canWrite: false, canPlanTrainings: true };
const trainer = { canWrite: true, canPlanTrainings: false };
const viewer = { canWrite: false, canPlanTrainings: false };

async function plannable(flags: Flags) {
  const data = (await load({
    url: new URL('http://localhost/dashboard/training-plan?year=2027'),
    depends: () => {},
    parent: async () => flags
  } as never)) as { plannableIds: number[] };
  return data.plannableIds;
}

describe('training plan load: who plans which training', () => {
  beforeEach(() => {
    tables.training_plan_trainings = trainings.map((training) => ({ training }));
    rpc.mockReset().mockResolvedValue({ data: [23], error: null });
  });

  it('lets the TK plan every planned training, without asking', async () => {
    expect(await plannable(tk)).toEqual([27, 23]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('lets a trainer plan the trainings they lead as main trainer', async () => {
    expect(await plannable(trainer)).toEqual([23]);
    expect(rpc).toHaveBeenCalledWith('my_main_training_ids', undefined);
  });

  it('keeps only trainings in the plan', async () => {
    rpc.mockResolvedValue({ data: [99, 27], error: null });
    expect(await plannable(trainer)).toEqual([27]);
  });

  it('gives viewers nothing to plan, without asking', async () => {
    expect(await plannable(viewer)).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('leaves the plan read-only when the database does not answer', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } });
    expect(await plannable(trainer)).toEqual([]);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
