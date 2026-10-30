/**
 * Per-client throttle for the one-click sign-in of the public demo (`demo`
 * action of src/routes/+page.server.ts).
 *
 * The demo signs in on the server, so Supabase Auth sees every visitor
 * coming from the few egress IPs of the Netlify function and counts them all
 * against one per-IP bucket (`sign_in_sign_ups`, 30 per 5 minutes by
 * default). Without a limit here, one script posting `role=admin` could
 * spend that bucket and lock the demo for everyone. This limiter caps each
 * client address well below it. It lives in the memory of one warm function
 * instance, so it is best effort; the real headroom comes from raising the
 * Supabase rate limit of the demo project (docs/DEMO.md).
 */

export interface RateLimiter {
  /** Counts one attempt for `key`; false once `key` used up its window. */
  take(key: string, now?: number): boolean;
}

export function createRateLimiter(limit: number, windowMs: number, maxKeys = 5000): RateLimiter {
  const hits = new Map<string, number[]>();

  function prune(now: number) {
    for (const [key, times] of hits) {
      if (times[times.length - 1] <= now - windowMs) hits.delete(key);
    }
  }

  return {
    take(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > maxKeys) prune(now);
      return true;
    }
  };
}

/** Sign-ins one client may start per window: enough to try every role a few times. */
export const DEMO_SIGN_INS_PER_CLIENT = 10;
export const DEMO_SIGN_IN_WINDOW_MS = 5 * 60 * 1000;

export const demoSignInLimiter = createRateLimiter(
  DEMO_SIGN_INS_PER_CLIENT,
  DEMO_SIGN_IN_WINDOW_MS
);
