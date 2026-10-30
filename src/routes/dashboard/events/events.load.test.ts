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
import { load as layoutLoad } from './[eventId]/+layout';

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

// The layout queries, in order: events, event_links
describe('event layout load', () => {
  const mockEvent = { id: 51830, title: 'Kurs', date: '2026-11-01', section: 'Judo' };
  const params = { eventId: '51830' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the event and its live provider link', async () => {
    const link = {
      connection: 'webling',
      url: 'https://club.webling.ch/portal#/calendar/event/51830'
    };
    mockQueries(ok(mockEvent), ok([link]));

    const result = await layoutLoad({ params } as never);

    expect(result.event).toEqual(mockEvent);
    expect(result.eventLink).toEqual(link);
    expect(mockSupabase.from).toHaveBeenCalledWith('events');
    expect(mockSupabase.from).toHaveBeenCalledWith('event_links');
  });

  it("an event without a live link is the app's", async () => {
    mockQueries(ok(mockEvent), ok([]));

    const result = await layoutLoad({ params } as never);

    expect(result.eventLink).toBeNull();
  });

  it('a link that cannot be read means not linked, and is logged', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockQueries(ok(mockEvent), { data: null, error: { message: 'Failed to fetch' } });

    const result = await layoutLoad({ params } as never);

    expect(result.event).toEqual(mockEvent);
    expect(result.eventLink).toBeNull();
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it('throws 404 when the event cannot be loaded', async () => {
    mockQueries({ data: null, error: { message: 'not found' } }, ok([]));

    await expect(layoutLoad({ params } as never)).rejects.toThrow();
  });
});
