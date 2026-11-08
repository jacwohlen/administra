import { resolve4, resolve6, resolveMx } from 'node:dns/promises';

/**
 * Whether the domain of an e-mail address can receive mail, checked in DNS:
 * an MX record, or (RFC 5321 §5.1) an A/AAAA record when there is no MX.
 *
 * Answers false only when DNS says for sure that nothing receives mail there
 * (the domain does not exist, or has neither MX nor address records, or
 * publishes a "null MX"). Any other DNS trouble, or no answer within
 * `timeoutMs`, answers true: a registration is never refused because the
 * lookup itself failed.
 */
export async function domainReceivesMail(domain: string, timeoutMs = 3000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(true), timeoutMs);
  });
  try {
    return await Promise.race([lookup(domain), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** DNS error codes that mean "no such record", as opposed to a failed lookup. */
const NOT_FOUND = new Set(['ENOTFOUND', 'ENODATA']);

function isNotFound(e: unknown): boolean {
  return NOT_FOUND.has((e as { code?: string } | null)?.code ?? '');
}

async function lookup(domain: string): Promise<boolean> {
  try {
    const records = await resolveMx(domain);
    // RFC 7505 null MX: the domain says it accepts no mail.
    if (records.length > 0 && records.every((r) => r.exchange === '' || r.exchange === '.')) {
      return false;
    }
    if (records.length > 0) return true;
  } catch (e) {
    if (!isNotFound(e)) return true;
    if ((e as { code?: string }).code === 'ENOTFOUND') return false;
  }
  // No MX: the address records stand in for it.
  const results = await Promise.allSettled([resolve4(domain), resolve6(domain)]);
  if (results.some((r) => r.status === 'fulfilled' && r.value.length > 0)) return true;
  return !results.every((r) => r.status === 'rejected' && isNotFound(r.reason));
}
