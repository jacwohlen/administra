import * as Sentry from '@sentry/sveltekit';
import { env } from '$env/dynamic/public';
import { sentryOptions } from '$lib/sentry';
import '$lib/supabase';

// Error reports from the browser, see docs/ERROR_MONITORING.md.
Sentry.init(sentryOptions(env.PUBLIC_SENTRY_DSN, __NETLIFY_CONTEXT__));

export const handleError = Sentry.handleErrorWithSentry(({ message }) => ({
  message,
  errorId: Sentry.lastEventId()
}));
