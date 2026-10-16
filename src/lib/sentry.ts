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
    // No IP addresses, cookies or request bodies
    sendDefaultPii: false,
    beforeSend: scrubEvent
  };
}

/** Sentry environment name for a Netlify deploy context. */
export function sentryEnvironment(context: string | undefined): string {
  if (context === 'production') return 'production'; // prod → admin.jacwohlen.ch
  if (context === 'branch-deploy') return 'dev'; // main → main.admin.jacwohlen.ch
  if (context === 'deploy-preview') return 'preview';
  return context || 'local';
}
