/**
 * Removes secrets and personal data from error reports before they are sent
 * to Sentry (see docs/ERROR_MONITORING.md):
 *
 * - values of sensitive query parameters (?code= from the OAuth callback,
 *   ?email= on the login page, tokens, ...),
 * - capability tokens in URL paths: whoever knows
 *   /probetraining/status/<token> can see and cancel that trial
 *   registration, so the token becomes "[token]",
 * - e-mail addresses anywhere.
 *
 * It walks every string in the event, so URLs in error messages, breadcrumbs,
 * transaction names, spans and request headers (e.g. Referer) are covered too.
 */

// Also at the very start: Sentry sends the query string separately, without "?".
const SECRET_PARAM =
  /(^|[?&#])((?:token|token_hash|code|access_token|refresh_token|provider_token|provider_refresh_token|email|password|apikey)=)[^&#\s"']+/gi;

// Routes whose last path segment is a secret token. The separator may be
// URL-encoded ("%2F"), e.g. inside a ?next= parameter.
const TOKEN_PATH = /(\/|%2F)(probetraining(?:\/|%2F)status(?:\/|%2F))[^/?#\s"'&%]+/gi;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function scrubText(text: string): string {
  return text
    .replace(SECRET_PARAM, '$1$2[Filtered]')
    .replace(TOKEN_PATH, '$1$2[token]')
    .replace(EMAIL, '[email]');
}

/** Scrubs all strings in the event in place and returns it. */
export function scrubEvent<T>(event: T): T {
  scrubValue(event, new WeakSet());
  return event;
}

function scrubValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    // SDK-internal data that is never sent as is
    if (key === 'sdkProcessingMetadata') continue;
    record[key] = scrubValue(record[key], seen);
  }
  return value;
}
