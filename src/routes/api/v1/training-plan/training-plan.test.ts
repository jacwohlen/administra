import { describe, expect, it, vi } from 'vitest';
import { GET, OPTIONS } from './+server';

const key = 'alleda_' + '0123456789abcdef'.repeat(3);

const plan = {
  allowed_origins: ['https://www.jtc.ch'],
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
  trainers: [{ id: 12, name: 'Anna Muster' }]
};

/** rpc() as the Supabase builder: awaited through abortSignal() */
function rpcReturning(result: { data?: unknown; error: unknown } | Error) {
  const abortSignal = vi.fn(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
  );
  return vi.fn(() => ({ abortSignal }));
}

async function call(
  opts: { query?: string; auth?: string | null; origin?: string } = {},
  rpc = rpcReturning({ data: plan, error: null })
) {
  const url = new URL(`https://admin.example/api/v1/training-plan${opts.query ?? ''}`);
  const headers = new Headers();
  const auth = opts.auth === undefined ? `Bearer ${key}` : opts.auth;
  if (auth) headers.set('authorization', auth);
  if (opts.origin) headers.set('origin', opts.origin);
  const response = await GET({
    url,
    request: new Request(url, { headers }),
    locals: { supabase: { rpc } }
  } as unknown as Parameters<typeof GET>[0]);
  return { status: response.status, headers: response.headers, body: await response.json(), rpc };
}

describe('GET /api/v1/training-plan', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});

  it('answers the plan for a server (no origin)', async () => {
    const { status, headers, body, rpc } = await call({ query: '?from=2026-11-02&to=2026-11-08' });
    expect(status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('api_training_plan', {
      p_key: key,
      p_from: '2026-11-02',
      p_to: '2026-11-08'
    });
    expect(headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(headers.get('cache-control')).toBe('private, max-age=300');
    expect(headers.get('access-control-allow-origin')).toBeNull();
    expect(body.sessions).toEqual([
      expect.objectContaining({ date: '2026-11-04', trainer: 'Anna Muster', cancelled: false })
    ]);
    expect(JSON.stringify(body)).not.toContain('jtc.ch');
  });

  it('lets an allowed website read it', async () => {
    const { status, headers } = await call({ origin: 'https://www.jtc.ch' });
    expect(status).toBe(200);
    expect(headers.get('access-control-allow-origin')).toBe('https://www.jtc.ch');
    expect(headers.get('vary')).toContain('Origin');
  });

  it('refuses another website', async () => {
    const { status, body } = await call({ origin: 'https://evil.example' });
    expect(status).toBe(403);
    expect(body).toEqual({ error: { code: 'origin_not_allowed', message: expect.any(String) } });
  });

  it.each([
    ['no key', null],
    ['a malformed key', 'Bearer alleda_123'],
    ['another scheme', `Basic ${key}`]
  ])('answers 401 for %s without asking the database', async (_, auth) => {
    const rpc = rpcReturning({ data: plan, error: null });
    const { status, headers, body } = await call({ auth }, rpc);
    expect(status).toBe(401);
    expect(headers.get('www-authenticate')).toContain('Bearer');
    expect(body.error.code).toBe('unauthorized');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('answers 401 for a key the database does not know', async () => {
    const { status, body } = await call({}, rpcReturning({ data: null, error: null }));
    expect(status).toBe(401);
    expect(body.error.code).toBe('unauthorized');
  });

  it('answers 400 for a bad period without asking the database', async () => {
    const rpc = rpcReturning({ data: plan, error: null });
    const { status, body } = await call({ query: '?from=2026-01-01&to=2028-01-01' }, rpc);
    expect(status).toBe(400);
    expect(body.error.code).toBe('invalid_request');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('answers 503 when the database fails', async () => {
    expect((await call({}, rpcReturning({ error: { message: 'down' } }))).status).toBe(503);
    expect((await call({}, rpcReturning(new Error('timeout')))).status).toBe(503);
  });
});

describe('OPTIONS /api/v1/training-plan', () => {
  it('lets a browser send the key', async () => {
    const request = new Request('https://admin.example/api/v1/training-plan', {
      method: 'OPTIONS',
      headers: { origin: 'https://www.jtc.ch', 'access-control-request-headers': 'authorization' }
    });
    const response = await OPTIONS({ request } as unknown as Parameters<typeof OPTIONS>[0]);
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://www.jtc.ch');
    expect(response.headers.get('access-control-allow-headers')).toBe('Authorization');
    expect(response.headers.get('access-control-allow-methods')).toContain('GET');
  });
});
