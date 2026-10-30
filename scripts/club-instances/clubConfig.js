// Pure helpers for the club instance scripts (provision.js, rollout.js).
// No network or file access here, so everything is unit-tested as-is.
// See docs/CLUB_INSTANCES.md.

/** Lower-case letters, digits and single dashes; becomes the subdomain and resource names. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate a club file (<registry>/<slug>.json) and fill in defaults.
 * Throws one Error listing every problem, so a typo surfaces in one run.
 *
 * @param {unknown} raw parsed JSON
 * @param {string} fileSlug slug taken from the file name; must match `slug`
 */
export function parseClubFile(raw, fileSlug) {
  const errors = [];
  const club = /** @type {Record<string, any>} */ (raw && typeof raw === 'object' ? raw : {});

  const slug = typeof club.slug === 'string' ? club.slug : '';
  if (!SLUG_PATTERN.test(slug) || slug.length > 40) {
    errors.push('slug: lower-case letters, digits and dashes, at most 40 characters');
  } else if (fileSlug && slug !== fileSlug) {
    errors.push(`slug: "${slug}" does not match the file name "${fileSlug}.json"`);
  }

  const name = typeof club.name === 'string' ? club.name.trim() : '';
  if (!name) errors.push('name: required');

  const domain = typeof club.domain === 'string' ? club.domain.trim().toLowerCase() : '';
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain))
    errors.push('domain: a host name like club.example.ch');

  const admins = Array.isArray(club.adminEmails)
    ? club.adminEmails.map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
    : [];
  if (admins.length === 0 || admins.some((e) => !EMAIL_PATTERN.test(e))) {
    errors.push('adminEmails: at least one valid address');
  }

  const sections = Array.isArray(club.sections)
    ? club.sections.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean)
    : [];
  if (sections.length === 0) errors.push('sections: at least one section, e.g. ["Judo"]');

  const locale = club.defaultLocale ?? 'de';
  if (locale !== 'de' && locale !== 'en') errors.push('defaultLocale: "de" or "en"');

  const region = club.region ?? 'eu-central-1';
  if (typeof region !== 'string' || !/^[a-z]{2}-[a-z]+-\d$/.test(region)) {
    errors.push('region: a Supabase region such as eu-central-1');
  }

  for (const key of ['url', 'logo']) {
    if (club[key] !== undefined && !/^https:\/\//.test(String(club[key]))) {
      errors.push(`${key}: an https:// URL`);
    }
  }
  if (club.contactEmail !== undefined && !EMAIL_PATTERN.test(String(club.contactEmail))) {
    errors.push('contactEmail: a valid address');
  }

  if (errors.length) {
    throw new Error(
      `Invalid club file ${fileSlug || slug || '?'}.json:\n  - ${errors.join('\n  - ')}`
    );
  }

  return {
    slug,
    name,
    domain,
    adminEmails: [...new Set(admins)],
    sections,
    defaultLocale: /** @type {'de' | 'en'} */ (locale),
    region,
    url: club.url,
    logo: club.logo,
    contactEmail: club.contactEmail
  };
}

/** @typedef {ReturnType<typeof parseClubFile>} Club */

/**
 * Settings shared by all club instances, taken from the operator's environment.
 * Throws listing every missing variable.
 *
 * @param {Record<string, string | undefined>} env
 */
export function parseOperatorEnv(env) {
  const required = [
    'SUPABASE_ACCESS_TOKEN',
    'SUPABASE_ORG_SLUG',
    'NETLIFY_AUTH_TOKEN',
    'NETLIFY_ACCOUNT_SLUG',
    'NETLIFY_GITHUB_INSTALLATION_ID',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_USER',
    'SMTP_PASSWORD',
    'SMTP_SENDER_EMAIL'
  ];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
  return {
    supabaseToken: /** @type {string} */ (env.SUPABASE_ACCESS_TOKEN),
    supabaseOrgSlug: /** @type {string} */ (env.SUPABASE_ORG_SLUG),
    netlifyToken: /** @type {string} */ (env.NETLIFY_AUTH_TOKEN),
    netlifyAccountSlug: /** @type {string} */ (env.NETLIFY_ACCOUNT_SLUG),
    netlifyInstallationId: Number(env.NETLIFY_GITHUB_INSTALLATION_ID),
    repo: env.ADMINISTRA_REPO || 'jacwohlen/administra',
    releaseBranch: releaseBranch(env),
    googleClientId: /** @type {string} */ (env.GOOGLE_CLIENT_ID),
    googleClientSecret: /** @type {string} */ (env.GOOGLE_CLIENT_SECRET),
    smtp: {
      host: /** @type {string} */ (env.SMTP_HOST),
      port: /** @type {string} */ (env.SMTP_PORT),
      user: /** @type {string} */ (env.SMTP_USER),
      password: /** @type {string} */ (env.SMTP_PASSWORD),
      senderEmail: /** @type {string} */ (env.SMTP_SENDER_EMAIL),
      senderName: env.SMTP_SENDER_NAME || 'Administra'
    },
    sentryDsn: env.PUBLIC_SENTRY_DSN || ''
  };
}

/** @typedef {ReturnType<typeof parseOperatorEnv>} OperatorEnv */

/**
 * The branch the club sites build. rollout.js force-moves nothing but does
 * push to it, so it must never be a branch people work on.
 *
 * @param {Record<string, string | undefined>} env
 */
export function releaseBranch(env) {
  const branch = env.CLUB_RELEASE_BRANCH || 'clubs';
  if (['main', 'prod', 'master'].includes(branch)) {
    throw new Error(`CLUB_RELEASE_BRANCH must not be ${branch}`);
  }
  return branch;
}

/** Supabase project name of a club; also how an existing project is found again. */
export function projectName(club) {
  return `administra-${club.slug}`;
}

/** Netlify site name of a club (becomes <name>.netlify.app). */
export function siteName(club) {
  return `administra-${club.slug}`;
}

/** Google redirects here after sign-in; must be listed in the Google OAuth client. */
export function authCallbackUrl(projectRef) {
  return `https://${projectRef}.supabase.co/auth/v1/callback`;
}

/**
 * Auth settings for PATCH /v1/projects/{ref}/config/auth. Mirrors the
 * [auth] section of supabase/config.toml, with the club's own URLs.
 *
 * @param {Club} club
 * @param {OperatorEnv} op
 * @param {string} signInCodeTemplate contents of supabase/templates/sign_in_code.html
 */
export function authConfig(club, op, signInCodeTemplate) {
  const siteUrl = `https://${club.domain}`;
  const subject = 'Dein Anmeldecode für Administra';
  return {
    site_url: siteUrl,
    uri_allow_list: siteUrl,
    disable_signup: false,
    jwt_exp: 3600,
    refresh_token_rotation_enabled: true,
    security_refresh_token_reuse_interval: 10,
    mailer_autoconfirm: false,
    mailer_secure_email_change_enabled: true,
    mailer_otp_length: 6,
    mailer_otp_exp: 3600,
    mailer_subjects_magic_link: subject,
    mailer_templates_magic_link_content: signInCodeTemplate,
    mailer_subjects_confirmation: subject,
    mailer_templates_confirmation_content: signInCodeTemplate,
    external_google_enabled: true,
    external_google_client_id: op.googleClientId,
    external_google_secret: op.googleClientSecret,
    smtp_host: op.smtp.host,
    smtp_port: op.smtp.port,
    smtp_user: op.smtp.user,
    smtp_pass: op.smtp.password,
    smtp_admin_email: op.smtp.senderEmail,
    smtp_sender_name: `${club.name} (Administra)`,
    smtp_max_frequency: 60,
    rate_limit_email_sent: 30
  };
}

/**
 * Netlify environment variables for a club's site. Everything the build
 * reads via $env/static/public must be here, or the build fails.
 *
 * @param {Club} club
 * @param {OperatorEnv} op
 * @param {{ projectRef: string, anonKey: string }} project
 * @returns {{ key: string, value: string, secret: boolean }[]}
 */
export function siteEnv(club, op, project) {
  /** @type {[string, string | undefined, boolean?][]} */
  const vars = [
    ['PUBLIC_SUPABASE_DATABASE_URL', `https://${project.projectRef}.supabase.co`],
    ['PUBLIC_SUPABASE_ANON_KEY', project.anonKey],
    ['PUBLIC_SUPABASE_SITE_URL', `https://${club.domain}`],
    ['PUBLIC_MODE', 'PROD'],
    ['PUBLIC_CLUB_NAME', club.name],
    ['PUBLIC_CLUB_URL', club.url],
    ['PUBLIC_CLUB_LOGO', club.logo],
    ['PUBLIC_CLUB_CONTACT_EMAIL', club.contactEmail],
    ['PUBLIC_CLUB_SECTIONS', club.sections.join(',')],
    ['PUBLIC_DEFAULT_LOCALE', club.defaultLocale],
    ['PUBLIC_SENTRY_DSN', op.sentryDsn],
    // Trial mails (src/lib/server/mailer.ts) go through the operator's SMTP
    // account, sent in the club's name.
    ['PRIVATE_SMTP_HOST', op.smtp.host],
    ['PRIVATE_SMTP_PORT', op.smtp.port],
    ['PRIVATE_SMTP_USER', op.smtp.user],
    ['PRIVATE_SMTP_PASSWORD', op.smtp.password, true],
    ['PRIVATE_SMTP_FROM', `"${club.name.replaceAll('"', '')}" <${op.smtp.senderEmail}>`]
  ];
  return vars
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value, secret]) => ({ key, value: String(value), secret: Boolean(secret) }));
}

/**
 * SQL that makes the club's admins the only bootstrap admins
 * (supabase/migrations/20261102140000_bootstrap_admins_table.sql).
 * Run right after the migrations, before anyone can sign in.
 *
 * @param {Club} club
 */
export function bootstrapAdminsSql(club) {
  const values = club.adminEmails.map((e) => `(${sqlLiteral(e)})`).join(', ');
  return `BEGIN;\nDELETE FROM public.bootstrap_admins;\nINSERT INTO public.bootstrap_admins (email) VALUES ${values};\nCOMMIT;`;
}

/** Quote a string as an SQL literal. */
export function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/**
 * Migration versions in the repo that a database has not applied yet, in
 * order. Throws if the database has a version the repo does not know: that
 * database was changed outside this repo, and pushing on top is unsafe.
 *
 * @param {string[]} repoVersions e.g. ['20250814155759', ...]
 * @param {string[]} appliedVersions versions recorded in supabase_migrations.schema_migrations
 */
export function pendingMigrations(repoVersions, appliedVersions) {
  const repo = [...repoVersions].sort();
  const known = new Set(repo);
  const unknown = appliedVersions.filter((v) => !known.has(v));
  if (unknown.length) {
    throw new Error(`Database has migrations missing from the repo: ${unknown.join(', ')}`);
  }
  const applied = new Set(appliedVersions);
  const pending = repo.filter((v) => !applied.has(v));
  const newestApplied = appliedVersions.length ? [...appliedVersions].sort().at(-1) : '';
  const outOfOrder = pending.filter((v) => v < /** @type {string} */ (newestApplied));
  if (outOfOrder.length) {
    throw new Error(
      `Repo migrations older than the newest applied one would be skipped by db push: ${outOfOrder.join(', ')}`
    );
  }
  return pending;
}

/** Version prefix of a migration file name, e.g. 20250814155759_remote_schema.sql. */
export function migrationVersion(fileName) {
  const match = /^(\d{14})_.+\.sql$/.exec(fileName);
  return match ? match[1] : null;
}

/** A database password Supabase accepts: 32 URL-safe characters. */
export function generateDbPassword(randomBytes) {
  return Buffer.from(randomBytes(24)).toString('base64url');
}

/** Creates the migration history table the Supabase CLI uses, if missing. */
export const MIGRATION_HISTORY_SQL = `CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  statements text[],
  name text
);`;

/**
 * One query that applies a migration file and records it in the CLI's
 * history table, in a single transaction: either both happen or neither.
 * Migrations must not contain their own BEGIN/COMMIT (none do).
 *
 * @param {string} fileName e.g. 20250814155759_remote_schema.sql
 * @param {string} sql the file's contents
 */
export function applyMigrationSql(fileName, sql) {
  const version = migrationVersion(fileName);
  if (!version) throw new Error(`Not a migration file name: ${fileName}`);
  if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(sql)) {
    throw new Error(`${fileName} contains its own transaction control; apply it by hand`);
  }
  const name = fileName.slice(version.length + 1, -'.sql'.length);
  return [
    'BEGIN;',
    sql,
    ';',
    `INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES (${sqlLiteral(version)}, ${sqlLiteral(name)}, ARRAY[${sqlLiteral(sql)}]);`,
    'COMMIT;'
  ].join('\n');
}
