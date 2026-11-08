/**
 * E-mail address checks for public forms (the trial registration), shared by
 * the browser and the server.
 *
 * `isValidEmail()` is stricter than the browser's `type="email"`, which also
 * accepts `name@gmail` or `name@gmail..com`. `suggestEmail()` catches typos in
 * common mail domains (`gmail.con`, `bluewin.ch` written `bluwin.ch`) that are
 * valid syntax but cannot reach anyone, and an ending typed twice
 * (`bluewin.ch.ch`), which both refuse. Whether a domain receives mail at all
 * is checked on the server only (`#lib/server/emailDomain.ts`).
 */

/** Characters allowed in the part before the @ (RFC 5322 atoms, plus letters of any script). */
const LOCAL_PART = /^[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+(\.[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+)*$/u;
/** One domain label: letters and digits, hyphens only inside. */
const DOMAIN_LABEL = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?$/u;
/** Top-level domain: at least two letters, or an IDN in punycode. */
const TOP_LEVEL_DOMAIN = /^(?:\p{L}{2,63}|xn--[a-z0-9-]{1,59})$/iu;

/** Splits an address at its last @; null when there is none. */
function splitEmail(email: string): { local: string; domain: string } | null {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  return { local: email.slice(0, at), domain: email.slice(at + 1) };
}

/** The domain of an address, lower case; null for an invalid address. */
export function emailDomain(email: string): string | null {
  if (!isValidEmail(email)) return null;
  return splitEmail(email.trim())!.domain.toLowerCase();
}

/** Whether `email` (trimmed) looks like an address that can receive mail. */
export function isValidEmail(email: string): boolean {
  const value = email.trim();
  if (value.length > 254) return false;
  const parts = splitEmail(value);
  if (!parts || parts.local.includes('@')) return false;
  if (parts.local.length > 64 || !LOCAL_PART.test(parts.local)) return false;
  const labels = parts.domain.split('.');
  if (labels.length < 2 || !labels.every((label) => DOMAIN_LABEL.test(label))) return false;
  if (hasRepeatedTopLevel(labels)) return false;
  return TOP_LEVEL_DOMAIN.test(labels[labels.length - 1]);
}

/** `bluewin.ch.ch`, `gmail.com.com`: the ending typed twice (`ch.ch` alone is a real domain). */
function hasRepeatedTopLevel(labels: string[]): boolean {
  const n = labels.length;
  return n >= 3 && labels[n - 1].toLowerCase() === labels[n - 2].toLowerCase();
}

/** Mail domains people in Switzerland use most; a near miss of one is likely a typo. */
const COMMON_DOMAINS = [
  'gmail.com',
  'googlemail.com',
  'bluewin.ch',
  'gmx.ch',
  'gmx.net',
  'gmx.de',
  'gmx.at',
  'hotmail.com',
  'hotmail.ch',
  'hotmail.de',
  'hotmail.fr',
  'hotmail.it',
  'outlook.com',
  'outlook.de',
  'live.com',
  'live.de',
  'msn.com',
  'yahoo.com',
  'yahoo.de',
  'yahoo.fr',
  'icloud.com',
  'me.com',
  'mac.com',
  'sunrise.ch',
  'hispeed.ch',
  'swissonline.ch',
  'proton.me',
  'protonmail.com',
  'protonmail.ch',
  'web.de',
  'yandex.com',
  'aol.com'
];

/** Restricted Damerau-Levenshtein distance (swapped neighbours count as one edit). */
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/**
 * A corrected address when the domain of `email` is a near miss of a common
 * mail domain (`lara@gmial.com` → `lara@gmail.com`), else null. Only a hint:
 * the person decides whether to take it.
 */
export function suggestEmail(email: string): string | null {
  const value = email.trim();
  const parts = splitEmail(value);
  if (!parts) return null;
  let domain = parts.domain.toLowerCase();
  const labels = domain.split('.');
  const repeated = hasRepeatedTopLevel(labels);
  if (repeated) domain = labels.slice(0, -1).join('.');
  if (COMMON_DOMAINS.includes(domain)) return repeated ? `${parts.local}@${domain}` : null;

  let best: { domain: string; distance: number } | null = null;
  for (const candidate of COMMON_DOMAINS) {
    const distance = editDistance(domain, candidate);
    // Short domains like gmx.ch are one edit away from many real ones.
    const limit = candidate.length <= 7 ? 1 : 2;
    if (distance <= limit && (!best || distance < best.distance)) {
      best = { domain: candidate, distance };
    }
  }
  if (best) return `${parts.local}@${best.domain}`;
  return repeated ? `${parts.local}@${domain}` : null;
}
