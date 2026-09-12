#!/usr/bin/env bash

# Creates Mibo's private Photo Proof bucket and the bucket-scoped credentials used by Railway.
# Requires one bootstrap Cloudflare token with Workers R2 Storage Write and Account API Tokens
# Write. Everything after that initial Cloudflare grant is scripted and repeatable.

set -euo pipefail

API=https://api.cloudflare.com/client/v4
R2_BUCKET="${R2_BUCKET:-mibo-photo-proof}"

need() {
  command -v "$1" >/dev/null 2>&1 || { printf 'missing command: %s\n' "$1" >&2; exit 1; }
}

need curl
need jq
need openssl
need railway

if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  read -r -p 'Cloudflare account id: ' CLOUDFLARE_ACCOUNT_ID
fi
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  read -r -s -p 'Bootstrap Cloudflare API token: ' CLOUDFLARE_API_TOKEN
  printf '\n'
fi

case "$R2_BUCKET" in
  *[!a-z0-9-]*|'') printf 'R2_BUCKET must contain only lowercase letters, digits and hyphens\n' >&2; exit 1 ;;
esac

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

cf() {
  local method="$1" path="$2" data="${3:-}" out="$tmp_dir/response.json" status
  local -a args=(
    --silent --show-error --output "$out" --write-out '%{http_code}'
    --request "$method" "$API$path"
    --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
    --header 'Content-Type: application/json'
  )
  [[ -n "$data" ]] && args+=(--data "$data")
  status=$(curl "${args[@]}")
  if [[ "$status" -lt 200 || "$status" -ge 300 ]] || ! jq -e '.success == true' "$out" >/dev/null; then
    jq '{errors, messages}' "$out" >&2 || true
    printf 'Cloudflare API request failed: %s %s (HTTP %s)\n' "$method" "$path" "$status" >&2
    exit 1
  fi
  cat "$out"
}

printf 'Creating private R2 bucket %s if needed…\n' "$R2_BUCKET"
bucket_path="/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/$R2_BUCKET"
status=$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$API$bucket_path")
if [[ "$status" == 404 ]]; then
  cf POST "/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets" \
    "$(jq -cn --arg name "$R2_BUCKET" '{name: $name}')" >/dev/null
elif [[ "$status" != 200 ]]; then
  printf 'Could not inspect R2 bucket (HTTP %s)\n' "$status" >&2
  exit 1
fi

printf 'Applying presigned PUT/GET CORS policy…\n'
cf PUT "$bucket_path/cors" '{
  "rules": [{
    "id": "photo-proof-presigned-urls",
    "allowed": {
      "origins": ["*"],
      "methods": ["GET", "PUT"],
      "headers": ["content-type"]
    },
    "maxAgeSeconds": 3600
  }]
}' >/dev/null

printf 'Applying the 30-day deletion lifecycle…\n'
cf PUT "$bucket_path/lifecycle" '{
  "rules": [{
    "id": "delete-photo-proof-after-30-days",
    "enabled": true,
    "conditions": {"prefix": "children/"},
    "deleteObjectsTransition": {
      "condition": {"type": "Age", "maxAge": 2592000}
    }
  }]
}' >/dev/null

printf 'Writing R2 configuration to Railway service api…\n'
railway variable set "R2_ACCOUNT_ID=$CLOUDFLARE_ACCOUNT_ID" --service api --skip-deploys >/dev/null
railway variable set "R2_BUCKET=$R2_BUCKET" --service api --skip-deploys >/dev/null

# Cloudflare returns the token secret only once. If Railway already has both halves, preserve them
# on repeat runs while still reconciling the bucket policies above.
railway_vars=$(railway variable list --service api --json)
if jq -e 'has("R2_ACCESS_KEY_ID") and has("R2_SECRET_ACCESS_KEY")' <<<"$railway_vars" >/dev/null; then
  printf 'Keeping the existing bucket-scoped S3 credentials in Railway.\n'
else
  printf 'Creating bucket-scoped S3 credentials…\n'
  groups=$(cf GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/tokens/permission_groups")
  object_write_id=$(jq -er '.result[] | select(.name == "Workers R2 Storage Bucket Item Write") | .id' <<<"$groups" | head -n1)
  resource="com.cloudflare.edge.r2.bucket.${CLOUDFLARE_ACCOUNT_ID}_default_${R2_BUCKET}"
  token_body=$(jq -cn \
    --arg name "Mibo API - $R2_BUCKET" \
    --arg permission "$object_write_id" \
    --arg resource "$resource" \
    '{name: $name, policies: [{effect: "allow", permission_groups: [{id: $permission}], resources: {($resource): "*"}}]}')
  token=$(cf POST "/accounts/$CLOUDFLARE_ACCOUNT_ID/tokens" "$token_body")
  access_key_id=$(jq -er '.result.id' <<<"$token")
  token_value=$(jq -er '.result.value' <<<"$token")
  secret_access_key=$(printf '%s' "$token_value" | openssl dgst -sha256 -hex | awk '{print $NF}')
  printf '%s' "$access_key_id" | railway variable set R2_ACCESS_KEY_ID --stdin --service api --skip-deploys >/dev/null
  printf '%s' "$secret_access_key" | railway variable set R2_SECRET_ACCESS_KEY --stdin --service api >/dev/null
fi

printf 'R2 setup complete: %s (private, CORS configured, delete after 30 days).\n' "$R2_BUCKET"
