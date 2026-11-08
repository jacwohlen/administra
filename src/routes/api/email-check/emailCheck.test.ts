import { describe, expect, it, vi } from 'vitest';

const domainReceivesMail = vi.fn().mockResolvedValue(true);
vi.mock('#lib/server/emailDomain.ts', () => ({ domainReceivesMail }));

const { POST } = await import('./+server');

async function check(body: string) {
  const request = new Request('http://localhost/api/email-check', { method: 'POST', body });
  const response = await POST({ request } as unknown as Parameters<typeof POST>[0]);
  return { status: response.status, ...((await response.json()) as { ok: boolean }) };
}

describe('POST /api/email-check', () => {
  it('accepts an address whose domain receives mail', async () => {
    expect(await check(JSON.stringify({ email: 'lara@bluewin.ch' }))).toEqual({
      status: 200,
      ok: true
    });
    expect(domainReceivesMail).toHaveBeenLastCalledWith('bluewin.ch');
  });

  it('refuses a malformed address without a lookup', async () => {
    domainReceivesMail.mockClear();
    expect((await check(JSON.stringify({ email: 'rolli@bluewin.ch.ch' }))).ok).toBe(false);
    expect((await check(JSON.stringify({ email: 42 }))).ok).toBe(false);
    expect(domainReceivesMail).not.toHaveBeenCalled();
  });

  it('refuses a domain without mail servers', async () => {
    domainReceivesMail.mockResolvedValueOnce(false);
    expect((await check(JSON.stringify({ email: 'lara@firma.chh' }))).ok).toBe(false);
  });

  it('answers 400 for a body that is not JSON', async () => {
    expect(await check('nope')).toEqual({ status: 400, ok: false });
  });
});
