import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The mailer's guards (src/lib/server/mailer.ts). PUBLIC_MODE is a static
 * import and the transporter is cached per module, so each test loads the
 * module afresh with its own mode and a fake nodemailer.
 */

const SMTP = {
  PRIVATE_SMTP_HOST: 'smtp.test.ch',
  PRIVATE_SMTP_FROM: 'Club <club@test.ch>'
};

const env: Record<string, string | undefined> = {};
const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ sendMail }));

vi.mock('$env/dynamic/private', () => ({ env }));
vi.mock('nodemailer', () => ({ default: { createTransport } }));

async function load(mode: string, smtp: Record<string, string> | null = SMTP) {
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, smtp ?? {});
  vi.resetModules();
  vi.doMock('$env/static/public', () => ({ PUBLIC_MODE: mode }));
  return import('./mailer');
}

const mail = { to: 'max@test.ch', subject: 'Betreff', text: 'Hallo', replyTo: 'tk@test.ch' };

afterEach(() => {
  vi.doUnmock('$env/static/public');
  sendMail.mockReset();
  createTransport.mockClear();
  vi.restoreAllMocks();
});

describe('sendMail', () => {
  it('never sends in the demo, SMTP or not', async () => {
    const mailer = await load('DEMO');
    expect(await mailer.sendMail(mail)).toEqual({
      status: 'skipped',
      error: 'Demo: no mail is sent',
      reason: 'demo'
    });
    expect(createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('skips the sync’s anonymized .invalid addresses', async () => {
    const mailer = await load('PROD');
    expect(await mailer.sendMail({ ...mail, to: 'X@EXAMPLE.INVALID ' })).toEqual({
      status: 'skipped',
      error: 'Address cannot receive mail (.invalid)',
      reason: 'invalid_address'
    });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('skips without SMTP settings', async () => {
    const mailer = await load('PROD', null);
    expect(await mailer.sendMail(mail)).toEqual({
      status: 'skipped',
      error: 'SMTP is not configured',
      reason: 'not_configured'
    });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('sends through the SMTP server, with the reply address when there is one', async () => {
    const mailer = await load('PROD');
    sendMail.mockResolvedValue({});
    expect(await mailer.sendMail(mail)).toEqual({ status: 'sent' });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.test.ch', port: 587, requireTLS: true })
    );
    expect(sendMail).toHaveBeenCalledWith({
      from: 'Club <club@test.ch>',
      to: 'max@test.ch',
      replyTo: 'tk@test.ch',
      subject: 'Betreff',
      text: 'Hallo'
    });

    await mailer.sendMail({ ...mail, replyTo: '' });
    expect(sendMail.mock.calls[1][0].replyTo).toBeUndefined();
    await mailer.sendMail({ ...mail, replyTo: null });
    expect(sendMail.mock.calls[2][0].replyTo).toBeUndefined();
  });

  it('reports a failure without the addresses the server quotes', async () => {
    const mailer = await load('PROD');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    sendMail.mockRejectedValue(new Error('550 <max@test.ch> rejected'));
    const result = await mailer.sendMail(mail);
    expect(result).toEqual({ status: 'failed', error: '550 <[email]> rejected' });
    expect(JSON.stringify(logged.mock.calls)).not.toContain('max@test.ch');
    expect(logged).toHaveBeenCalled();
  });
});

describe('mailMode', () => {
  it('is demo in the demo, whatever the SMTP settings', async () => {
    expect((await load('DEMO')).mailMode()).toBe('demo');
    expect((await load('DEMO', null)).mailMode()).toBe('demo');
  });

  it('is smtp when configured, else off', async () => {
    expect((await load('PROD')).mailMode()).toBe('smtp');
    expect((await load('DEV', null)).mailMode()).toBe('off');
    expect((await load('PROD', { PRIVATE_SMTP_HOST: 'smtp.test.ch' })).mailMode()).toBe('off');
  });

  it('lets plan mails leave only in production; elsewhere with SMTP they are simulated', async () => {
    expect((await load('PROD')).planMailMode()).toBe('smtp');
    expect((await load('DEV')).planMailMode()).toBe('test');
    expect((await load('')).planMailMode()).toBe('test');
    expect((await load('DEMO')).planMailMode()).toBe('demo');
    expect((await load('DEV', null)).planMailMode()).toBe('off');
    expect((await load('PROD', null)).planMailMode()).toBe('off');
    // Trial mails on Dev still go out
    expect((await load('DEV')).mailMode()).toBe('smtp');
  });

  it('knows undeliverable addresses', async () => {
    const mailer = await load('PROD');
    expect(mailer.isUndeliverable(' member-1@example.invalid ')).toBe(true);
    expect(mailer.isUndeliverable('max@invalid.ch')).toBe(false);
  });
});
