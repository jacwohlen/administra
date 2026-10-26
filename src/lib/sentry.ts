import { scrubEvent } from './sentryScrub';

/**
 * Sentry settings shared by the browser and the server, see
 * docs/ERROR_MONITORING.md. Without a DSN (local development, tests) nothing
 * is sent.
 *
 * `deployContext` is Netlify's deploy context at build time (see
 * vite.config.js) and tells production errors apart from Dev and previews.
 */
export function sentryOptions(dsn: string | undefined, deployContext: string | undefined) {
  return {
    dsn: dsn || undefined,
    environment: sentryEnvironment(deployContext),
    // No IP addresses, cookies or request bodies. Sentry 11 dropped
    // `sendDefaultPii` and collects all of this unless told otherwise; the
    // Daten-Assistent's uploads and the model's answers (names, birthdays)
    // must never end up in a report, neither as bodies, AI span data nor
    // local variables of a stack frame.
    dataCollection: {
      userInfo: false,
      cookies: false,
      // Only harmless request headers: Netlify adds the client IP and its
      // location (x-nf-client-connection-ip, x-nf-geo) under its own names
      httpHeaders: {
        request: { allow: ['user-agent', 'accept', 'accept-language', 'content-type', 'referer'] },
        response: false
      },
      httpBodies: [],
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false
    },
    beforeSend: scrubEvent,
    // Not sent today (no tracesSampleRate), but scrubbed should tracing be
    // turned on: transaction names and spans contain URLs too.
    beforeSendTransaction: scrubEvent
  };
}

/** Sentry environment name for a Netlify deploy context. */
export function sentryEnvironment(context: string | undefined): string {
  if (context === 'production') return 'production'; // prod → admin.jacwohlen.ch
  if (context === 'branch-deploy') return 'dev'; // main → main.admin.jacwohlen.ch
  if (context === 'deploy-preview') return 'preview';
  return context || 'local';
}
