import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Athletes } from '$lib/models';

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

import { load as loadStats } from './[[year]]/+page';
import { load as loadCategory } from './[[year]]/top/[category]/[section]/+page';

describe('stats [[year]] load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to current year in YEAR mode when no param', async () => {
    const athletes: Athletes[] = [
      { section: 'Judo', memberId: 1, lastname: 'Doe', firstname: 'John', count: 10, rank: 1 }
    ];

    mockSupabase.rpc.mockReturnValue(createChainFromResult({ data: athletes, error: null }));

    const result = await loadStats({ params: {} } as never);
    expect(result.yearmode).toBe('YEAR');
    expect(result.year).toBe(new Date().getFullYear());
    expect(result.topAthletes).toHaveProperty('Judo');
  });

  it('uses ALL mode when param is ALL', async () => {
    mockSupabase.rpc.mockReturnValue(createChainFromResult({ data: [], error: null }));

    const result = await loadStats({ params: { year: 'ALL' } } as never);
    expect(result.yearmode).toBe('ALL');
  });

  it('parses numeric year param', async () => {
    mockSupabase.rpc.mockReturnValue(createChainFromResult({ data: [], error: null }));

    const result = await loadStats({ params: { year: '2023' } } as never);
    expect(result.yearmode).toBe('YEAR');
    expect(result.year).toBe(2023);
  });

  it('throws on RPC error', async () => {
    mockSupabase.rpc.mockReturnValue(
      createChainFromResult({ data: null, error: { message: 'RPC failed' } })
    );

    await expect(loadStats({ params: {} } as never)).rejects.toThrow();
  });

  it('groups athletes by section alphabetically', async () => {
    const athletes: Athletes[] = [
      { section: 'Karate', memberId: 1, lastname: 'A', firstname: 'B', count: 5, rank: 1 },
      { section: 'Aikido', memberId: 2, lastname: 'C', firstname: 'D', count: 3, rank: 2 },
      { section: 'Karate', memberId: 3, lastname: 'E', firstname: 'F', count: 2, rank: 3 }
    ];

    mockSupabase.rpc.mockReturnValue(createChainFromResult({ data: athletes, error: null }));

    const result = await loadStats({ params: {} } as never);
    const sections = Object.keys(result.topAthletes);
    expect(sections).toEqual(['Aikido', 'Karate']);
    expect(result.topAthletes['Karate']).toHaveLength(2);
  });
});

describe('stats category load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches athletes category to correct RPC', async () => {
    mockSupabase.rpc.mockReturnValue(createChainFromResult({ data: [], error: null }));

    const result = await loadCategory({
      params: { year: '2023', category: 'athletes', section: 'Judo' }
    } as never);

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_top_athletes_from_section', {
      sect: 'Judo',
      year: '2023'
    });
    expect(result.category).toBe('athletes');
    expect(result.section).toBe('Judo');
  });

  it('dispatches trainers category to correct RPC', async () => {
    mockSupabase.rpc.mockReturnValue(createChainFromResult({ data: [], error: null }));

    await loadCategory({
      params: { year: '2023', category: 'trainers', section: 'Karate' }
    } as never);

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_top_trainers_from_section', {
      sect: 'Karate',
      year: '2023'
    });
  });

  it('dispatches events category with correct params', async () => {
    mockSupabase.rpc.mockReturnValue(createChainFromResult({ data: [], error: null }));

    await loadCategory({
      params: { year: '2023', category: 'events', section: 'Judo' }
    } as never);

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_top_event_participants', {
      year_param: '2023',
      section_param: 'Judo'
    });
  });

  it('dispatches coaches category to correct RPC', async () => {
    mockSupabase.rpc.mockReturnValue(createChainFromResult({ data: [], error: null }));

    await loadCategory({
      params: { year: '2023', category: 'coaches', section: 'Judo' }
    } as never);

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_top_event_coaches_from_section', {
      sect: 'Judo',
      year: '2023'
    });
  });

  it('passes empty string for ALL year mode', async () => {
    mockSupabase.rpc.mockReturnValue(createChainFromResult({ data: [], error: null }));

    await loadCategory({
      params: { year: 'ALL', category: 'athletes', section: 'Judo' }
    } as never);

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_top_athletes_from_section', {
      sect: 'Judo',
      year: ''
    });
  });

  it('passes null year_param for events in ALL mode', async () => {
    mockSupabase.rpc.mockReturnValue(createChainFromResult({ data: [], error: null }));

    await loadCategory({
      params: { year: 'ALL', category: 'events', section: 'Judo' }
    } as never);

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_top_event_participants', {
      year_param: null,
      section_param: 'Judo'
    });
  });

  it('throws 404 for invalid category', async () => {
    await expect(
      loadCategory({
        params: { year: '2023', category: 'invalid', section: 'Judo' }
      } as never)
    ).rejects.toThrow('No valid Category');
  });

  it('throws on RPC error', async () => {
    mockSupabase.rpc.mockReturnValue(
      createChainFromResult({ data: null, error: { message: 'fail' } })
    );

    await expect(
      loadCategory({
        params: { year: '2023', category: 'athletes', section: 'Judo' }
      } as never)
    ).rejects.toThrow();
  });
});
