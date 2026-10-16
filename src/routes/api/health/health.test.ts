import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

function locals(result: { error: unknown } | Error) {
  const query = {
    select: () => query,
    limit: () => query,
    abortSignal: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result))
  };
  return { supabase: { from: () => query } };
}

async function call(result: { error: unknown } | Error) {
  const response = await GET({ locals: locals(result) } as unknown as Parameters<typeof GET>[0]);
  return { status: response.status, body: await response.json(), headers: response.headers };
}

describe('GET /api/health', () => {
  it('answers ok when the database responds', async () => {
    const { status, body, headers } = await call({ error: null });
    expect(status).toBe(200);
    expect(body).toEqual({ status: 'ok' });
    expect(headers.get('cache-control')).toBe('no-store');
  });

  it('answers 503 without details when the query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await call({ error: { message: 'permission denied' } })).toMatchObject({
      status: 503,
      body: { status: 'error' }
    });
    expect(await call(new Error('timeout'))).toMatchObject({
      status: 503,
      body: { status: 'error' }
    });
  });
});
