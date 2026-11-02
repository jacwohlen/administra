import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openApiDocument } from './openApi';
import { API_SCOPES } from './publicApi';
import { apiDocsPage, apiDocsPolicy, SCALAR_INTEGRITY, SCALAR_VERSION } from './server/apiDocs';

const doc = openApiDocument('https://admin.example.ch') as {
  openapi: string;
  servers: { url: string }[];
  paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
  components: { securitySchemes: { apiKey: { description: string } } };
};

/** The endpoints under src/routes/api/v1/, as paths below /api/v1 */
function v1Routes(dir = 'src/routes/api/v1', prefix = ''): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (!statSync(path).isDirectory()) continue;
    const route = `${prefix}/${name.replace(/^\[(.+)\]$/, '{$1}')}`;
    if (readdirSync(path).includes('+server.ts')) found.push(route);
    found.push(...v1Routes(path, route));
  }
  return found;
}

describe('openApiDocument', () => {
  it('is OpenAPI 3.1 and calls the instance it is served by', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.servers).toEqual([
      { url: 'https://admin.example.ch/api/v1', description: 'This Alleda instance' }
    ]);
  });

  it('describes every endpoint under /api/v1', () => {
    const routes = v1Routes().filter((r) => r !== '/openapi.json');
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) expect(Object.keys(doc.paths)).toContain(route);
  });

  it('names every scope', () => {
    for (const scope of API_SCOPES) {
      expect(doc.components.securitySchemes.apiKey.description).toContain(scope);
    }
  });

  it('documents the errors of every operation', () => {
    for (const operations of Object.values(doc.paths)) {
      for (const op of Object.values(operations)) {
        expect(Object.keys(op.responses)).toEqual(
          expect.arrayContaining(['200', '400', '401', '403', '503'])
        );
      }
    }
  });

  it('resolves every $ref', () => {
    const json = JSON.stringify(doc);
    const schemas = Object.keys((doc.components as unknown as { schemas: object }).schemas);
    for (const [, name] of json.matchAll(/"#\/components\/schemas\/([^"]+)"/g)) {
      expect(schemas).toContain(name);
    }
  });
});

describe('API docs page', () => {
  it('loads a pinned Scalar with its hash and the nonce', () => {
    const html = apiDocsPage('abc123');
    expect(html).toContain(`@scalar/api-reference@${SCALAR_VERSION}/`);
    expect(html).toContain(`integrity="${SCALAR_INTEGRITY}"`);
    expect(html).toContain('<script nonce="abc123">');
    expect(html).toContain('"telemetry":false');
    expect(html).toContain('"persistAuth":false');
    expect(html).not.toContain('proxyUrl');
  });

  it('may connect only to its own instance', () => {
    const policy = apiDocsPolicy('abc123');
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("script-src 'nonce-abc123' https://cdn.jsdelivr.net");
    expect(policy).toContain("default-src 'none'");
  });
});
