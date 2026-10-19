/**
 * Security headers for every page and API response, set in
 * src/hooks.server.ts. Static files (served by Netlify's CDN, not by the
 * function) get the same basic headers from netlify.toml. The content
 * policy (Content-Security-Policy-Report-Only) is `kit.csp` in
 * svelte.config.js. See docs/SECURITY_HEADERS.md.
 */

/**
 * Public pages the club website may embed (e.g. the trial registration
 * form in an iframe), together with their status page.
 */
const EMBEDDABLE_BY_CLUB_SITE = /^\/probetraining(\/|$)/;

const PERMISSIONS_POLICY = [
  // Profile photos use a file input (capture="user"), which needs no
  // camera permission.
  'camera=()',
  'microphone=()',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'browsing-topics=()'
].join(', ');

/** Headers shared with static files (netlify.toml has the same values). */
export const BASE_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': PERMISSIONS_POLICY
};

/** The club website's origin plus its www/non-www twin. */
export function clubSiteOrigins(clubUrl: string | null | undefined): string[] {
  let url: URL;
  try {
    url = new URL(clubUrl ?? '');
  } catch {
    return [];
  }
  if (url.protocol !== 'https:') return [];
  const host = url.host.startsWith('www.') ? url.host.slice(4) : url.host;
  return [`https://${host}`, `https://www.${host}`];
}

/** Who may show `pathname` in a frame (CSP frame-ancestors). */
export function frameAncestors(pathname: string, clubUrl: string | null | undefined): string {
  const sources = ["'self'"];
  if (EMBEDDABLE_BY_CLUB_SITE.test(pathname)) {
    for (const origin of clubSiteOrigins(clubUrl)) {
      if (!sources.includes(origin)) sources.push(origin);
    }
  }
  return `frame-ancestors ${sources.join(' ')}`;
}

/** Adds the security headers to a response from the SvelteKit server. */
export function addSecurityHeaders(
  headers: Headers,
  pathname: string,
  clubUrl: string | null | undefined
): void {
  try {
    for (const [name, value] of Object.entries(BASE_HEADERS)) {
      if (!headers.has(name)) headers.set(name, value);
    }
    // Appended: should kit.csp ever enforce a policy as well, the browser
    // applies both.
    headers.append('Content-Security-Policy', frameAncestors(pathname, clubUrl));
  } catch {
    // Responses passed through from fetch() have immutable headers
  }
}
