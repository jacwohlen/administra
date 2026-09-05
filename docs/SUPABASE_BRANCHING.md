# Supabase Branching: Preview Databases per PR, Auto-Deploy on Merge

This document describes how Administra's database changes flow from a pull
request to production, the environment layout, and what remains to verify.

## Environments

| Environment   | Git branch     | Supabase project                                  | Frontend URL                  |
| ------------- | -------------- | ------------------------------------------------- | ----------------------------- |
| Production    | `prod`         | Administra (Prod) — `hyppoiywqpfkvvcrmsdl`, PG 15 | admin.jacwohlen.ch            |
| Dev / staging | `main`         | Administra (Dev) — `hkxeuofxdxkviqrfnfns`, PG 17  | main.admin.jacwohlen.ch       |
| PR previews   | feature branch | Ephemeral preview branches off the Prod project   | Netlify Deploy Preview per PR |

Feature PRs target `main`. Production releases are promotion PRs merging
`main` into `prod`. `supabase/config.toml` has `major_version = 15` to match
the Prod project (preview branches clone from Prod); revisit when Prod is
upgraded to Postgres 17 like the Dev project.

## Workflow

1. Create a feature branch, add a migration
   (`supabase migration new <name>`, test locally with `supabase db reset`).
2. Open a PR against `main`. Automatically:
   - **Supabase** creates an ephemeral **preview branch** off the Prod
     project — a full, isolated Supabase instance (database + auth +
     storage + API) with its own URL and API keys. All migrations in
     `supabase/migrations/` are applied to it and `supabase/seed.sql` seeds
     it. Supabase comments on the PR and posts a **"Supabase Preview"**
     check.
   - **Netlify** builds a Deploy Preview. The Supabase extension for
     Netlify injects the preview branch's `PUBLIC_SUPABASE_DATABASE_URL`
     and `PUBLIC_SUPABASE_ANON_KEY`, so the Deploy Preview talks to the
     preview database, not production.
   - **GitHub Actions** validates migrations independently (`db-validate`
     job in `ci.yml`) and mirrors the Supabase Preview check
     (`supabase-preview-status.yml`) so broken migrations block the merge.
3. Each further push to the PR applies only the _new_ migrations to the
   preview branch.
4. Merge the PR into `main`: new migrations are applied to the **Dev**
   project and the preview branch is deleted. main.admin.jacwohlen.ch is
   the integration environment.
5. Promote by opening/merging a PR from `main` into `prod`: Supabase
   applies the new migrations to the **Prod** project (plus Edge Functions
   and storage buckets declared in `config.toml`), and Netlify deploys
   admin.jacwohlen.ch.

Preview branches contain **no production data** — only what migrations
create and `seed.sql` inserts. Seed data changes are never merged onward.

## Current state (verified via the Management API, 2026-09-05)

- The GitHub integration with **automatic branching is enabled** on the
  Prod project: preview branches exist for open PRs and the project's
  default branch tracks git branch `prod`.
- All 11 repo migrations are applied on **both** the Prod and Dev
  projects — migration deployment on merge is working.
- Still worth double-checking in the dashboards (not readable via API):
  - **Supabase changes only** toggle in the GitHub integration (avoids
    paying for preview branches on frontend-only PRs).
  - Branch secrets for the `env()` references in `config.toml` (see below).
  - Netlify Supabase extension env-var mapping for Deploy Previews (see
    verification checklist).

## Costs

Preview branches are billed **per active hour** (cents/hour) for as long as
the PR stays open. A PR left open for months keeps its preview branch — and
its bill — running the whole time. Merge or close PRs promptly, or delete
the idle preview branch in the Supabase dashboard (it is recreated on the
next push to the PR).

## Secrets for `config.toml` on preview branches

Preview branches apply this repo's `config.toml`, which references
environment variables via `env(...)`. Set these once as project secrets so
the branching executor can resolve them (they are inherited by branches):

```bash
supabase secrets set --project-ref hyppoiywqpfkvvcrmsdl \
  PUBLIC_SUPABASE_SITE_URL="https://admin.jacwohlen.ch" \
  PRIVATE_SUPABASE_AUTH_GOOGLE_CLIENT_ID="..." \
  PRIVATE_SUPABASE_AUTH_GOOGLE_SECRET="..." \
  PRIVATE_SUPABASE_AUTH_GOOGLE_CALLBACK_URI="..."
```

Unset variables resolve to empty strings, which can make the branch's
`configure` step fail or silently disable Google login on previews.

## Netlify

The Supabase extension for Netlify is installed on the site and connected
to the Supabase project, with the environment variable names configured as
`PUBLIC_SUPABASE_DATABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY` (matching
`src/lib/supabase.ts`). It keeps these in sync per deploy context.

`netlify.toml` stays a plain `npm run build` — no env-resolver script is
needed (removed in #73).

## GitHub branch protection

In **GitHub → Settings → Branches** (or a ruleset), require status checks
before merging:

- On `main`: `db-validate` (catches broken migrations even without
  branching), `preview-branch` (from `supabase-preview-status.yml` —
  mirrors the Supabase Preview deployment result; only runs on PRs
  touching `supabase/**`), plus `lint-and-check` / `unit-tests` / `build`
  as desired.
- On `prod`: the same CI checks for promotion PRs.

Alternatively require the Supabase integration's own **Supabase Preview**
check directly.

## Verification checklist

1. Create a branch with a trivial migration, e.g.
   `supabase migration new noop` containing `select 1;`, and open a PR
   against `main`.
2. On the PR you should see: a Supabase comment with the preview branch
   status, the **Supabase Preview** check, and the `db-validate` /
   `preview-branch` CI jobs.
3. Open the Netlify Deploy Preview and verify in the browser dev tools
   that requests go to `https://<branch-ref>.supabase.co`, **not** the
   Prod or Dev project URL. (If the Deploy Preview built before the
   Supabase branch finished provisioning, trigger "Retry deploy" once.)
4. Merge to `main`: check the migration appears on the Dev project and the
   preview branch is deleted. Promote `main` → `prod`: check the migration
   appears on the Prod project.

## Caveats and tips

- **Google login on previews**: each preview branch has its own auth
  callback (`https://<branch-ref>.supabase.co/auth/v1/callback`), which the
  Google OAuth client does not know about. Options: add the branch
  callback to the Google Cloud OAuth client while testing, seed an
  email/password test user for previews, or accept that login is
  untestable on previews and covered locally instead.
- **Never edit an already-merged migration** — the Dev/Prod databases have
  already run it. Always add a new migration file.
- **Rolling back on a PR**: if you amend/replace a migration that the
  preview branch already applied, reset the branch from the Supabase
  dashboard (or close and reopen the PR) to re-run all migrations from
  scratch. Resets drop the branch's data and re-seed.
- **Seeding happens once**, at branch creation. Changing `seed.sql` on an
  open PR does not re-seed; reset the branch to pick it up.
- **Manual fallback**: `supabase link --project-ref <ref> && supabase db push`
  applies pending migrations directly to a project. Prefer the
  integration — one deploy path, and it also handles Edge Functions and
  storage buckets.
