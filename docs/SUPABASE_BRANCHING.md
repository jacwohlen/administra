# Supabase Branching: Preview Databases per PR, Auto-Deploy on Merge

This document describes how Administra's database changes flow from a pull
request to production, the environment layout, and what remains to verify.

## Environments

| Environment   | Git branch     | Supabase                                                         | Frontend URL                  |
| ------------- | -------------- | ---------------------------------------------------------------- | ----------------------------- |
| Production    | `prod`         | Administra (Prod) — `hyppoiywqpfkvvcrmsdl`, PG 15                | admin.jacwohlen.ch            |
| Dev / staging | `main`         | Persistent branch `dev` — `kbnnwrazgeuqlizjqqgb` (child of Prod) | main.admin.jacwohlen.ch       |
| PR previews   | feature branch | Ephemeral preview branches off the Prod project                  | Netlify Deploy Preview per PR |

Feature PRs target `main`. Production releases are promotion PRs merging
`main` into `prod`. `supabase/config.toml` has `major_version = 15` to match
the Prod project (all branches clone from Prod).

The `dev` environment is a **persistent branch** of the Prod project,
declared as `[remotes.dev]` in `config.toml`. Linked to git branch `main`
in the dashboard, it re-runs the deployment workflow (migrations, config,
functions) on every push to `main`. It replaces the former standalone
"Administra (Dev)" project (`hkxeuofxdxkviqrfnfns`), which had no GitHub
connection and therefore never received migrations automatically; delete
that project once the cutover is verified.

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
   - **Netlify** builds a Deploy Preview. In the deploy-preview context,
     `scripts/netlify-preview-supabase-env.sh` resolves the PR's preview
     branch via the Supabase CLI and exports its
     `PUBLIC_SUPABASE_DATABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY`, so the
     Deploy Preview talks to the preview database. PRs without a preview
     branch fall back to the env vars configured in Netlify.
   - **GitHub Actions** validates migrations independently (`db-validate`
     job in `ci.yml`) and mirrors the Supabase Preview check
     (`supabase-preview-status.yml`) so broken migrations block the merge.
3. Each further push to the PR applies only the _new_ migrations to the
   preview branch.
4. Merge the PR into `main`: new migrations are applied to the persistent
   **dev** branch and the preview branch is deleted.
   main.admin.jacwohlen.ch is the integration environment.
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
- Migration deployment on merge to `prod` is working (verified via the
  Management API). Deployment to the dev environment goes through the
  persistent `dev` branch's git link (set in the dashboard).
- Still worth double-checking in the dashboards (not readable via API):
  - **Supabase changes only** toggle in the GitHub integration (avoids
    paying for preview branches on frontend-only PRs).
  - Branch secrets for the `env()` references in `config.toml` (see below).
- Verified 2026-09-05 on PR #81: the Netlify Supabase extension does
  **not** inject per-PR branch credentials — the Deploy Preview was built
  with the dev-context env vars (Dev project data, `PUBLIC_MODE=DEV`
  banner). That is why deploy previews now run through the resolver
  script below.

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

**Secrets are copied from the parent project only at branch creation.**
A branch created before a secret existed never sees it — set the secret
directly on that branch's project ref as well (done for the `dev` branch,
`--project-ref kbnnwrazgeuqlizjqqgb`). Ephemeral preview branches are
recreated per PR, so they always pick up the parent's current secrets.

## Netlify

Supabase has a first-party branching integration only for Vercel; on
Netlify the Supabase extension syncs credentials of one fixed project per
deploy context and is not branch-aware. Deploy Previews therefore run
through a build wrapper (`[context.deploy-preview]` in `netlify.toml`):

- `scripts/netlify-preview-supabase-env.sh` asks the Supabase CLI for the
  preview branch matching the PR's git branch (`$HEAD`), retrying while
  the branch is still provisioning, and exports its URL and anon key as
  `PUBLIC_SUPABASE_DATABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY` before
  `npm run build`.
- If no branch exists (frontend-only PR, or missing credentials), the
  build falls back to the site's configured env vars.

One-time Netlify setup (Site configuration → Environment variables — done
2026-09-05):

- `SUPABASE_ACCESS_TOKEN` — a Supabase personal access token
  (https://supabase.com/dashboard/account/tokens). Mark it as a **secret**
  value; since the repo is public, also set the sensitive variable policy
  so untrusted (fork) deploy previews don't receive it.
- `SUPABASE_PROJECT_ID` — `hyppoiywqpfkvvcrmsdl` (the Prod project, whose
  preview branches these are).

Branch deploys (`main` → main.admin.jacwohlen.ch) use the persistent
`dev` branch: in the **branch-deploy** context set
`PUBLIC_SUPABASE_DATABASE_URL=https://kbnnwrazgeuqlizjqqgb.supabase.co`
and the dev branch's anon key. Use the same values as the
**deploy-preview** fallback so no preview ever talks to production.
Production keeps the Prod project values.

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
  Google OAuth client does not know about, so Google login fails on Deploy
  Previews wired to a preview branch. Use the seeded test user from
  `seed.sql` (`test@example.com` / `testpass`) instead, or add the branch
  callback to the Google Cloud OAuth client while testing.
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
