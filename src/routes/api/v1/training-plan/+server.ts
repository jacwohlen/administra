import type { RequestHandler } from '@sveltejs/kit';
import { apiError, apiJson, apiPreflight, originAllowed } from '#lib/server/api.ts';
import {
  bearerKey,
  buildApiTrainingPlan,
  parseTrainingPlanQuery,
  type ApiTrainingPlanData
} from '#lib/publicApi.ts';

/**
 * GET /api/v1/training-plan?from=YYYY-MM-DD&to=YYYY-MM-DD&training=26,27
 *
 * The public part of the training plan for other systems, first the club's
 * website: per training and date its time, who leads, the topic and whether
 * it is dropped, plus the holidays (docs/API.md). Needs an API key with
 * training_plan:read as `Authorization: Bearer alleda_…`; the key is the
 * only credential (api_training_plan() is granted to anon) and is sent to
 * the database in the POST body of the RPC, never in a URL.
 */

/** Browsers and the website's server may keep an answer for five minutes */
const CACHE_SECONDS = 300;

export const OPTIONS: RequestHandler = ({ request }) => apiPreflight(request);

export const GET: RequestHandler = async ({ request, url, locals }) => {
  const origin = request.headers.get('origin');

  const key = bearerKey(request.headers.get('authorization'));
  if (!key) {
    return apiError(401, 'unauthorized', 'An API key is required (Authorization: Bearer).', origin);
  }

  const parsed = parseTrainingPlanQuery(url.searchParams, new Date());
  if (!parsed.ok) return apiError(400, 'invalid_request', parsed.message, origin);
  const { query } = parsed;

  let data: ApiTrainingPlanData | null;
  try {
    const { data: result, error } = await locals.supabase
      .rpc('api_training_plan', { p_key: key, p_from: query.from, p_to: query.to })
      .abortSignal(AbortSignal.timeout(10000));
    if (error) throw error;
    data = result as ApiTrainingPlanData | null;
  } catch (e) {
    console.error('api_training_plan failed:', e);
    return apiError(503, 'unavailable', 'The training plan is temporarily unavailable.', origin);
  }
  if (!data) {
    return apiError(401, 'unauthorized', 'Unknown API key, or not for the training plan.', origin);
  }
  if (!originAllowed(origin, data.allowed_origins ?? [])) {
    return apiError(403, 'origin_not_allowed', 'This API key is not for this website.', origin);
  }

  return apiJson(buildApiTrainingPlan(data, query), {
    corsOrigin: origin,
    cacheSeconds: CACHE_SECONDS
  });
};
