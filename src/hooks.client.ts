import * as Sentry from '@sentry/sveltekit';
import { env } from '$env/dynamic/public';
import { browserBeforeSend, sentryOptions } from '$lib/sentry';
import { loadAppSettings } from '$lib/appSettings';
import { loadIntegrationConfig } from '$lib/integrationConfigLoad';
import { supabaseClient } from '$lib/supabase';

// Error reports from the browser, see docs/ERROR_MONITORING.md.
// Dropped connections are not reported (see browserNetworkNoise).
Sentry.init({
  ...sentryOptions(
    env.PUBLIC_SENTRY_DSN,
    __NETLIFY_CONTEXT__,
    env.PUBLIC_SENTRY_TRACES_SAMPLE_RATE
  ),
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

export const handleError = Sentry.handleErrorWithSentry(({ message }) => ({
  message,
  errorId: Sentry.lastEventId()
}));
