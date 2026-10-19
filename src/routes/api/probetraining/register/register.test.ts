import { describe, expect, it, vi } from 'vitest';

const sendMail = vi.fn();
vi.mock('$lib/server/mailer', () => ({ sendMail }));
vi.mock('$lib/server/trialMailContext', () => ({ loadMailSettings: vi.fn() }));

const { POST } = await import('./+server');

const registration = {
  firstname: 'Lara',
  lastname: 'Meier',
  birthday: '1990-11-03',
  email: 'lara.meier@example.com'
};

async function call(rpcResult: { data?: unknown; error: unknown; status?: number }) {
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  const request = new Request('http://localhost/api/probetraining/register', {
    method: 'POST',
    body: JSON.stringify(registration)
  });
  try {
    await POST({
      request,
      locals: { supabase: { rpc } },
      url: new URL(request.url)
    } as unknown as Parameters<typeof POST>[0]);
  } catch (e) {
    return e as { status: number; body: { message: string } };
  }
  throw new Error('expected the request to fail');
}

describe('POST /api/probetraining/register errors', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});

  it('answers 429 when register_trial hits a rate limit', async () => {
    const result = await call({
      error: { code: 'PT429', message: 'too many registrations for this email' },
      status: 429
    });
    expect(result.status).toBe(429);
    expect(result.body.message).not.toContain('email');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('answers 400 for invalid input without the database message', async () => {
    const result = await call({ error: { code: '22023', message: 'invalid name' }, status: 400 });
    expect(result.status).toBe(400);
    expect(result.body.message).not.toContain('invalid name');
  });

  it('answers 500 without leaking the database message', async () => {
    const result = await call({
      error: { code: '42501', message: 'permission denied for table members' },
      status: 403
    });
    expect(result.status).toBe(500);
    expect(result.body.message).not.toContain('permission');
  });
});
