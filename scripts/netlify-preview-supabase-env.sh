#!/usr/bin/env bash
# Netlify Deploy Preview wrapper: point the build at the PR's Supabase
# preview branch, then run the real build command passed as arguments.
#
# The Netlify Supabase extension only syncs credentials of one fixed
# project per deploy context — it knows nothing about per-PR preview
# branches — so this script resolves the branch matching the PR's git
# branch via the Supabase CLI and exports its URL and anon key as
# PUBLIC_SUPABASE_DATABASE_URL / PUBLIC_SUPABASE_ANON_KEY before the
# build. If no branch exists (frontend-only PR, branching disabled, or
# missing credentials), the build falls back to the env vars already
# configured in Netlify. See docs/SUPABASE_BRANCHING.md.
#
# Required Netlify env vars (deploy-preview scope is enough):
#   SUPABASE_ACCESS_TOKEN  - Supabase personal access token (mark as secret)
#   SUPABASE_PROJECT_ID    - parent project ref (hyppoiywqpfkvvcrmsdl)
# Provided by Netlify:
#   CONTEXT (deploy-preview), HEAD (the PR's git branch)

set -euo pipefail

log() { echo "[supabase-preview-env] $*"; }

# Strip the surrounding double quotes of a KEY="value" line emitted by
# `supabase branches get -o env`.
env_value() {
  local line="$1"
  line="${line#*=}"
  line="${line#\"}"
  line="${line%\"}"
  printf '%s' "$line"
}

resolve_branch_env() {
  if [ "${CONTEXT:-}" != "deploy-preview" ]; then
    log "context '${CONTEXT:-unknown}' is not deploy-preview; using configured env vars"
    return 0
  fi
  if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ] || [ -z "${SUPABASE_PROJECT_ID:-}" ]; then
    log "SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_ID not set; using configured env vars"
    return 0
  fi
  local git_branch="${HEAD:-}"
  if [ -z "$git_branch" ]; then
    log "HEAD not set; using configured env vars"
    return 0
  fi

  # The Supabase branch is provisioned in parallel with this build and
  # usually takes ~1-2 minutes, so retry for a while before falling back.
  local attempt out url anon errfile
  errfile=$(mktemp)
  for attempt in $(seq 1 8); do
    if out=$(npx supabase --experimental branches get "$git_branch" -o env 2>"$errfile"); then
      url=$(env_value "$(grep -m1 '^SUPABASE_URL=' <<<"$out" || true)")
      anon=$(env_value "$(grep -m1 '^SUPABASE_ANON_KEY=' <<<"$out" || true)")
      if [ -z "$anon" ] || [ "$anon" = "******" ]; then
        anon=$(env_value "$(grep -m1 '^SUPABASE_PUBLISHABLE_KEY=' <<<"$out" || true)")
      fi
      if [ -n "$url" ] && [ -n "$anon" ] && [ "$anon" != "******" ]; then
        export PUBLIC_SUPABASE_DATABASE_URL="$url"
        export PUBLIC_SUPABASE_ANON_KEY="$anon"
        log "using Supabase preview branch for '$git_branch': $url"
        return 0
      fi
    fi
    log "preview branch for '$git_branch' not ready (attempt $attempt/8); retrying in 15s"
    log "supabase CLI said: $(tr '\n' ' ' <"$errfile" | head -c 300)"
    sleep 15
  done
  log "no Supabase preview branch found for '$git_branch'; using configured env vars"
}

resolve_branch_env
log "building with PUBLIC_SUPABASE_DATABASE_URL=${PUBLIC_SUPABASE_DATABASE_URL:-<unset>}"
exec "$@"
