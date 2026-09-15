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

// The loader queries, in order: event_participants, event_logs, member_medals, members
function mockQueries(...results: { data: unknown; error: unknown }[]) {
  for (const r of results) {
    mockSupabase.from.mockReturnValueOnce(createChainFromResult(r));
  }
}

const ok = (data: unknown = []) => ({ data, error: null });

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
    mockQueries(ok(), ok(), ok(), ok());

    const result = await load({
      params: { eventId: 'evt-1' },
      parent: mockParent
    } as never);

    expect(result.event).toEqual(mockEvent);
  });

  it('queries correct tables', async () => {
    mockQueries(ok(), ok(), ok(), ok());

    await load({
      params: { eventId: 'evt-1' },
      parent: mockParent
    } as never);

    expect(mockSupabase.from).toHaveBeenCalledWith('event_participants');
    expect(mockSupabase.from).toHaveBeenCalledWith('event_logs');
    expect(mockSupabase.from).toHaveBeenCalledWith('member_medals');
    expect(mockSupabase.from).toHaveBeenCalledWith('members');
  });

  it('returns participants, logs, medals, and allMembers', async () => {
    const participants = [{ id: 'p1', memberId: '1', eventId: 'evt-1' }];
    const logs = [{ id: 1, memberId: '1', eventId: 'evt-1' }];
    const medals = [{ id: 7, memberId: 1, eventId: 1, medal: 'gold' }];
    const members = [{ id: '1', firstname: 'Alice', lastname: 'Smith' }];

    mockQueries(ok(participants), ok(logs), ok(medals), ok(members));

    const result = await load({
      params: { eventId: 'evt-1' },
      parent: mockParent
    } as never);

    expect(result.participants).toEqual(participants);
    expect(result.logs).toEqual(logs);
    expect(result.medals).toEqual(medals);
    expect(result.allMembers).toEqual(members);
  });

  it('defaults to empty arrays when data is null', async () => {
    mockQueries(ok(null), ok(null), ok(null), ok(null));

    const result = await load({
      params: { eventId: 'evt-1' },
      parent: mockParent
    } as never);

    expect(result.participants).toEqual([]);
    expect(result.logs).toEqual([]);
    expect(result.medals).toEqual([]);
    expect(result.allMembers).toEqual([]);
  });

  it('throws when participants query fails', async () => {
    mockQueries({ data: null, error: { message: 'fail' } });

    await expect(
      load({ params: { eventId: 'evt-1' }, parent: mockParent } as never)
    ).rejects.toThrow();
  });

  it('throws when logs query fails', async () => {
    mockQueries(ok(), { data: null, error: { message: 'logs fail' } });

    await expect(
      load({ params: { eventId: 'evt-1' }, parent: mockParent } as never)
    ).rejects.toThrow();
  });

  it('throws when members query fails', async () => {
    mockQueries(ok(), ok(), ok(), { data: null, error: { message: 'members fail' } });

    await expect(
      load({ params: { eventId: 'evt-1' }, parent: mockParent } as never)
    ).rejects.toThrow();
  });
});
