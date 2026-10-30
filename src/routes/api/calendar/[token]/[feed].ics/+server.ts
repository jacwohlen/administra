import type { RequestHandler } from '@sveltejs/kit';
import { buildCalendarFeed, parseFeedName, type CalendarFeedData } from '$lib/calendarFeed';
import { loadMailSettings } from '$lib/server/trialMailContext';

/**
 * The training plan as a calendar feed: /api/calendar/<token>/<feed>.ics,
 * the feed name being meine / alle (German) or mine / all (English), see
 * docs/TRAINING_PLAN.md and src/lib/calendarFeed.ts.
 *
 * Calendar apps fetch without cookies, so the secret token in the path is
 * the only key: calendar_feed() returns the plan for the token of an
 * approved staff account and null for anything else (404). The token is
 * sent in the POST body of the RPC, never in a URL, and Sentry reports get
 * it removed from the path (src/lib/sentryScrub.ts).
 *
 * A database error answers 503, never an empty calendar: that would delete
 * every subscriber's trainings until the next refresh. It is a plain
 * Response, not error(503), which would be reported to Sentry.
 */

const TOKEN = /^[0-9a-f]{64}$/;

const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' };

function plain(status: number, body: string) {
  return new Response(body, {
    status,
    headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

export const GET: RequestHandler = async ({ params, locals, url }) => {
  const token = params.token ?? '';
  const feed = parseFeedName(params.feed ?? '');
  if (!TOKEN.test(token) || !feed) return plain(404, 'Not found');

  let data: CalendarFeedData | null;
  try {
    const { data: result, error } = await locals.supabase
      .rpc('calendar_feed', { p_token: token })
      .abortSignal(AbortSignal.timeout(10000));
    if (error) throw error;
    data = result;
  } catch (e) {
    console.error('calendar_feed failed:', e);
    return plain(503, 'Calendar temporarily unavailable');
  }
  if (!data) return plain(404, 'Not found');

  // The club's name goes into the calendar's; the feed works without it
  let clubName: string | null = null;
  try {
    clubName = (await loadMailSettings(locals.supabase)).club.name;
  } catch (e) {
    console.error('Calendar feed settings failed:', e);
  }

  const body = buildCalendarFeed(data, { ...feed, origin: url.origin, clubName, now: new Date() });
  return new Response(body, {
    headers: {
      ...HEADERS,
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="${params.feed}.ics"`
    }
  });
};
