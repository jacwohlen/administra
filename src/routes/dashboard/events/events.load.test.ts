import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    from: vi.fn()
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

import { load } from './[eventId]/+page';

describe('event detail load', () => {
  const mockEvent = {
    id: 'evt-1',
    title: 'Tournament',
    date: '2024-03-15',
    section: 'Judo'
  };

  const mockParent = vi.fn().mockResolvedValue({ event: mockEvent });

  beforeEach(() => {
    vi.clearAllMocks();
    mockParent.mockResolvedValue({ event: mockEvent });
  });

  it('returns event data from parent', async () => {
    mockSupabase.from
      .mockReturnValueOnce(createChainFromResult({ data: [], error: null }))
      .mockReturnValueOnce(createChainFromResult({ data: [], error: null }))
      .mockReturnValueOnce(createChainFromResult({ data: [], error: null }));

    const result = await load({
      params: { eventId: 'evt-1' },
      parent: mockParent
    } as never);

    expect(result.event).toEqual(mockEvent);
  });

  it('queries correct tables', async () => {
    mockSupabase.from
      .mockReturnValueOnce(createChainFromResult({ data: [], error: null }))
      .mockReturnValueOnce(createChainFromResult({ data: [], error: null }))
      .mockReturnValueOnce(createChainFromResult({ data: [], error: null }));

    await load({
      params: { eventId: 'evt-1' },
      parent: mockParent
    } as never);

    expect(mockSupabase.from).toHaveBeenCalledWith('event_participants');
    expect(mockSupabase.from).toHaveBeenCalledWith('event_logs');
    expect(mockSupabase.from).toHaveBeenCalledWith('members');
  });

  it('returns participants, logs, and allMembers', async () => {
    const participants = [{ id: 'p1', memberId: '1', eventId: 'evt-1' }];
    const logs = [{ id: 1, memberId: '1', eventId: 'evt-1' }];
    const members = [{ id: '1', firstname: 'Alice', lastname: 'Smith' }];

    mockSupabase.from
      .mockReturnValueOnce(createChainFromResult({ data: participants, error: null }))
      .mockReturnValueOnce(createChainFromResult({ data: logs, error: null }))
      .mockReturnValueOnce(createChainFromResult({ data: members, error: null }));

    const result = await load({
      params: { eventId: 'evt-1' },
      parent: mockParent
    } as never);

    expect(result.participants).toEqual(participants);
    expect(result.logs).toEqual(logs);
    expect(result.allMembers).toEqual(members);
  });

  it('defaults to empty arrays when data is null', async () => {
    mockSupabase.from
      .mockReturnValueOnce(createChainFromResult({ data: null, error: null }))
      .mockReturnValueOnce(createChainFromResult({ data: null, error: null }))
      .mockReturnValueOnce(createChainFromResult({ data: null, error: null }));

    const result = await load({
      params: { eventId: 'evt-1' },
      parent: mockParent
    } as never);

    expect(result.participants).toEqual([]);
    expect(result.logs).toEqual([]);
    expect(result.allMembers).toEqual([]);
  });

  it('throws when participants query fails', async () => {
    mockSupabase.from.mockReturnValueOnce(
      createChainFromResult({ data: null, error: { message: 'fail' } })
    );

    await expect(
      load({ params: { eventId: 'evt-1' }, parent: mockParent } as never)
    ).rejects.toThrow();
  });

  it('throws when logs query fails', async () => {
    mockSupabase.from
      .mockReturnValueOnce(createChainFromResult({ data: [], error: null }))
      .mockReturnValueOnce(createChainFromResult({ data: null, error: { message: 'logs fail' } }));

    await expect(
      load({ params: { eventId: 'evt-1' }, parent: mockParent } as never)
    ).rejects.toThrow();
  });

  it('throws when members query fails', async () => {
    mockSupabase.from
      .mockReturnValueOnce(createChainFromResult({ data: [], error: null }))
      .mockReturnValueOnce(createChainFromResult({ data: [], error: null }))
      .mockReturnValueOnce(
        createChainFromResult({ data: null, error: { message: 'members fail' } })
      );

    await expect(
      load({ params: { eventId: 'evt-1' }, parent: mockParent } as never)
    ).rejects.toThrow();
  });
});
