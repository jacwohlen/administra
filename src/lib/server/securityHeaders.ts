/**
 * Security headers for every page and API response, set in
 * src/hooks.server.ts. Static files (served by Netlify's CDN, not by the
 * function) get the same basic headers from netlify.toml. The content
 * policy (Content-Security-Policy-Report-Only) is `kit.csp` in
 * svelte.config.js. See docs/SECURITY_HEADERS.md.
 */

const PERMISSIONS_POLICY = [
  // Profile photos use a file input (capture="user"), which needs no
  // camera permission.
  'camera=()',
  // Dictation in the Daten-Assistent (speech recognition), on the app's
  // own pages only, never in a frame of another site
  'microphone=(self)',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'browsing-topics=()'
].join(', ');

/** Headers shared with static files (netlify.toml has the same values). */
export const BASE_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': PERMISSIONS_POLICY,
  // No other site shows the app in a frame (the club website and the
  // Webling portal only link to it). Older browsers read this one.
  'X-Frame-Options': 'SAMEORIGIN'
};

/** Only the app itself may show its pages in a frame (clickjacking). */
export const FRAME_ANCESTORS = "frame-ancestors 'self'";

/** Adds the security headers to a response from the SvelteKit server. */
export function addSecurityHeaders(headers: Headers): void {
  try {
    for (const [name, value] of Object.entries(BASE_HEADERS)) {
      if (!headers.has(name)) headers.set(name, value);
    }
    // Appended: should kit.csp ever enforce a policy as well, the browser
    // applies both.
    headers.append('Content-Security-Policy', FRAME_ANCESTORS);
  } catch {
    // Responses passed through from fetch() have immutable headers
  }
}
