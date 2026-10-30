// File and git access for the club instance scripts.
//
// The registry is a directory OUTSIDE this public repo (CLUB_REGISTRY_DIR):
// club files name customers and their admins' addresses. Per club it holds
//   <slug>.json        what the operator writes (see club.example.json)
//   <slug>.state.json  what provision.js created (project ref, site id);
//                      no secrets — the scripts only need the API tokens.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { migrationVersion, parseClubFile } from './clubConfig.js';

export function registryDir(env = process.env) {
  const dir = env.CLUB_REGISTRY_DIR;
  if (!dir) throw new Error('Set CLUB_REGISTRY_DIR to the directory holding the club files');
  if (!existsSync(dir)) throw new Error(`CLUB_REGISTRY_DIR does not exist: ${dir}`);
  return dir;
}

/** @param {string} dir @param {string} slug */
export function loadClub(dir, slug) {
  const file = path.join(dir, `${slug}.json`);
  return parseClubFile(JSON.parse(readFileSync(file, 'utf8')), slug);
}

/** Slugs of every club file in the registry. */
export function clubSlugs(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.state.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

/**
 * @typedef {{ projectRef?: string, siteId?: string, siteUrl?: string, releasedRef?: string }} ClubState
 */

/** @returns {ClubState} */
export function loadState(dir, slug) {
  const file = path.join(dir, `${slug}.state.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

/** @param {ClubState} state */
export function saveState(dir, slug, state) {
  writeFileSync(path.join(dir, `${slug}.state.json`), `${JSON.stringify(state, null, 2)}\n`);
}

/** @param {string[]} args */
export function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}

/** Full commit hash of a ref, e.g. origin/prod. */
export function resolveCommit(ref) {
  return git(['rev-parse', '--verify', `${ref}^{commit}`]);
}

/**
 * The migration files as of a commit — read from git, not the working tree,
 * so the databases always get exactly the migrations of the code released
 * to the club sites.
 *
 * @param {string} commit
 * @returns {{ fileName: string, version: string, sql: string }[]}
 */
export function migrationsAt(commit) {
  return git(['ls-tree', '--name-only', commit, 'supabase/migrations/'])
    .split('\n')
    .map((p) => path.basename(p))
    .filter((fileName) => migrationVersion(fileName))
    .sort()
    .map((fileName) => ({
      fileName,
      version: /** @type {string} */ (migrationVersion(fileName)),
      sql: git(['show', `${commit}:supabase/migrations/${fileName}`])
    }));
}

/** The repo's sign-in code mail template, as of a commit. */
export function signInTemplateAt(commit) {
  return git(['show', `${commit}:supabase/templates/sign_in_code.html`]);
}
