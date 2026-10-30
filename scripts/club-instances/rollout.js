#!/usr/bin/env node
// Release a commit to every club instance:
//   1. apply its new migrations to every club's Supabase project, then
//   2. move the release branch to it, which rebuilds every club's Netlify site.
// Databases first, so no site ever runs code newer than its schema — the same
// order Supabase Branching gives the JAC Wohlen projects. If any club fails,
// the release branch stays put and no site is rebuilt.
//
//   node scripts/club-instances/rollout.js [--ref origin/prod] [--dry-run]
//
// Needs SUPABASE_ACCESS_TOKEN, CLUB_REGISTRY_DIR, and push access to the
// repo. See docs/CLUB_INSTANCES.md.

import { parseArgs } from 'node:util';
import { supabaseApi } from './api.js';
import { releaseBranch as releaseBranchOf } from './clubConfig.js';
import {
  clubSlugs,
  git,
  loadClub,
  loadState,
  migrationsAt,
  registryDir,
  resolveCommit,
  saveState
} from './registry.js';

// Expected failures (bad club file, missing variable, API error) as one line, no stack.
process.on('uncaughtException', (error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});

const { values: flags } = parseArgs({
  options: {
    ref: { type: 'string', default: 'origin/prod' },
    'dry-run': { type: 'boolean', default: false }
  }
});
const dryRun = flags['dry-run'];
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) throw new Error('Set SUPABASE_ACCESS_TOKEN');
const releaseBranch = releaseBranchOf(process.env);

const dir = registryDir();
const supabase = supabaseApi(token);

git(['fetch', '--quiet', 'origin']);
const commit = resolveCommit(/** @type {string} */ (flags.ref));
const releaseExists = git(['ls-remote', '--heads', 'origin', releaseBranch]) !== '';
if (releaseExists) {
  const current = resolveCommit(`origin/${releaseBranch}`);
  // Fast-forward only: going back would leave databases ahead of their code,
  // and migrations are never rolled back.
  if (current !== commit && git(['merge-base', current, commit]) !== current) {
    throw new Error(
      `origin/${releaseBranch} (${current.slice(0, 8)}) is not an ancestor of ${flags.ref}`
    );
  }
}
const migrations = migrationsAt(commit);
console.log(
  `Releasing ${flags.ref} (${commit.slice(0, 8)}), ${migrations.length} migrations in the repo`
);

const done = [];
for (const slug of clubSlugs(dir)) {
  const club = loadClub(dir, slug);
  const state = loadState(dir, slug);
  if (!state.projectRef) {
    console.log(`\n${slug}: not provisioned yet, skipped`);
    continue;
  }
  console.log(`\n${slug} (${state.projectRef})`);
  try {
    const applied = await supabase.migrate(state.projectRef, migrations, { dryRun });
    if (!applied.length) console.log('  up to date');
    done.push(club.slug);
  } catch (error) {
    console.error(`\n✗ ${slug} failed: ${error instanceof Error ? error.message : error}`);
    console.error(
      `Stopped. Migrated so far: ${done.join(', ') || 'none'}. ` +
        `origin/${releaseBranch} was not moved, so no site was rebuilt. ` +
        'Fix the migration (in a new migration file) and run the rollout again.'
    );
    process.exit(1);
  }
}

if (dryRun) {
  console.log(`\nDry run: would push ${commit.slice(0, 8)} to origin/${releaseBranch}.`);
  process.exit(0);
}

git(['push', 'origin', `${commit}:refs/heads/${releaseBranch}`]);
for (const slug of done) saveState(dir, slug, { ...loadState(dir, slug), releasedRef: commit });
console.log(
  `\n✓ origin/${releaseBranch} is now ${commit.slice(0, 8)}; Netlify rebuilds ${done.length} club site(s).`
);
