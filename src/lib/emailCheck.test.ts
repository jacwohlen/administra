import { describe, expect, it, vi } from 'vitest';
import { checkEmail, emailReachable } from './emailCheck';

describe('checkEmail', () => {
  it('passes a plain address', () => {
    expect(checkEmail(' lara@bluewin.ch ')).toEqual({ result: 'ok' });
  });

  it('refuses an invalid address, with a fix when there is one', () => {
    expect(checkEmail('rolli@bluewin.ch.ch')).toEqual({
      result: 'invalid',
      suggestion: 'rolli@bluewin.ch'
    });
    expect(checkEmail('lara@gmail')).toEqual({ result: 'invalid', suggestion: null });
  });

  it('asks about a likely typo once', () => {
    expect(checkEmail('lara@gmial.com')).toEqual({
      result: 'suggest',
      suggestion: 'lara@gmail.com'
    });
    expect(checkEmail('lara@gmial.com', 'lara@gmial.com')).toEqual({ result: 'ok' });
  });
});

describe('emailReachable', () => {
  const answer = (body: unknown, status = 200) =>
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

  it('follows the server', async () => {
    expect(await emailReachable('lara@firma.chh', answer({ ok: false }))).toBe(false);
    expect(await emailReachable('lara@bluewin.ch', answer({ ok: true }))).toBe(true);
  });

  it('never blocks when the server cannot tell', async () => {
    expect(await emailReachable('lara@bluewin.ch', answer({}, 500))).toBe(true);
    expect(await emailReachable('lara@bluewin.ch', vi.fn().mockRejectedValue(new Error()))).toBe(
      true
    );
  });
});
