#!/usr/bin/env bash
# Restores a backup produced by scripts/backup.sh.
#
# Two modes:
#   scripts/restore.sh <dump.gpg> --target <db-name> [--files <tar.gz>]
#       Restores into a NEW or existing database of your choosing (createdb
#       if it doesn't exist yet). Safe default for drills — see
#       scripts/restore-drill.sh, which wraps this in the monthly-drill
#       flow from kindergarten-docs/docs/06-ops-reference.md §6.
#
#   scripts/restore.sh <dump.gpg> --target "$PGDATABASE" --yes-overwrite-production [--files <tar.gz>]
#       Restores over the database DATABASE_URL already points at. This is
#       real disaster recovery, not a drill — `--yes-overwrite-production`
#       is required so this can never happen from a mistyped argument.
#
# Needs one of BACKUP_GPG_RECIPIENT's private key available to gpg, or
# BACKUP_GPG_PASSPHRASE, matching however the dump was encrypted.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

DUMP_FILE="${1:-}"
TARGET_DB=""
FILES_TAR=""
CONFIRM_PROD=false

shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET_DB="$2"; shift 2 ;;
    --files) FILES_TAR="$2"; shift 2 ;;
    --yes-overwrite-production) CONFIRM_PROD=true; shift ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$DUMP_FILE" ] || [ -z "$TARGET_DB" ]; then
  echo "Usage: scripts/restore.sh <dump.gpg> --target <db-name> [--files <tar.gz>] [--yes-overwrite-production]" >&2
  exit 1
fi
[ -f "$DUMP_FILE" ] || { echo "dump file not found: $DUMP_FILE" >&2; exit 1; }

for bin in pg_restore gpg createdb psql; do
  command -v "$bin" >/dev/null 2>&1 || { echo "required binary not found: $bin" >&2; exit 1; }
done

# shellcheck source=lib/pg-env.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/pg-env.sh"
LIVE_DB="$PGDATABASE"

if [ "$TARGET_DB" = "$LIVE_DB" ] && [ "$CONFIRM_PROD" != true ]; then
  echo "Refusing to restore over '$LIVE_DB' (the database DATABASE_URL points at) without --yes-overwrite-production." >&2
  echo "For a drill, use --target with a different, scratch database name instead." >&2
  exit 1
fi

DECRYPTED="$(mktemp)"
trap 'rm -f "$DECRYPTED"' EXIT

echo "==> Decrypting $DUMP_FILE"
if [ -n "${BACKUP_GPG_PASSPHRASE:-}" ]; then
  gpg --batch --yes --decrypt --passphrase "$BACKUP_GPG_PASSPHRASE" -o "$DECRYPTED" "$DUMP_FILE"
else
  gpg --batch --yes --decrypt -o "$DECRYPTED" "$DUMP_FILE"
fi

PGDATABASE=postgres createdb --owner="$PGUSER" "$TARGET_DB" 2>/dev/null || true
export PGDATABASE="$TARGET_DB"

echo "==> Restoring into '$TARGET_DB'"
pg_restore --clean --if-exists --no-owner --dbname="$TARGET_DB" "$DECRYPTED"

if [ -n "$FILES_TAR" ]; then
  RESTORE_FILES_DIR="${RESTORE_FILES_DIR:-./data/files-restored}"
  echo "==> Extracting file storage archive to $RESTORE_FILES_DIR"
  mkdir -p "$RESTORE_FILES_DIR"
  tar xzf "$FILES_TAR" -C "$RESTORE_FILES_DIR"
fi

echo "==> Verification queries (kindergarten-docs/docs/06-ops-reference.md §6):"
psql -d "$TARGET_DB" -c "SELECT count(*) AS active_children FROM child WHERE deleted_at IS NULL;"
psql -d "$TARGET_DB" -c "SELECT sum(amount_tiyin * sign) AS total_charges FROM charge;"
psql -d "$TARGET_DB" -c "SELECT sum(amount_tiyin * sign) AS total_payments FROM payment;"
psql -d "$TARGET_DB" -c "SELECT max(occurred_at) AS latest_audit_entry FROM audit_log;"

echo "==> Restore into '$TARGET_DB' complete. Review the counts above before trusting this database."
