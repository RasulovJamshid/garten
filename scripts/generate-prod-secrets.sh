#!/usr/bin/env bash
# Fills every REPLACE_ME_* placeholder in a .env.production file with a
# fresh random value, and keeps the values that must match each other
# (DB password, MinIO/S3 credentials) in sync — see the comments at the
# top of .env.production.example for why they can't just reference one
# another the way compose-file variables can.
#
# Usage:
#   cp .env.production.example .env.production
#   scripts/generate-prod-secrets.sh .env.production
#
# Does NOT touch UI_DOMAIN, API_DOMAIN, ACME_EMAIL, SEED_TENANT_*, SEED_OWNER_EMAIL, or
# anything under --- telegram / --- observability — those need real
# values you have to supply, not random ones. The script prints what
# still needs hand-filling when it's done.

set -euo pipefail

TARGET="${1:-}"
if [ -z "$TARGET" ] || [ ! -f "$TARGET" ]; then
  echo "Usage: scripts/generate-prod-secrets.sh <path-to-.env.production>" >&2
  echo "(file must already exist — copy it from .env.production.example first)" >&2
  exit 1
fi

command -v openssl >/dev/null 2>&1 || { echo "openssl is required" >&2; exit 1; }

rand_b64() { openssl rand -base64 "$1" | tr -d '\n=' | tr '+/' '-_'; }

JWT_SECRET="$(rand_b64 48)"
DB_PASSWORD="$(rand_b64 24)"
S3_SECRET="$(rand_b64 24)"
OWNER_PASSWORD="$(rand_b64 12)Aa1!" # printable, satisfies typical complexity checks

# In-place, portable sed (macOS/BSD sed needs `-i ''`; GNU sed needs `-i`
# with no arg before the script — the `.bak` extension trick works on both
# and we just delete the backup after).
sedi() { sed -i.bak -e "$1" "$TARGET" && rm -f "$TARGET.bak"; }

sedi "s#^JWT_SECRET=.*#JWT_SECRET=${JWT_SECRET}#"
sedi "s#^POSTGRES_PASSWORD=.*#POSTGRES_PASSWORD=${DB_PASSWORD}#"
sedi "s#^S3_SECRET_KEY=.*#S3_SECRET_KEY=${S3_SECRET}#"
sedi "s#^SEED_OWNER_PASSWORD=.*#SEED_OWNER_PASSWORD=${OWNER_PASSWORD}#"

# DATABASE_URL embeds the same DB password — replace just that segment
# rather than the whole line, so host/user/db name from the template survive.
sedi "s#^DATABASE_URL=postgresql://\\([^:]*\\):[^@]*@#DATABASE_URL=postgresql://\\1:${DB_PASSWORD}@#"

# S3_ACCESS_KEY has no strong-randomness requirement (it's a username, not
# a secret) — leave the template's REPLACE_ME_MINIO_USER for a human to
# pick, but only if they haven't already changed it.
if grep -q '^S3_ACCESS_KEY=REPLACE_ME' "$TARGET"; then
  sedi "s#^S3_ACCESS_KEY=.*#S3_ACCESS_KEY=kg_minio_prod#"
fi

echo "Generated: JWT_SECRET, POSTGRES_PASSWORD (+ DATABASE_URL), S3_SECRET_KEY, S3_ACCESS_KEY, SEED_OWNER_PASSWORD."
echo
echo "Owner login password (shown once — save it now, e.g. to a password manager):"
echo "  ${OWNER_PASSWORD}"
echo
echo "Still need hand-filling in $TARGET:"
grep -n 'REPLACE_ME' "$TARGET" || echo "  (nothing left — everything's filled)"
