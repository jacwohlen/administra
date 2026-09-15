import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSupabase } = vi.hoisted(() => ({
  mockSupabase: {
    from: vi.fn()
  }
}));

vi.mock('$lib/supabase', () => ({
  supabaseClient: mockSupabase
}));

import { getBadgeDefinitions, getGradeDefinitions } from './referenceData';

function mockSelect(result: { data: unknown; error: unknown }) {
  return { select: vi.fn().mockResolvedValue(result) };
}

describe('referenceData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches badge definitions once and serves later calls from cache', async () => {
    const defs = [{ id: 'attendance-10', emoji: '🥉' }];
    mockSupabase.from.mockReturnValue(mockSelect({ data: defs, error: null }));

    const first = await getBadgeDefinitions();
    const callsAfterFirst = mockSupabase.from.mock.calls.length;
    const second = await getBadgeDefinitions();

    expect(first).toEqual(defs);
    expect(second).toBe(first);
    expect(mockSupabase.from.mock.calls.length).toBe(callsAfterFirst);
  });

  it('does not cache a failed fetch and retries on the next call', async () => {
    mockSupabase.from.mockReturnValueOnce(mockSelect({ data: null, error: { message: 'boom' } }));

    expect(await getGradeDefinitions()).toEqual([]);

    const defs = [{ id: 'kyu-5', section: 'Judo' }];
    mockSupabase.from.mockReturnValueOnce(mockSelect({ data: defs, error: null }));

    expect(await getGradeDefinitions()).toEqual(defs);
  });
});
