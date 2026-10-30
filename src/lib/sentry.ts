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

/**
 * Browser errors that only mean the connection dropped (phone lost signal, tab
 * closed mid-request) or that a page was preloaded right after a deploy. They
 * say nothing about our code, so the browser doesn't report them. SvelteKit
 * already reloads the page when a navigation hits a file from an old deploy.
 */
export const browserNetworkNoise: RegExp[] = [
  /^Failed to fetch$/,
  /^Failed to fetch \(.*\)$/,
  /^Load failed( \(.*\))?$/,
  /^NetworkError when attempting to fetch resource\.?$/,
  /^Failed to fetch dynamically imported module/,
  /^Importing a module script failed\.?$/,
  /^error loading dynamically imported module/
];

/** True when a browser error message is only network noise (see above). */
export function isBrowserNetworkNoise(message: string): boolean {
  return browserNetworkNoise.some((pattern) => pattern.test(message));
}

interface ReportedError {
  message?: string;
  exception?: { values?: { value?: string }[] };
}

/** Browser `beforeSend`: drops network noise, scrubs everything else. */
export function browserBeforeSend<T extends ReportedError>(event: T): T | null {
  const values = event.exception?.values ?? [];
  if (values.length > 0 && values.every((v) => isBrowserNetworkNoise(v.value ?? ''))) {
    return null;
  }
  return scrubEvent(event);
}

/** Sentry environment name for a Netlify deploy context. */
export function sentryEnvironment(context: string | undefined): string {
  if (context === 'production') return 'production'; // prod → admin.jacwohlen.ch
  if (context === 'branch-deploy') return 'dev'; // main → main.admin.jacwohlen.ch
  if (context === 'deploy-preview') return 'preview';
  return context || 'local';
}
