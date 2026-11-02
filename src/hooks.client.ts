import * as Sentry from '@sentry/sveltekit';
import { PUBLIC_SENTRY_DSN, PUBLIC_SENTRY_TRACES_SAMPLE_RATE } from '$app/env/public';
import { browserBeforeSend, isReportedError, sentryOptions } from '#lib/sentry.ts';
import { loadAppSettings } from '#lib/appSettings.ts';
import { loadIntegrationConfig } from '#lib/integrationConfigLoad.ts';
import { supabaseClient } from '#lib/supabase.ts';

// Error reports from the browser, see docs/ERROR_MONITORING.md.
// Dropped connections are not reported (see browserNetworkNoise).
Sentry.init({
  ...sentryOptions(PUBLIC_SENTRY_DSN, __NETLIFY_CONTEXT__, PUBLIC_SENTRY_TRACES_SAMPLE_RATE),
  beforeSend: browserBeforeSend
});

// Started as the app boots, alongside the root layout's server data
// (__data.json): the layout loads only run once that has arrived and would
// ask one after another (docs/PERFORMANCE.md). They await these same
// requests. The integration configuration only for a session on the
// dashboard: without one, RLS would answer nothing and the built-in rules
// would stay for the session.
void loadAppSettings();
if (window.location.pathname.startsWith('/dashboard')) {
  void supabaseClient.auth.getSession().then(({ data }) => {
    if (data.session) void loadIntegrationConfig();
  });
}

// The message and status stay SvelteKit's (the safe message, 'Internal Error'
// for unknown errors); reported errors get their Sentry event id.
export const handleError = Sentry.handleErrorWithSentry(({ kind, error }) =>
  isReportedError(kind, error) ? { errorId: Sentry.lastEventId() } : undefined
);
