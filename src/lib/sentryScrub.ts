/**
 * Removes secrets and personal data from error reports before they are sent
 * to Sentry (see docs/ERROR_MONITORING.md):
 *
 * - values of sensitive query parameters (?code= from the OAuth callback,
 *   ?email= on the login page, tokens, ...),
 * - capability tokens in URL paths: whoever knows
 *   /probetraining/status/<token> can see and cancel that trial
 *   registration, whoever knows /api/calendar/<token>/<feed>.ics can read
 *   the training plan, so the token becomes "[token]",
 * - e-mail addresses anywhere.
 *
 * It walks every string in the event, so URLs in error messages, breadcrumbs,
 * transaction names, spans and request headers (e.g. Referer) are covered too.
 */

// Also at the very start: Sentry sends the query string separately, without "?".
const SECRET_PARAM =
  /(^|[?&#])((?:token|token_hash|code|access_token|refresh_token|provider_token|provider_refresh_token|email|password|apikey)=)[^&#\s"']+/gi;

// Routes with a secret token as the path segment after these prefixes. The
// separator may be URL-encoded ("%2F"), e.g. inside a ?next= parameter.
const TOKEN_PATH =
  /(\/|%2F)((?:probetraining(?:\/|%2F)status|api(?:\/|%2F)calendar)(?:\/|%2F))[^/?#\s"'&%]+/gi;

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

// Query parameters whose values say which data a request reads, never whose:
// PostgREST's column list, sort order and paging
const KEPT_QUERY_PARAMS = new Set(['select', 'order', 'limit', 'offset', 'columns']);

const QUERY_PARAM = /([?&])([^=&#\s"']+)=([^&#\s"']*)/g;

/**
 * Replaces the value of every query parameter but `select`, `order`, `limit`
 * and `offset` with "[Filtered]". Supabase's filters are query parameters
 * (`?name=ilike.*Muster*`, `?email=eq.…`), so a request URL in a trace span
 * would otherwise carry a member's name; the column names stay, they tell
 * which query was slow.
 */
export function filterQueryValues(text: string): string {
  return text.replace(QUERY_PARAM, (match, sep: string, key: string) =>
    KEPT_QUERY_PARAMS.has(decodeURIComponentSafe(key)) ? match : `${sep}${key}=[Filtered]`
  );
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * `beforeSendTransaction`: like scrubEvent, and the query values of every URL
 * in the transaction and its spans are filtered (filterQueryValues).
 */
export function scrubTransaction<T>(event: T): T {
  filterValue(event, new WeakSet(), '');
  return scrubEvent(event);
}

function filterValue(value: unknown, seen: WeakSet<object>, key: string): unknown {
  if (typeof value === 'string') {
    // Sentry keeps the query string without "?" in its own attribute too
    if (/query/i.test(key) && !value.startsWith('?')) {
      return filterQueryValues(`?${value}`).slice(1);
    }
    return filterQueryValues(value);
  }
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  const record = value as Record<string, unknown>;
  for (const k of Object.keys(record)) {
    if (k === 'sdkProcessingMetadata') continue;
    record[k] = filterValue(record[k], seen, k);
  }
  return value;
}
