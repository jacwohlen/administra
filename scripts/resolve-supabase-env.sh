#!/usr/bin/env bash
# scripts/resolve-supabase-env.sh
#
# Resolves the correct Supabase URL and anon key for the current deploy context.
# On Netlify preview deploys, fetches the Supabase Branch credentials via the Management API.
# On production deploys, uses the env vars already set in Netlify.
#
# Required Netlify environment variables:
#   PUBLIC_SUPABASE_URL       - Production Supabase URL (set in Netlify dashboard)
#   PUBLIC_SUPABASE_ANON_KEY  - Production anon key (set in Netlify dashboard)
#   SUPABASE_ACCESS_TOKEN     - Personal access token for Supabase Management API
#   SUPABASE_PROJECT_REF      - Your Supabase project reference ID (e.g. "abcdefghijklmnop")
#
# Netlify provides these automatically:
#   CONTEXT                   - "production", "deploy-preview", or "branch-deploy"
#   HEAD                      - Git branch name being deployed

set -euo pipefail

echo "==> Supabase env resolver"
echo "    Deploy context: ${CONTEXT:-unknown}"
echo "    Git branch:     ${HEAD:-unknown}"

# Only fetch branch credentials for non-production deploys
if [ "${CONTEXT:-}" != "production" ] && [ -n "${SUPABASE_ACCESS_TOKEN:-}" ] && [ -n "${SUPABASE_PROJECT_REF:-}" ]; then
  BRANCH="${HEAD:-}"

  if [ -z "$BRANCH" ]; then
    echo "    No branch detected, using production credentials."
    exit 0
  fi

  echo "    Fetching Supabase branch credentials for: $BRANCH"

  # List all branches and find the one matching our git branch
  RESPONSE=$(curl -s -f \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
    "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/branches") || {
    echo "    WARNING: Failed to fetch branches from Supabase API. Using production credentials."
    exit 0
  }

  # Extract the branch database info using node (available in Netlify build)
  BRANCH_INFO=$(node -e "
    const branches = JSON.parse(process.argv[1]);
    const branch = branches.find(b => b.git_branch === '${BRANCH}');
    if (branch) {
      console.log(JSON.stringify({
        url: 'https://' + branch.project_ref + '.supabase.co',
        anon_key: branch.anon_key || '',
        status: branch.status
      }));
    } else {
      console.log(JSON.stringify({ url: '', anon_key: '', status: 'not_found' }));
    }
  " "$RESPONSE") || {
    echo "    WARNING: Failed to parse branch info. Using production credentials."
    exit 0
  }

  BRANCH_URL=$(echo "$BRANCH_INFO" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).url)")
  BRANCH_KEY=$(echo "$BRANCH_INFO" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).anon_key)")
  BRANCH_STATUS=$(echo "$BRANCH_INFO" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).status)")

  if [ -n "$BRANCH_URL" ] && [ -n "$BRANCH_KEY" ]; then
    echo "    Branch DB found (status: $BRANCH_STATUS)"
    echo "    Overriding Supabase env vars with branch credentials."

    # Write to .env file for SvelteKit to pick up
    echo "PUBLIC_SUPABASE_URL=${BRANCH_URL}" >> .env
    echo "PUBLIC_SUPABASE_ANON_KEY=${BRANCH_KEY}" >> .env

    echo "    PUBLIC_SUPABASE_URL=${BRANCH_URL}"
    echo "    PUBLIC_SUPABASE_ANON_KEY=<redacted>"
  else
    echo "    No branch DB found for '$BRANCH'. Using production credentials."
    echo "    (Branch may still be provisioning. Status: $BRANCH_STATUS)"
  fi
else
  echo "    Production deploy or missing API credentials. Using default env vars."
fi
