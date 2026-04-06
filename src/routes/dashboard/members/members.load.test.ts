import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Member } from '$lib/models';

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

describe('members list load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns members from supabase', async () => {
    const members: Partial<Member>[] = [
      { id: '1', firstname: 'Alice', lastname: 'Smith', labels: ['Judo'] },
      { id: '2', firstname: 'Bob', lastname: 'Jones', labels: [] }
    ];

    mockSupabase.from.mockReturnValueOnce(createChainFromResult({ data: members, error: null }));
    mockSupabase.rpc.mockReturnValueOnce(createChainFromResult({ data: [], error: null }));

    const mockDepends = vi.fn();
    const result = await load({ depends: mockDepends } as never);

    expect(result.members).toEqual(members);
    expect(mockDepends).toHaveBeenCalledWith('members:list');
  });

  it('queries the members table', async () => {
    mockSupabase.from.mockReturnValueOnce(createChainFromResult({ data: [], error: null }));
    mockSupabase.rpc.mockReturnValueOnce(createChainFromResult({ data: [], error: null }));

    await load({ depends: vi.fn() } as never);
    expect(mockSupabase.from).toHaveBeenCalledWith('members');
  });

  it('throws on supabase error', async () => {
    mockSupabase.from.mockReturnValueOnce(
      createChainFromResult({ data: null, error: { message: 'Connection failed' } })
    );

    await expect(load({ depends: vi.fn() } as never)).rejects.toThrow();
  });

  it('returns empty array when no members exist', async () => {
    mockSupabase.from.mockReturnValueOnce(createChainFromResult({ data: [], error: null }));
    mockSupabase.rpc.mockReturnValueOnce(createChainFromResult({ data: [], error: null }));

    const result = await load({ depends: vi.fn() } as never);
    expect(result.members).toEqual([]);
  });
});
