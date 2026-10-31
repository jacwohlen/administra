import { scrubEvent, scrubTransaction } from './sentryScrub';

/**
 * Sentry settings shared by the browser and the server, see
 * docs/ERROR_MONITORING.md. Without a DSN (local development, tests) nothing
 * is sent.
 *
 * `deployContext` is Netlify's deploy context at build time (see
 * vite.config.js) and tells production errors apart from Dev and previews.
 * `tracesSampleRate` is `PUBLIC_SENTRY_TRACES_SAMPLE_RATE` (performance
 * monitoring, docs/PERFORMANCE.md).
 */
export function sentryOptions(
  dsn: string | undefined,
  deployContext: string | undefined,
  tracesSampleRate?: string
) {
  return {
    dsn: dsn || undefined,
    environment: sentryEnvironment(deployContext),
    // Share of page loads, navigations and server requests sent as traces
    // (Web Vitals, load functions, Supabase requests)
    tracesSampleRate: parseSampleRate(tracesSampleRate),
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
    // Transaction names and spans contain URLs too; request URLs (Supabase's
    // filters) also lose their query values, which can hold a name
    beforeSendTransaction: scrubTransaction
  };
}

/** Traces sent when `PUBLIC_SENTRY_TRACES_SAMPLE_RATE` is not set. */
export const DEFAULT_TRACES_SAMPLE_RATE = 0.2;

/**
 * `PUBLIC_SENTRY_TRACES_SAMPLE_RATE` as a share between 0 (no traces) and 1
 * (every page load); unset or invalid means the default.
 */
export function parseSampleRate(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_TRACES_SAMPLE_RATE;
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) return DEFAULT_TRACES_SAMPLE_RATE;
  return rate;
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
