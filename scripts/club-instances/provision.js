#!/usr/bin/env node
// Set up (or complete) one club's own Administra instance:
// a Supabase project and a Netlify site, wired to each other.
//
//   node scripts/club-instances/provision.js <slug> [--dry-run]
//
// Safe to re-run: steps that already happened are found again (state file,
// project and site names) and only completed. See docs/CLUB_INSTANCES.md.

import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { netlifyApi, supabaseApi } from './api.js';
import {
  authCallbackUrl,
  authConfig,
  bootstrapAdminsSql,
  generateDbPassword,
  parseOperatorEnv,
  projectName,
  siteEnv,
  siteName
} from './clubConfig.js';
import {
  git,
  loadClub,
  loadState,
  migrationsAt,
  registryDir,
  resolveCommit,
  saveState,
  signInTemplateAt
} from './registry.js';

// Expected failures (bad club file, missing variable, API error) as one line, no stack.
process.on('uncaughtException', (error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: { 'dry-run': { type: 'boolean', default: false } }
});
const dryRun = flags['dry-run'];
const slug = positionals[0];
if (!slug) {
  console.error('Usage: node scripts/club-instances/provision.js <slug> [--dry-run]');
  process.exit(2);
}

const dir = registryDir();
const club = loadClub(dir, slug);
const op = parseOperatorEnv(process.env);
const state = loadState(dir, slug);
const supabase = supabaseApi(op.supabaseToken);
const netlify = netlifyApi(op.netlifyToken);

// The new database must match the code its site will build: the release branch.
git(['fetch', '--quiet', 'origin', op.releaseBranch]);
const release = resolveCommit(`origin/${op.releaseBranch}`);
const step = (text) => console.log(`\n▶ ${text}${dryRun ? ' (dry run)' : ''}`);

console.log(
  `Club ${club.name} (${club.slug}) → https://${club.domain}, release ${release.slice(0, 8)}`
);

// 1. Supabase project -------------------------------------------------------
step('Supabase project');
if (!state.projectRef) {
  const existing = (await supabase.listProjects()).find((p) => p.name === projectName(club));
  if (existing) {
    state.projectRef = existing.ref;
    console.log(`  found existing project ${existing.ref}`);
  } else if (dryRun) {
    console.log(`  would create ${projectName(club)} in ${club.region}`);
  } else {
    // The password is never needed again (all access goes through the
    // Management API); it can be reset in the dashboard if ever required.
    const project = await supabase.createProject({
      name: projectName(club),
      orgSlug: op.supabaseOrgSlug,
      dbPass: generateDbPassword(randomBytes),
      region: club.region
    });
    state.projectRef = project.ref;
    console.log(`  created ${project.ref}`);
  }
  if (!dryRun) saveState(dir, slug, state);
} else {
  console.log(`  ${state.projectRef}`);
}

if (dryRun && !state.projectRef) {
  console.log('\nDry run stops here: the remaining steps need the project to exist.');
  process.exit(0);
}
const ref = /** @type {string} */ (state.projectRef);

step('Waiting until the project is healthy');
await supabase.waitHealthy(ref);

// 2. Schema -----------------------------------------------------------------
step('Migrations');
const applied = await supabase.migrate(ref, migrationsAt(release), { dryRun });
console.log(applied.length ? `  ${applied.length} migration(s)` : '  up to date');

step(`Bootstrap admins: ${club.adminEmails.join(', ')}`);
if (!dryRun) await supabase.query(ref, bootstrapAdminsSql(club));

// 3. Auth and storage ---------------------------------------------------------
step('Auth settings (site URL, Google, sign-in code mail, SMTP)');
if (!dryRun) await supabase.updateAuthConfig(ref, authConfig(club, op, signInTemplateAt(release)));

const { anonKey, serviceKey } = await supabase.apiKeys(ref);

// Declared in supabase/config.toml, which only reaches the JAC projects
// through Supabase Branching; the lesson plan bucket comes with the migrations.
step('Storage bucket "avatars"');
if (!dryRun) {
  await supabase.ensureBucket(ref, serviceKey, {
    id: 'avatars',
    name: 'avatars',
    public: false,
    file_size_limit: 5 * 1024 * 1024,
    allowed_mime_types: ['image/webp', 'image/png', 'image/jpeg']
  });
}

// 4. Netlify site -------------------------------------------------------------
step('Netlify site');
const accountId = await netlify.accountId(op.netlifyAccountSlug);
if (!state.siteId) {
  const existing = await netlify.findSite(siteName(club));
  if (existing) {
    state.siteId = existing.id;
    console.log(`  found existing site ${existing.name}`);
  } else if (dryRun) {
    console.log(`  would create ${siteName(club)} building ${op.repo}@${op.releaseBranch}`);
  } else {
    const site = await netlify.createSite({
      accountSlug: op.netlifyAccountSlug,
      name: siteName(club),
      domain: club.domain,
      repo: op.repo,
      branch: op.releaseBranch,
      installationId: op.netlifyInstallationId
    });
    state.siteId = site.id;
    state.siteUrl = site.ssl_url || site.url;
    console.log(`  created ${site.name}`);
  }
  if (!dryRun) saveState(dir, slug, state);
}

const env = siteEnv(club, op, { projectRef: ref, anonKey });
step(`Site environment: ${env.map((v) => v.key).join(', ')}`);
if (!dryRun && state.siteId) {
  await netlify.setEnv(accountId, state.siteId, env);
  step('Build');
  await netlify.triggerBuild(state.siteId);
  state.releasedRef = release;
  saveState(dir, slug, state);
}

// 5. What only a human can do ---------------------------------------------------
console.log(`
Done${dryRun ? ' (dry run — nothing was changed)' : ''}. Remaining manual steps:

  1. Google Cloud Console → APIs & Services → Credentials → the Administra
     OAuth client → Authorized redirect URIs: add
       ${authCallbackUrl(ref)}
  2. DNS: CNAME ${club.domain} → ${siteName(club)}.netlify.app
     (Netlify issues the TLS certificate once the record resolves.)
  3. Tell ${club.adminEmails.join(', ')} to sign in at https://${club.domain}
     (Google or e-mail code). They become admin on first sign-in.
`);
