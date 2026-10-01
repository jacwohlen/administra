---
name: prod-release
description: Promote main to prod (production release). Use when asked to make a prod release, promote main to prod, or open/merge a main → prod promotion PR. Covers the release notes that go into the promotion PR and its merge commit.
---

# Production release (main → prod)

A production release is a promotion PR from `main` into `prod`
(see `docs/SUPABASE_BRANCHING.md`). Merging it applies new migrations to the
Prod Supabase project and deploys admin.jacwohlen.ch.

## Steps

1. Collect what is new since the last release:
   ```sh
   git fetch origin main prod
   git log --oneline --no-merges origin/prod..origin/main
   ```
   Check `supabase/migrations/` for new files in that range
   (`git diff --name-only origin/prod...origin/main -- supabase/migrations`).
2. Open a PR with base `prod` and head `main`, titled
   `Promote main to prod: <short summary of the main features>`.
3. Write the release notes (below) as the PR body.
4. Merge with **"Create a merge commit"** — never squash or rebase. Use the
   release notes as the merge commit message body, so `git log origin/prod
--merges` reads as a changelog.

## Release notes (PR body and merge commit body)

List the changes **at a high level, from the user's point of view** — what
admins, trainers and members notice — not commit by commit. Group related
PRs into one bullet and leave out pure refactors, CI and tooling changes
unless they affect operations.

```
Features
- Probetraining: intake status, waiting list, e-mails and a status page (#111)
- Redesigned stats page with dark mode and retention details (#109)

Fixes
- Black-belt badge is no longer picked as a member's top badge (#117)

Database migrations
- <timestamp>_<name>.sql — what it changes, in one line

Notes
- New env vars / manual steps after deploy, if any (otherwise omit)
```

Omit empty sections. Always state whether migrations are included (write
`Database migrations: none` if there are none), since they hit production
data on merge.
