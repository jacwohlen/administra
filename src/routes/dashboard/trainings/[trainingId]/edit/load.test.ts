import { describe, it, expect, vi, beforeEach } from 'vitest';

// A chainable query that resolves to the given result
function chain(result: { data: unknown; error: unknown }) {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve(result);
      }
      if (typeof prop === 'string') {
        return vi.fn().mockReturnValue(new Proxy({}, handler));
      }
      return undefined;
    }
  };
  return new Proxy({}, handler);
}

const { mockSupabase } = vi.hoisted(() => ({ mockSupabase: { from: vi.fn() } }));
vi.mock('$lib/supabase', () => ({ supabaseClient: mockSupabase }));
vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw Object.assign(new Error(location), { status, location });
  },
  error: (status: number, body: unknown) => {
    throw Object.assign(new Error(JSON.stringify(body)), { status });
  }
}));

import { load } from './+page';

type Parent = { canWrite: boolean; canPlanTrainings: boolean; mainTrainerId: number | null };
const run = (parent: Parent) =>
  load({ parent: async () => parent, params: { trainingId: '2' } } as never) as Promise<{
    trainerOptions: { id: number; participant: boolean }[];
  }>;

describe('edit training load: main trainer options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads no candidates for a trainer who is not the TK (read-only)', async () => {
    const result = await run({ canWrite: true, canPlanTrainings: false, mainTrainerId: 102 });
    expect(result).toEqual({ trainerOptions: [] });
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('loads the candidates for the TK, the current main trainer included', async () => {
    mockSupabase.from
      .mockReturnValueOnce(
        chain({
          data: [
            { id: 102, firstname: 'Marco', lastname: 'Rossi', membership_status: null },
            { id: 105, firstname: 'Lea', lastname: 'Meier', membership_status: 'active' },
            { id: 106, firstname: 'Tim', lastname: 'Probe', membership_status: 'trial' }
          ],
          error: null
        })
      )
      .mockReturnValueOnce(chain({ data: [{ memberId: 105 }], error: null }));
    const result = await run({ canWrite: true, canPlanTrainings: true, mainTrainerId: 102 });
    expect(result.trainerOptions.map((o) => [o.id, o.participant])).toEqual([
      [102, false],
      [105, true]
    ]);
  });

  it('sends viewers back to the training', async () => {
    await expect(
      run({ canWrite: false, canPlanTrainings: true, mainTrainerId: null })
    ).rejects.toMatchObject({ status: 303, location: '/dashboard/trainings/2' });
  });
});
