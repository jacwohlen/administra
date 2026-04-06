import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Training } from '$lib/models';

// Helper to create a chainable mock from a result
function createChainFromResult(result: { data: unknown; error: unknown }) {
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

const { mockSupabase } = vi.hoisted(() => ({
  mockSupabase: {
    from: vi.fn(),
    rpc: vi.fn()
  }
}));

vi.mock('$lib/supabase', () => ({
  supabaseClient: mockSupabase
}));

vi.mock('@sveltejs/kit', () => ({
  error: (status: number, body: unknown) => {
    const e = new Error(typeof body === 'string' ? body : JSON.stringify(body));
    (e as unknown as Record<string, unknown>).status = status;
    throw e;
  }
}));

import { load } from './+page';

describe('trainings list load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns trainings sorted by weekday then time', async () => {
    const trainings: Training[] = [
      {
        id: '1',
        title: 'Evening',
        dateFrom: '20:00',
        dateTo: '21:00',
        weekday: 'Wednesday',
        section: 'Judo',
        participants: []
      },
      {
        id: '2',
        title: 'Morning',
        dateFrom: '08:00',
        dateTo: '09:00',
        weekday: 'Monday',
        section: 'Judo',
        participants: []
      },
      {
        id: '3',
        title: 'Afternoon',
        dateFrom: '14:00',
        dateTo: '15:00',
        weekday: 'Monday',
        section: 'Karate',
        participants: []
      }
    ];

    mockSupabase.from.mockReturnValueOnce(
      createChainFromResult({ data: [...trainings], error: null })
    );

    const result = await load();
    expect(result.trainings[0].title).toBe('Morning'); // Monday 08:00
    expect(result.trainings[1].title).toBe('Afternoon'); // Monday 14:00
    expect(result.trainings[2].title).toBe('Evening'); // Wednesday 20:00
  });

  it('throws 404 on supabase error', async () => {
    mockSupabase.from.mockReturnValueOnce(
      createChainFromResult({ data: null, error: { message: 'DB error' } })
    );

    await expect(load()).rejects.toThrow();
  });

  it('returns empty array when no trainings exist', async () => {
    mockSupabase.from.mockReturnValueOnce(createChainFromResult({ data: [], error: null }));

    const result = await load();
    expect(result.trainings).toEqual([]);
  });
});
