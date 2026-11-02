import { describe, expect, it, vi } from 'vitest';
import { GET as listEvents } from './+server';
import { GET as listParticipants } from './[eventId]/participants/+server';

const key = 'alleda_' + '0123456789abcdef'.repeat(3);

const event = {
  id: 10000005,
  title: 'Sommerlager',
  date: '2026-07-06',
  date_to: '2026-07-10',
  all_day: true,
  timeFrom: null,
  timeTo: null,
  location: 'Tenero',
  section: 'Judo',
  registered: 2,
  attended: 1
};

const participants = [
  { id: 1, firstname: 'Anna', lastname: 'Muster', registered: true, attended: true, coach: false },
  {
    id: 2,
    firstname: 'Beni',
    lastname: 'Beispiel',
    registered: true,
    attended: false,
    coach: false
  }
];

/** rpc() as the Supabase builder: awaited through abortSignal() */
function rpcReturning(result: { data?: unknown; error: unknown } | Error) {
  const abortSignal = vi.fn(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
  );
  return vi.fn(() => ({ abortSignal }));
}

type Handler = typeof listEvents;

async function call(
  handler: Handler,
  path: string,
  rpc: ReturnType<typeof rpcReturning>,
  opts: { auth?: string | null; origin?: string; params?: Record<string, string> } = {}
) {
  const url = new URL(`https://admin.example${path}`);
  const headers = new Headers();
  const auth = opts.auth === undefined ? `Bearer ${key}` : opts.auth;
  if (auth) headers.set('authorization', auth);
  if (opts.origin) headers.set('origin', opts.origin);
  const response = await handler({
    url,
    params: opts.params ?? {},
    request: new Request(url, { headers }),
    locals: { supabase: { rpc } }
  } as unknown as Parameters<Handler>[0]);
  return { status: response.status, headers: response.headers, body: await response.json() };
}

describe('GET /api/v1/events', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const ok = () => rpcReturning({ data: { allowed_origins: [], events: [event] }, error: null });

  it('lists the events of the period for a server', async () => {
    const rpc = ok();
    const { status, headers, body } = await call(
      listEvents,
      '/api/v1/events?from=2026-07-01&to=2026-07-31',
      rpc
    );
    expect(status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('api_events', {
      p_key: key,
      p_from: '2026-07-01',
      p_to: '2026-07-31'
    });
    expect(headers.get('cache-control')).toBe('no-store');
    expect(body.events).toEqual([
      expect.objectContaining({ id: 10000005, dateTo: '2026-07-10', registered: 2, attended: 1 })
    ]);
  });

  it('refuses every browser: the key lists no websites', async () => {
    const { status, body } = await call(listEvents, '/api/v1/events', ok(), {
      origin: 'https://www.jtc.ch'
    });
    expect(status).toBe(403);
    expect(body.error.code).toBe('origin_not_allowed');
  });

  it('answers 401 without a key or for a key without the scope', async () => {
    const rpc = ok();
    expect((await call(listEvents, '/api/v1/events', rpc, { auth: null })).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    const none = rpcReturning({ data: null, error: null });
    expect((await call(listEvents, '/api/v1/events', none)).status).toBe(401);
  });

  it('answers 400 for a bad period and 503 when the database fails', async () => {
    expect((await call(listEvents, '/api/v1/events?from=x', ok())).status).toBe(400);
    const down = rpcReturning(new Error('timeout'));
    expect((await call(listEvents, '/api/v1/events', down)).status).toBe(503);
  });
});

describe('GET /api/v1/events/{id}/participants', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const ok = () =>
    rpcReturning({ data: { allowed_origins: [], event, participants }, error: null });
  const path = '/api/v1/events/10000005/participants';

  it('lists who took part', async () => {
    const rpc = ok();
    const { status, headers, body } = await call(listParticipants, path, rpc, {
      params: { eventId: '10000005' }
    });
    expect(status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('api_event_participants', {
      p_key: key,
      p_event_id: 10000005
    });
    expect(headers.get('cache-control')).toBe('no-store');
    expect(body.event).toEqual(expect.objectContaining({ id: 10000005, title: 'Sommerlager' }));
    expect(body.participants.map((p: { lastname: string }) => p.lastname)).toEqual([
      'Muster',
      'Beispiel'
    ]);
  });

  it('only who attended with attended=true', async () => {
    const { body } = await call(listParticipants, `${path}?attended=true`, ok(), {
      params: { eventId: '10000005' }
    });
    expect(body.participants).toEqual([expect.objectContaining({ memberId: 1 })]);
  });

  it('answers 404 for an unknown event', async () => {
    const rpc = rpcReturning({ data: { allowed_origins: [], event: null }, error: null });
    const { status, body } = await call(listParticipants, path, rpc, {
      params: { eventId: '10000005' }
    });
    expect(status).toBe(404);
    expect(body.error.code).toBe('not_found');
  });

  it('refuses every browser, even for a valid key', async () => {
    const { status, body } = await call(listParticipants, path, ok(), {
      params: { eventId: '10000005' },
      origin: 'https://evil.example'
    });
    expect(status).toBe(403);
    expect(JSON.stringify(body)).not.toContain('Muster');
  });

  it('answers 400 for a bad id or filter without asking the database', async () => {
    const rpc = ok();
    const bad = await call(listParticipants, '/api/v1/events/abc/participants', rpc, {
      params: { eventId: 'abc' }
    });
    expect(bad.status).toBe(400);
    const filter = await call(listParticipants, `${path}?attended=yes`, rpc, {
      params: { eventId: '10000005' }
    });
    expect(filter.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('answers 401 for a key without the scope', async () => {
    const rpc = rpcReturning({ data: null, error: null });
    const { status } = await call(listParticipants, path, rpc, { params: { eventId: '1' } });
    expect(status).toBe(401);
  });
});
