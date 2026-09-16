#!/usr/bin/env bash
# Answers one question: is the API that is live the API that is in this working tree?
#
# A container that boots and passes its healthcheck tells you nothing about which build is in it.
# An API deployed before a milestone landed serves `/health` exactly like a current one and simply
# 404s the routes it has never heard of — and a 404 on a webhook is a silence, not an alarm. So
# `/health` reports the commit it was built from and this compares it with HEAD.
#
# Usage: scripts/check-deploy.sh [api-base-url]
set -euo pipefail

API_BASE="${1:-${API_BASE:-https://api-production-c5c7.up.railway.app}}"

command -v jq >/dev/null 2>&1 || { echo "check-deploy: jq is required" >&2; exit 1; }

local_sha=$(git rev-parse HEAD)

# Captured whole rather than piped into a truncating filter: under `set -o pipefail` a reader that
# closes early kills the writer with SIGPIPE and a healthy deploy reads as a failed one.
if ! health=$(curl -fsS --max-time 15 "$API_BASE/health"); then
  echo "check-deploy: $API_BASE/health did not answer" >&2
  exit 1
fi

deployed_sha=$(jq -r '.sha // "unknown"' <<<"$health")

if [[ "$deployed_sha" == "unknown" ]]; then
  echo "check-deploy: the deploy reports no commit — it predates GIT_SHA, so redeploy it:"
  echo "  scripts/deploy-api.sh"
  exit 1
fi

if [[ "$deployed_sha" == "$local_sha" ]]; then
  echo "check-deploy: live and HEAD agree — ${local_sha:0:12}"
  exit 0
fi

echo "check-deploy: the live API is not this commit."
echo "  live: ${deployed_sha:0:12}"
echo "  HEAD: ${local_sha:0:12}"
if git cat-file -e "$deployed_sha" 2>/dev/null; then
  behind=$(git rev-list --count "$deployed_sha..HEAD" 2>/dev/null || echo '?')
  echo "  the deploy is $behind commit(s) behind HEAD:"
  git log --oneline "$deployed_sha..HEAD" -- apps/api packages/shared | sed 's/^/    /'
fi
echo "  redeploy with: scripts/deploy-api.sh"
exit 1
