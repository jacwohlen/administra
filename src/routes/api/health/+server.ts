import { json, type RequestHandler } from '@sveltejs/kit';

/**
 * Health check for the uptime monitor (see docs/UPTIME_MONITORING.md).
 *
 * Answers 200 {"status":"ok"} when the app runs and the database answers a
 * tiny query, otherwise 503 {"status":"error"}. It never says why: the
 * endpoint is public, so details stay in the Netlify function log.
 * `app_settings` is readable without login (see its migration), so the
 * query works with the anonymous key.
 */
export const GET: RequestHandler = async ({ locals }) => {
  const headers = { 'cache-control': 'no-store' };
  try {
    const { error } = await locals.supabase
      .from('app_settings')
      .select('key')
      .limit(1)
      .abortSignal(AbortSignal.timeout(5000));
    if (error) throw error;
    return json({ status: 'ok' }, { headers });
  } catch (e) {
    console.error('Health check failed:', e);
    return json({ status: 'error' }, { status: 503, headers });
  }
};
