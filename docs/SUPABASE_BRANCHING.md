# Supabase Branching: Preview Databases per PR, Auto-Deploy on Merge

This document describes how Administra's database changes flow from a pull
request to production, and the one-time dashboard setup required to make it
work end to end.

## Target workflow

1. You create a feature branch and add a migration
   (`supabase migration new <name>`, test locally with `supabase db reset`).
2. You open a PR against `main`. Automatically:
   - **Supabase** creates an ephemeral **preview branch** — a full, isolated
     Supabase instance (database + auth + storage + API) with its own URL and
     API keys. All migrations in `supabase/migrations/` are applied to it and
     `supabase/seed.sql` seeds it with sample data. Supabase comments on the
     PR with the deployment status and posts a **"Supabase Preview"** check.
   - **Netlify** builds a Deploy Preview. The Supabase extension for Netlify
     injects the preview branch's `PUBLIC_SUPABASE_DATABASE_URL` and
     `PUBLIC_SUPABASE_ANON_KEY`, so the Deploy Preview talks to the preview
     database, not production.
   - **GitHub Actions** validates migrations independently (`db-validate` job
     in `ci.yml`) and mirrors the Supabase Preview check
     (`supabase-preview-status.yml`) so broken migrations block the merge.
3. Each further push to the PR applies only the _new_ migrations to the
   preview branch.
4. You merge the PR. Automatically:
   - Supabase applies the new migrations to the **production** database
     (plus Edge Functions and storage buckets declared in `config.toml`).
   - The preview branch is deleted.
   - Netlify deploys production from `main`.

Preview branches contain **no production data** — only what migrations create
and `seed.sql` inserts. Seed data changes are never merged to production.

## One-time setup (dashboard side)

### 1. Supabase GitHub integration

In the Supabase Dashboard of the production project:

1. **Project Settings → Integrations → GitHub Integration** → _Authorize
   GitHub_ and connect the `jacwohlen/administra` repository.
2. Set **Working directory** to `.` (the `supabase/` folder is at the repo
   root).
3. Enable **Automatic branching**. Recommended: also enable **Supabase
   changes only**, so preview branches (which are billed per hour) are only
   created for PRs that actually touch `supabase/**`. Frontend-only PRs then
   build their Deploy Preview against production credentials, as today.
4. Enable **Deploy to production**, with production git branch = `main`.
   On merge this applies new migrations and deploys Edge Functions / storage
   buckets declared in `config.toml`. All other configuration (API, Auth
   settings, seed files) is intentionally **not** pushed to production —
   keep managing production auth settings in the dashboard.

Note: branching requires a paid Supabase plan and preview branches are billed
per active hour (cents/hour). Ephemeral branches are deleted when the PR is
merged or closed, so cost stays proportional to open PRs with DB changes.

### 2. Secrets for `config.toml` on preview branches

Preview branches apply this repo's `config.toml`, which references
environment variables via `env(...)`. Set these once as project secrets so
the branching executor can resolve them (they are inherited by branches):

```bash
supabase secrets set \
  PUBLIC_SUPABASE_SITE_URL="https://admin.jacwohlen.ch" \
  PRIVATE_SUPABASE_AUTH_GOOGLE_CLIENT_ID="..." \
  PRIVATE_SUPABASE_AUTH_GOOGLE_SECRET="..." \
  PRIVATE_SUPABASE_AUTH_GOOGLE_CALLBACK_URI="..."
```

Unset variables resolve to empty strings, which can make the branch's
`configure` step fail or silently disable Google login on previews.

### 3. Netlify

The Supabase extension for Netlify should be installed on the site and
connected to the production Supabase project, with the environment variable
names configured as `PUBLIC_SUPABASE_DATABASE_URL` /
`PUBLIC_SUPABASE_ANON_KEY` (matching `src/lib/supabase.ts`). It keeps these
in sync per deploy context once branching is enabled.

`netlify.toml` stays a plain `npm run build` — no env-resolver script is
needed (removed in #73).

### 4. GitHub branch protection

In **GitHub → Settings → Branches** (or a ruleset) for `main`, require these
status checks before merging:

- `db-validate` (CI job — catches broken migrations even without branching)
- `preview-branch` (from `supabase-preview-status.yml` — mirrors the
  Supabase Preview deployment result; only runs on PRs touching
  `supabase/**`)
- your existing `lint-and-check`, `unit-tests`, `build` jobs as desired

Alternatively require the Supabase integration's own **Supabase Preview**
check directly.

## Verification checklist (run once after setup)

1. Create a branch with a trivial migration, e.g.
   `supabase migration new noop` containing `select 1;`, and open a PR.
2. On the PR you should see: a Supabase comment with the preview branch
   status, the **Supabase Preview** check, and the `db-validate` /
   `preview-branch` CI jobs.
3. Open the Netlify Deploy Preview and verify in the browser dev tools that
   requests go to `https://<branch-ref>.supabase.co`, **not** the production
   project URL. (If the Deploy Preview built before the Supabase branch
   finished provisioning, trigger "Retry deploy" on the preview once.)
4. Merge the PR. In the Supabase dashboard, check **Branches → main /
   deployments** that the migration was applied to production, and that the
   preview branch was deleted.

## Caveats and tips

- **Google login on previews**: each preview branch has its own auth
  callback (`https://<branch-ref>.supabase.co/auth/v1/callback`), which the
  Google OAuth client does not know about. Options: add the branch callback
  to the Google Cloud OAuth client while testing, seed an email/password
  test user for previews, or accept that login is untestable on previews
  and covered locally instead.
- **Never edit an already-merged migration** — production has already run
  it. Always add a new migration file.
- **Rolling back on a PR**: if you amend/replace a migration that the
  preview branch already applied, reset the branch from the Supabase
  dashboard (or close and reopen the PR) to re-run all migrations from
  scratch. Resets drop the branch's data and re-seed.
- **Seeding happens once**, at branch creation. Changing `seed.sql` on an
  open PR does not re-seed; reset the branch to pick it up.
- **Not using "Deploy to production"?** The CLI equivalent in CI would be
  `supabase link --project-ref $SUPABASE_PROJECT_ID && supabase db push` on
  push to `main` (needs `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`
  secrets). Prefer the integration — one deploy path, and it also handles
  Edge Functions and storage buckets.
