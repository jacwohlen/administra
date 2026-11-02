import type { RequestHandler } from '@sveltejs/kit';
import { apiError, apiJson, originAllowed } from '#lib/server/api.ts';
import { bearerKey, buildApiEvents, parseEventsQuery, type ApiEventsData } from '#lib/publicApi.ts';

/**
 * GET /api/v1/events?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * The events overlapping a period with their counts, so a program (a
 * report writer) finds the id for /api/v1/events/{id}/participants
 * (docs/API.md). Needs an API key with event_participants:read; such a key
 * is for servers only (it lists no websites, so any browser is refused).
 */

export const GET: RequestHandler = async ({ request, url, locals }) => {
  const origin = request.headers.get('origin');

  const key = bearerKey(request.headers.get('authorization'));
  if (!key) {
    return apiError(401, 'unauthorized', 'An API key is required (Authorization: Bearer).', origin);
  }

  const parsed = parseEventsQuery(url.searchParams, new Date());
  if (!parsed.ok) return apiError(400, 'invalid_request', parsed.message, origin);
  const { query } = parsed;

  let data: ApiEventsData | null;
  try {
    const { data: result, error } = await locals.supabase
      .rpc('api_events', { p_key: key, p_from: query.from, p_to: query.to })
      .abortSignal(AbortSignal.timeout(10000));
    if (error) throw error;
    data = result as ApiEventsData | null;
  } catch (e) {
    console.error('api_events failed:', e);
    return apiError(503, 'unavailable', 'The events are temporarily unavailable.', origin);
  }
  if (!data) {
    return apiError(401, 'unauthorized', 'Unknown API key, or not for events.', origin);
  }
  if (!originAllowed(origin, data.allowed_origins ?? [])) {
    return apiError(403, 'origin_not_allowed', 'This API key is for servers only.', origin);
  }

  // Personal data nearby: no caching anywhere
  return apiJson(buildApiEvents(data, query), { corsOrigin: origin });
};
