import { beforeEach, describe, expect, it, vi } from 'vitest';

const dns = vi.hoisted(() => ({ resolveMx: vi.fn(), resolve4: vi.fn(), resolve6: vi.fn() }));
vi.mock('node:dns/promises', () => ({ ...dns, default: dns }));

const { domainReceivesMail } = await import('./emailDomain');

const dnsError = (code: string) => Object.assign(new Error(code), { code });

describe('domainReceivesMail', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    dns.resolve4.mockRejectedValue(dnsError('ENODATA'));
    dns.resolve6.mockRejectedValue(dnsError('ENODATA'));
  });

  it('accepts a domain with an MX record', async () => {
    dns.resolveMx.mockResolvedValue([{ exchange: 'mx.bluewin.ch', priority: 10 }]);
    expect(await domainReceivesMail('bluewin.ch')).toBe(true);
  });

  it('refuses a domain that does not exist', async () => {
    dns.resolveMx.mockRejectedValue(dnsError('ENOTFOUND'));
    expect(await domainReceivesMail('gmail.con')).toBe(false);
  });

  it('refuses a null MX', async () => {
    dns.resolveMx.mockResolvedValue([{ exchange: '', priority: 0 }]);
    expect(await domainReceivesMail('example.com')).toBe(false);
  });

  it('accepts a domain without MX but with an address record', async () => {
    dns.resolveMx.mockRejectedValue(dnsError('ENODATA'));
    dns.resolve4.mockResolvedValue(['192.0.2.1']);
    expect(await domainReceivesMail('example.ch')).toBe(true);
  });

  it('refuses a domain with neither MX nor address records', async () => {
    dns.resolveMx.mockRejectedValue(dnsError('ENODATA'));
    expect(await domainReceivesMail('example.ch')).toBe(false);
  });

  it('accepts when the lookup fails or takes too long', async () => {
    dns.resolveMx.mockRejectedValue(dnsError('ETIMEOUT'));
    expect(await domainReceivesMail('example.ch')).toBe(true);
    dns.resolveMx.mockReturnValue(new Promise(() => {}));
    expect(await domainReceivesMail('example.ch', 10)).toBe(true);
  });
});
