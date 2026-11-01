import { describe, expect, it, vi } from 'vitest';
import { loadNotifyMode, postNotify } from './trainingPlanMailClient';
import type { NotifyRequest } from './trainingPlanMail';

const URL = '/api/training-plan/notify';

/** A fetch answering once with the status and body (undefined: not JSON) */
function answering(status: number, body?: unknown) {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(body === undefined ? '<html>Bad Gateway</html>' : JSON.stringify(body), {
        status
      })
  );
}

const failing = () =>
  vi.fn<typeof fetch>(async () => {
    throw new TypeError('Failed to fetch');
  });

describe('loadNotifyMode', () => {
  it('asks the endpoint and takes its answer', async () => {
    for (const mode of ['smtp', 'demo', 'test', 'off'] as const) {
      const fetchFn = answering(200, { mode });
      expect(await loadNotifyMode(fetchFn)).toBe(mode);
      expect(fetchFn).toHaveBeenCalledWith(URL, { headers: { accept: 'application/json' } });
    }
  });

  it('is off for anything else', async () => {
    expect(await loadNotifyMode(answering(200, { mode: 'SMTP' }))).toBe('off');
    expect(await loadNotifyMode(answering(200, {}))).toBe('off');
    expect(await loadNotifyMode(answering(200, null))).toBe('off');
    expect(await loadNotifyMode(answering(200))).toBe('off');
    expect(await loadNotifyMode(answering(401, { code: 'not_signed_in' }))).toBe('off');
    expect(await loadNotifyMode(answering(500, { mode: 'smtp' }))).toBe('off');
    expect(await loadNotifyMode(failing())).toBe('off');
  });
});

describe('postNotify', () => {
  const body: NotifyRequest = {
    action: 'send',
    memberIds: [3, 4],
    fingerprint: '0123456789abcd',
    locale: 'de'
  };

  it('posts the request as JSON', async () => {
    const fetchFn = answering(200, { status: 'sent', simulated: false, toldSaved: true });
    expect(await postNotify(body, fetchFn)).toEqual({
      ok: true,
      status: 'sent',
      simulated: false,
      toldSaved: true
    });
    expect(fetchFn).toHaveBeenCalledWith(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body)
    });
  });

  it('passes on every result status with its error', async () => {
    expect(
      await postNotify(
        body,
        answering(200, {
          status: 'failed',
          simulated: false,
          toldSaved: false,
          error: '550 rejected'
        })
      )
    ).toEqual({
      ok: true,
      status: 'failed',
      simulated: false,
      toldSaved: false,
      error: '550 rejected'
    });
    expect(
      await postNotify(
        body,
        answering(200, {
          status: 'skipped',
          simulated: true,
          toldSaved: true,
          error: 'Demo: no mail is sent'
        })
      )
    ).toEqual({
      ok: true,
      status: 'skipped',
      simulated: true,
      toldSaved: true,
      error: 'Demo: no mail is sent'
    });
    expect(
      await postNotify(
        { ...body, action: 'mark' },
        answering(200, { status: 'marked', toldSaved: true })
      )
    ).toEqual({ ok: true, status: 'marked', simulated: false, toldSaved: true });
  });

  it('takes only true as true and only a text as the error', async () => {
    expect(
      await postNotify(
        body,
        answering(200, { status: 'sent', simulated: 'yes', toldSaved: 1, error: 5 })
      )
    ).toEqual({ ok: true, status: 'sent', simulated: false, toldSaved: false });
  });

  it('tells the known failures apart by their code', async () => {
    expect(await postNotify(body, answering(409, { code: 'stale' }))).toEqual({
      ok: false,
      code: 'stale',
      httpStatus: 409
    });
    expect(await postNotify(body, answering(403, { code: 'not_allowed' }))).toEqual({
      ok: false,
      code: 'not_allowed',
      httpStatus: 403
    });
    expect(await postNotify(body, answering(503, { code: 'mail_off' }))).toEqual({
      ok: false,
      code: 'mail_off',
      httpStatus: 503
    });
  });

  it('reads a bare 502/504 as a timeout: the mail may have left', async () => {
    expect(await postNotify(body, answering(502))).toEqual({
      ok: false,
      code: 'timeout',
      httpStatus: 502
    });
    expect(await postNotify(body, answering(504))).toEqual({
      ok: false,
      code: 'timeout',
      httpStatus: 504
    });
    // A known code wins over the status
    expect(await postNotify(body, answering(504, { code: 'load_failed' }))).toEqual({
      ok: false,
      code: 'load_failed',
      httpStatus: 504
    });
  });

  it('calls anything else failed or network', async () => {
    expect(await postNotify(body, answering(500, { message: 'Internal Error' }))).toEqual({
      ok: false,
      code: 'failed',
      httpStatus: 500
    });
    expect(await postNotify(body, answering(400, { code: 'something_new' }))).toEqual({
      ok: false,
      code: 'failed',
      httpStatus: 400
    });
    expect(await postNotify(body, answering(200, { status: 'queued' }))).toEqual({
      ok: false,
      code: 'failed',
      httpStatus: 200
    });
    expect(await postNotify(body, answering(200))).toEqual({
      ok: false,
      code: 'failed',
      httpStatus: 200
    });
    expect(await postNotify(body, failing())).toEqual({ ok: false, code: 'network' });
  });
});
