import type { RequestHandler } from '@sveltejs/kit';
import { apiError, apiJson, originAllowed } from '#lib/server/api.ts';
import {
  bearerKey,
  buildApiEventParticipants,
  parseAttendedFilter,
  parseEventId,
  type ApiEventParticipantsData
} from '#lib/publicApi.ts';

/**
 * GET /api/v1/events/{id}/participants?attended=true
 *
 * Who took part in an event, for a program writing a report about it
 * (docs/API.md): every member registered or recorded as attended, with
 * name and whether registered, attended and coach; attended=true lists only
 * who attended. Personal data: needs an API key with
 * event_participants:read, which is for servers only (it lists no websites,
 * so any browser is refused) and is never cached.
 */

export const GET: RequestHandler = async ({ request, url, params, locals }) => {
  const origin = request.headers.get('origin');

  const key = bearerKey(request.headers.get('authorization'));
  if (!key) {
    return apiError(401, 'unauthorized', 'An API key is required (Authorization: Bearer).', origin);
  }

  const eventId = parseEventId(params.eventId);
  if (eventId == null) return apiError(400, 'invalid_request', 'Not an event id.', origin);
  const filter = parseAttendedFilter(url.searchParams);
  if (!filter.ok) return apiError(400, 'invalid_request', filter.message, origin);

  let data: ApiEventParticipantsData | null;
  try {
    const { data: result, error } = await locals.supabase
      .rpc('api_event_participants', { p_key: key, p_event_id: eventId })
      .abortSignal(AbortSignal.timeout(10000));
    if (error) throw error;
    data = result as ApiEventParticipantsData | null;
  } catch (e) {
    console.error('api_event_participants failed:', e);
    return apiError(503, 'unavailable', 'The participants are temporarily unavailable.', origin);
  }
  if (!data) {
    return apiError(401, 'unauthorized', 'Unknown API key, or not for event participants.', origin);
  }
  if (!originAllowed(origin, data.allowed_origins ?? [])) {
    return apiError(403, 'origin_not_allowed', 'This API key is for servers only.', origin);
  }
  const { event } = data;
  if (!event) return apiError(404, 'not_found', 'No event with this id.', origin);

  return apiJson(buildApiEventParticipants({ ...data, event }, filter.attendedOnly), {
    corsOrigin: origin
  });
};
