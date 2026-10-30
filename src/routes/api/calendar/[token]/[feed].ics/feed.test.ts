import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadMailSettings = vi.fn();
vi.mock('$lib/server/trialMailContext', () => ({ loadMailSettings }));

const { GET } = await import('./+server');

const token = '0123456789abcdef'.repeat(4);

const plan = {
  member_ids: [12],
  trainings: [
    {
      id: 26,
      title: 'Judo Randori',
      weekday: 'Wednesday',
      dateFrom: '20:00',
      dateTo: '21:30',
      section: 'Judo',
      mainTrainerId: 12
    }
  ],
  sessions: [],
  breaks: [],
  trainers: [{ id: 12, firstname: 'Anna', lastname: 'Muster' }]
};

/** rpc() as the Supabase builder: awaited through abortSignal() */
function rpcReturning(result: { data?: unknown; error: unknown } | Error) {
  const abortSignal = vi.fn((signal: AbortSignal) => {
    expect(signal).toBeInstanceOf(AbortSignal);
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  });
  return { rpc: vi.fn(() => ({ abortSignal })), abortSignal };
}

async function call(
  params: { token: string; feed: string },
  rpc: ReturnType<typeof rpcReturning>['rpc'] = rpcReturning({ data: plan, error: null }).rpc
) {
  const url = new URL(`https://admin.example/api/calendar/${params.token}/${params.feed}.ics`);
  const response = await GET({
    params,
    url,
    request: new Request(url),
    locals: { supabase: { rpc } }
  } as unknown as Parameters<typeof GET>[0]);
  return { status: response.status, headers: response.headers, body: await response.text() };
}

describe('GET /api/calendar/[token]/[feed].ics', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    consoleError.mockClear();
    loadMailSettings.mockReset();
    loadMailSettings.mockResolvedValue({ club: { name: 'JAC Wohlen' }, values: {} });
  });

  it.each([
    ['too short', token.slice(1), 'alle'],
    ['upper case', token.toUpperCase(), 'alle'],
    ['not hex', 'g'.repeat(64), 'alle'],
    ['a UUID', '00000000-0000-4000-8000-000000000001', 'alle'],
    ['an unknown feed', token, 'trainings'],
    ['a feed in capitals', token, 'Alle']
  ])('answers 404 for %s without asking the database', async (_, t, feed) => {
    const { rpc } = rpcReturning({ data: plan, error: null });
    const { status, headers } = await call({ token: t, feed }, rpc);
    expect(status).toBe(404);
    expect(headers.get('cache-control')).toBe('private, no-store');
    expect(rpc).not.toHaveBeenCalled();
    expect(loadMailSettings).not.toHaveBeenCalled();
  });

  it('answers 404 when the token belongs to no staff account', async () => {
    const { rpc } = rpcReturning({ data: null, error: null });
    const { status, body } = await call({ token, feed: 'alle' }, rpc);
    expect(status).toBe(404);
    expect(body).not.toContain('BEGIN:VCALENDAR');
  });

  it('answers 503, never an empty calendar, when the database fails', async () => {
    for (const result of [
      { data: null, error: { code: '57014', message: 'canceling statement due to timeout' } },
      new Error('The operation was aborted due to timeout')
    ]) {
      const { rpc } = rpcReturning(result);
      const { status, headers, body } = await call({ token, feed: 'mine' }, rpc);
      expect(status).toBe(503);
      expect(headers.get('cache-control')).toBe('private, no-store');
      expect(body).not.toMatch(/VCALENDAR|canceling|timeout/);
      expect(body).not.toContain(token);
    }
    expect(consoleError).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(token);
  });

  it('serves the feed with the token sent in the RPC body', async () => {
    const { rpc, abortSignal } = rpcReturning({ data: plan, error: null });
    const { status, headers, body } = await call({ token, feed: 'alle' }, rpc);
    expect(rpc).toHaveBeenCalledWith('calendar_feed', { p_token: token });
    expect(abortSignal).toHaveBeenCalledOnce();
    expect(status).toBe(200);
    expect(headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    expect(headers.get('content-disposition')).toBe('inline; filename="alle.ics"');
    expect(headers.get('cache-control')).toBe('private, no-store');
    expect(headers.get('x-robots-tag')).toBe('noindex');
    expect(body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(body).toContain('\r\nX-WR-CALNAME:Alle Trainings (JAC Wohlen)\r\n');
    expect(body).toContain('\r\nBEGIN:VEVENT\r\n');
    expect(body).toMatch(/\r\nUID:all-26-\d{8}@admin\.example\r\n/);
    expect(body).toContain('SUMMARY:Judo Randori – Anna Muster');
    expect(body).not.toContain(token);
  });

  it('takes kind and language from the feed name', async () => {
    const { body, headers } = await call({ token, feed: 'mine' });
    expect(headers.get('content-disposition')).toBe('inline; filename="mine.ics"');
    expect(body).toContain('\r\nX-WR-CALNAME:My trainings (JAC Wohlen)\r\n');
    expect(body).toMatch(/\r\nUID:mine-26-\d{8}@admin\.example\r\n/);
    expect(body).toContain('\r\nTRANSP:OPAQUE\r\n');
  });

  it('serves the feed without the club name when the settings fail', async () => {
    loadMailSettings.mockRejectedValue(new Error('settings unavailable'));
    const { status, body } = await call({ token, feed: 'meine' });
    expect(status).toBe(200);
    expect(body).toContain('\r\nX-WR-CALNAME:Meine Trainings\r\n');
    expect(body).toContain('\r\nBEGIN:VEVENT\r\n');
  });
});
