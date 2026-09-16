#!/usr/bin/env bash
# Deploys `apps/api` to Railway, stamped with the commit it was built from.
#
# `railway up` uploads a directory, not a git ref, so the platform has no idea which commit it just
# built. Railway hands a Dockerfile build its service variables as build arguments, so setting
# GIT_SHA immediately before the upload is what lets `/health` — and `scripts/check-deploy.sh` —
# say which build is live. `--skip-deploys` keeps that variable write from triggering a second,
# unstamped deploy of its own.
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

command -v railway >/dev/null 2>&1 || { echo "deploy-api: railway CLI is required" >&2; exit 1; }

if [[ -n "$(git status --porcelain -- apps/api packages/shared)" ]]; then
  echo "deploy-api: apps/api or packages/shared has uncommitted changes."
  echo "  The upload would ship them while GIT_SHA claims HEAD, which is the exact lie this"
  echo "  script exists to prevent. Commit or stash them first."
  exit 1
fi

sha=$(git rev-parse HEAD)
echo "deploy-api: deploying ${sha:0:12}"

railway variable set "GIT_SHA=$sha" --service api --skip-deploys >/dev/null
railway up --service api --ci

echo "deploy-api: verifying"
scripts/check-deploy.sh
