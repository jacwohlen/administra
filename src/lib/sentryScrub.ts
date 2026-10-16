/**
 * Removes secrets and personal data from error reports before they are sent
 * to Sentry (see docs/ERROR_MONITORING.md):
 *
 * - values of sensitive query parameters (?code= from the OAuth callback,
 *   ?email= on the login page, tokens, ...),
 * - e-mail addresses anywhere.
 *
 * It walks every string in the event, so URLs in error messages, breadcrumbs
 * and request headers (e.g. Referer) are covered too.
 */

// Also at the very start: Sentry sends the query string separately, without "?".
const SECRET_PARAM =
  /(^|[?&#])((?:token|token_hash|code|access_token|refresh_token|email|password)=)[^&#\s"']+/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function scrubText(text: string): string {
  return text.replace(SECRET_PARAM, '$1$2[Filtered]').replace(EMAIL, '[email]');
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
