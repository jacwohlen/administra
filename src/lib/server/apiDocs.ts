/**
 * The page at /api/docs: the API reference (Scalar) for the OpenAPI
 * description at /api/v1/openapi.json, where a key can be tried against
 * this instance (docs/API.md).
 *
 * Scalar comes from jsDelivr, pinned and checked with its SRI hash, so the
 * app does not bundle its 4.6 MB. The page's own Content-Security-Policy
 * (enforced, unlike the app's report-only one) lets it connect only to this
 * instance: a key pasted here reaches no one else, not Scalar's proxy,
 * telemetry or AI features (also switched off in the configuration).
 */

/** Update both together: the hash of dist/browser/standalone.js of this version */
export const SCALAR_VERSION = '1.75.0';
export const SCALAR_INTEGRITY =
  'sha384-xgelKlDcc+BYp0O+ZYzFesLnWCgGpEbXVVZWNQT6WyZYygN01tbEMygnjPXb5OPI';
const SCALAR_URL = `https://cdn.jsdelivr.net/npm/@scalar/api-reference@${SCALAR_VERSION}/dist/browser/standalone.js`;

/** Scalar's configuration (https://scalar.com/products/api-references/configuration) */
const CONFIG = {
  url: '/api/v1/openapi.json',
  theme: 'default',
  // Fonts from fonts.scalar.com: off, the system fonts are used
  withDefaultFonts: false,
  telemetry: false,
  agent: { disabled: true },
  mcp: { disabled: true },
  showDeveloperTools: 'never',
  // A key typed in stays in the tab only
  persistAuth: false,
  // The client button opens client.scalar.com
  hideClientButton: true,
  documentDownloadType: 'json',
  hideModels: false,
  defaultOpenAllTags: true,
  // Request snippets: the languages a club website is likely to use
  defaultHttpClient: { targetKey: 'js', clientKey: 'fetch' },
  hiddenClients: {
    node: true,
    java: true,
    csharp: true,
    kotlin: true,
    objc: true,
    ocaml: true,
    r: true,
    swift: true,
    c: true,
    clojure: true,
    dart: true,
    http: true,
    rust: true,
    fsharp: true
  }
};

export function apiDocsPage(nonce: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Alleda API</title>
    <link rel="icon" href="/favicon.ico" />
  </head>
  <body>
    <div id="app"></div>
    <script src="${SCALAR_URL}" integrity="${SCALAR_INTEGRITY}" crossorigin="anonymous"></script>
    <script nonce="${nonce}">
      Scalar.createApiReference('#app', ${JSON.stringify(CONFIG)});
    </script>
  </body>
</html>
`;
}

export function apiDocsPolicy(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' https://cdn.jsdelivr.net`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // Try it: only this instance
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ');
}
