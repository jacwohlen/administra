import type { RequestHandler } from '@sveltejs/kit';
import { apiError, apiJson, originAllowed } from '#lib/server/api.ts';
import { zurichToday } from '#lib/calendarFeed.ts';
import {
  bearerKey,
  buildApiActivityReport,
  parseActivityReportQuery,
  type ApiActivityReportData
} from '#lib/publicApi.ts';

/**
 * GET /api/v1/reports/activity?from=YYYY-MM-DD&to=YYYY-MM-DD&member=4711
 *
 * The Einsätze report (docs/ACTIVITY_REPORT.md) for another system, e.g. the
 * treasurer's program (docs/API.md): per person and period the trainings as
 * main trainer and as assistant and the coaching days, the trainings and
 * events behind them and the dates to check, computed like the admin page.
 * member=…: one person's report. Personal data: needs an API key with
 * activity_report:read, which only admins create and which is for servers
 * only (it lists no websites, so any browser is refused); never cached.
 */

export const GET: RequestHandler = async ({ request, url, locals }) => {
  const origin = request.headers.get('origin');

  const key = bearerKey(request.headers.get('authorization'));
  if (!key) {
    return apiError(401, 'unauthorized', 'An API key is required (Authorization: Bearer).', origin);
  }

  const now = new Date();
  const parsed = parseActivityReportQuery(url.searchParams, now);
  if (!parsed.ok) return apiError(400, 'invalid_request', parsed.message, origin);
  const { query } = parsed;

  let data: ApiActivityReportData | null;
  try {
    const { data: result, error } = await locals.supabase
      .rpc('api_activity_report', {
        p_key: key,
        p_from: query.from,
        p_to: query.to,
        p_member_id: query.memberId
      })
      .abortSignal(AbortSignal.timeout(20000));
    if (error) throw error;
    data = result as ApiActivityReportData | null;
  } catch (e) {
    console.error('api_activity_report failed:', e);
    return apiError(503, 'unavailable', 'The report is temporarily unavailable.', origin);
  }
  if (!data) {
    return apiError(401, 'unauthorized', 'Unknown API key, or not for reports.', origin);
  }
  if (!originAllowed(origin, data.allowed_origins ?? [])) {
    return apiError(403, 'origin_not_allowed', 'This API key is for servers only.', origin);
  }
  if (query.memberId != null && !data.member) {
    return apiError(404, 'not_found', 'No member with this id.', origin);
  }

  return apiJson(buildApiActivityReport(data, query, zurichToday(now)), { corsOrigin: origin });
};
