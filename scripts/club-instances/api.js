// Thin clients for the Supabase Management API and the Netlify API, as used
// by provision.js and rollout.js. Request shapes follow the official OpenAPI
// specs (https://api.supabase.com/api/v1-json,
// https://open-api.netlify.com/swagger.json). See docs/CLUB_INSTANCES.md.

import { MIGRATION_HISTORY_SQL, applyMigrationSql, pendingMigrations } from './clubConfig.js';

const SUPABASE_API = 'https://api.supabase.com';
const NETLIFY_API = 'https://api.netlify.com/api/v1';

export class ApiError extends Error {
  /** @param {string} message @param {number} status @param {string} body */
  constructor(message, status, body) {
    super(`${message} → HTTP ${status}: ${body.slice(0, 500)}`);
    this.status = status;
    this.body = body;
  }
}

/**
 * @param {string} base
 * @param {string} token
 */
function client(base, token) {
  /**
   * @param {string} method
   * @param {string} path
   * @param {unknown} [body]
   * @param {{ allow?: number[] }} [options] statuses returned as null instead of thrown
   */
  return async function request(method, path, body, options = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    if (options.allow?.includes(response.status)) return null;
    if (!response.ok) throw new ApiError(`${method} ${path}`, response.status, text);
    return text ? JSON.parse(text) : null;
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {string} token Supabase personal access token */
export function supabaseApi(token) {
  const request = client(SUPABASE_API, token);

  /** Run SQL as the postgres role. Returns the result rows. */
  async function query(ref, sql) {
    return request('POST', `/v1/projects/${ref}/database/query`, { query: sql });
  }

  return {
    request,
    query,

    /** @returns {Promise<{ ref: string, name: string, status: string }[]>} */
    listProjects: () => request('GET', '/v1/projects'),

    /** @param {{ name: string, orgSlug: string, dbPass: string, region: string }} p */
    createProject: (p) =>
      request('POST', '/v1/projects', {
        name: p.name,
        organization_slug: p.orgSlug,
        db_pass: p.dbPass,
        region_selection: { type: 'specific', code: p.region }
      }),

    /** Poll until every listed service reports ACTIVE_HEALTHY (new projects take a few minutes). */
    async waitHealthy(ref, services = ['db', 'auth', 'rest', 'storage'], timeoutMs = 15 * 60_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const health = await request(
          'GET',
          `/v1/projects/${ref}/health?services=${services.join(',')}`,
          undefined,
          { allow: [404, 503] }
        );
        const waiting = health
          ? health.filter((s) => s.status !== 'ACTIVE_HEALTHY').map((s) => s.name)
          : services;
        if (waiting.length === 0) return;
        if (Date.now() > deadline)
          throw new Error(`${ref}: still not healthy: ${waiting.join(', ')}`);
        console.log(`  waiting for ${waiting.join(', ')} …`);
        await sleep(15_000);
      }
    },

    /**
     * The key the browser uses (legacy anon JWT, else the publishable key)
     * and the server-side key (legacy service_role, else a secret key).
     */
    async apiKeys(ref) {
      /** @type {{ name: string, type: string | null, api_key: string | null }[]} */
      const keys = await request('GET', `/v1/projects/${ref}/api-keys?reveal=true`);
      const find = (legacyName, type) =>
        keys.find((k) => k.type === 'legacy' && k.name === legacyName)?.api_key ??
        keys.find((k) => k.type === type)?.api_key ??
        null;
      const anonKey = find('anon', 'publishable');
      const serviceKey = find('service_role', 'secret');
      if (!anonKey || !serviceKey) throw new Error(`${ref}: API keys not found`);
      return { anonKey, serviceKey };
    },

    updateAuthConfig: (ref, config) => request('PATCH', `/v1/projects/${ref}/config/auth`, config),

    /** Versions recorded in the CLI's migration history (empty on a fresh project). */
    async appliedMigrations(ref) {
      const [{ exists }] = await query(
        ref,
        "SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS exists"
      );
      if (!exists) return [];
      const rows = await query(
        ref,
        'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version'
      );
      return rows.map((r) => r.version);
    },

    /**
     * Apply the repo migrations a project is missing, oldest first, each in
     * its own transaction. Stops at the first failure.
     *
     * @param {string} ref
     * @param {{ fileName: string, version: string, sql: string }[]} migrations
     * @param {{ dryRun?: boolean }} [options]
     * @returns {Promise<string[]>} the versions applied (or that would be)
     */
    async migrate(ref, migrations, options = {}) {
      const applied = await this.appliedMigrations(ref);
      const pending = pendingMigrations(
        migrations.map((m) => m.version),
        applied
      );
      if (pending.length && !options.dryRun) await query(ref, MIGRATION_HISTORY_SQL);
      for (const version of pending) {
        const migration = /** @type {(typeof migrations)[number]} */ (
          migrations.find((m) => m.version === version)
        );
        console.log(`  ${options.dryRun ? 'would apply' : 'applying'} ${migration.fileName}`);
        if (!options.dryRun) await query(ref, applyMigrationSql(migration.fileName, migration.sql));
      }
      return pending;
    },

    /** Create a Storage bucket through the project's own Storage API; existing buckets are left alone. */
    async ensureBucket(ref, serviceKey, bucket) {
      const response = await fetch(`https://${ref}.supabase.co/storage/v1/bucket`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(bucket)
      });
      const text = await response.text();
      if (response.ok || /already exists/i.test(text)) return;
      throw new ApiError(`create bucket ${bucket.id}`, response.status, text);
    }
  };
}

/** @param {string} token Netlify personal access token */
export function netlifyApi(token) {
  const request = client(NETLIFY_API, token);

  return {
    request,

    async accountId(slug) {
      /** @type {{ id: string, slug: string }[]} */
      const accounts = await request('GET', '/accounts');
      const account = accounts.find((a) => a.slug === slug);
      if (!account) throw new Error(`Netlify account "${slug}" not found`);
      return account.id;
    },

    /** @returns {Promise<{ id: string, name: string } | undefined>} */
    async findSite(name) {
      /** @type {{ id: string, name: string }[]} */
      const sites = await request('GET', `/sites?name=${encodeURIComponent(name)}&filter=all`);
      return sites.find((s) => s.name === name);
    },

    /**
     * A site that builds the release branch of the Administra repo. Netlify
     * rebuilds it on every push to that branch — which only rollout.js does.
     *
     * @param {{ accountSlug: string, name: string, domain: string, repo: string, branch: string, installationId: number }} p
     */
    async createSite(p) {
      const site = await request('POST', `/${p.accountSlug}/sites`, {
        name: p.name,
        custom_domain: p.domain,
        force_ssl: true,
        repo: {
          provider: 'github',
          repo_path: p.repo,
          repo_branch: p.branch,
          allowed_branches: [p.branch],
          installation_id: p.installationId,
          cmd: 'npm run build',
          dir: 'build'
        }
      });
      // No deploy previews: PRs are previewed on the JAC Wohlen site only.
      // build_settings.skip_prs is not in the official spec but is what the
      // Netlify Terraform provider sends for "deploy previews off".
      await request('PATCH', `/sites/${site.id}`, { build_settings: { skip_prs: true } });
      return site;
    },

    /**
     * Create or replace the site's environment variables (all deploy contexts).
     *
     * @param {string} accountId
     * @param {string} siteId
     * @param {{ key: string, value: string, secret: boolean }[]} vars
     */
    async setEnv(accountId, siteId, vars) {
      /** @type {{ key: string }[]} */
      const existing = await request('GET', `/accounts/${accountId}/env?site_id=${siteId}`);
      const existingKeys = new Set(existing.map((v) => v.key));
      const body = (v) => ({
        key: v.key,
        is_secret: v.secret,
        values: v.secret
          ? // Secrets get no "dev" value: that one stays readable via UI/API/CLI.
            ['production', 'deploy-preview', 'branch-deploy'].map((context) => ({
              context,
              value: v.value
            }))
          : [{ context: 'all', value: v.value }]
      });
      const fresh = vars.filter((v) => !existingKeys.has(v.key));
      if (fresh.length)
        await request('POST', `/accounts/${accountId}/env?site_id=${siteId}`, fresh.map(body));
      for (const v of vars.filter((v) => existingKeys.has(v.key))) {
        await request('PUT', `/accounts/${accountId}/env/${v.key}?site_id=${siteId}`, body(v));
      }
    },

    triggerBuild: (siteId) => request('POST', `/sites/${siteId}/builds`)
  };
}
