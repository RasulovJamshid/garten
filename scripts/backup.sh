#!/usr/bin/env bash
# Nightly backup, per kindergarten-docs/docs/06-ops-reference.md §6:
#   - full logical DB dump, GPG-encrypted
#   - local-driver file storage archived alongside it (S3 is replicated by
#     the provider / `mc mirror` separately — see that doc's table)
#   - retention: 30 daily, 12 weekly, 12 monthly
#
# Required env: DATABASE_URL
# Also needs one of: BACKUP_GPG_RECIPIENT (asymmetric) or
#   BACKUP_GPG_PASSPHRASE (symmetric) — an unencrypted backup of financial
#   and PII data is not an acceptable default, so this refuses to run
#   without one (kindergarten-docs/docs/06-ops-reference.md §3 "fail fast").
# Optional env: BACKUP_DIR (default /backup), STORAGE_DRIVER, STORAGE_LOCAL_PATH
#
# Usage: scripts/backup.sh
# Intended to run from cron/systemd-timer at 02:00, per the doc.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

BACKUP_DIR="${BACKUP_DIR:-/backup}"
DATE_STAMP="$(date +%F)"
DB_DUMP_PATH="$BACKUP_DIR/kg-$DATE_STAMP.dump.gpg"
FILES_TAR_PATH="$BACKUP_DIR/files-$DATE_STAMP.tar.gz"

for bin in pg_dump gpg node; do
  command -v "$bin" >/dev/null 2>&1 || { echo "required binary not found: $bin" >&2; exit 1; }
done

if [ -z "${BACKUP_GPG_RECIPIENT:-}" ] && [ -z "${BACKUP_GPG_PASSPHRASE:-}" ]; then
  echo "Refusing to back up unencrypted: set BACKUP_GPG_RECIPIENT or BACKUP_GPG_PASSPHRASE." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
# shellcheck source=lib/pg-env.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/pg-env.sh"

echo "==> Dumping database '$PGDATABASE' from $PGHOST:$PGPORT"
if [ -n "${BACKUP_GPG_RECIPIENT:-}" ]; then
  pg_dump -Fc | gpg --batch --yes --encrypt --recipient "$BACKUP_GPG_RECIPIENT" -o "$DB_DUMP_PATH"
else
  pg_dump -Fc | gpg --batch --yes --symmetric --passphrase "$BACKUP_GPG_PASSPHRASE" --cipher-algo AES256 -o "$DB_DUMP_PATH"
fi
echo "    wrote $DB_DUMP_PATH ($(du -h "$DB_DUMP_PATH" | cut -f1))"

STORAGE_DRIVER="${STORAGE_DRIVER:-local}"
if [ "$STORAGE_DRIVER" = "local" ]; then
  STORAGE_LOCAL_PATH="${STORAGE_LOCAL_PATH:-./data/files}"
  if [ -d "$STORAGE_LOCAL_PATH" ]; then
    echo "==> Archiving local file storage from $STORAGE_LOCAL_PATH"
    tar czf "$FILES_TAR_PATH" -C "$(dirname "$STORAGE_LOCAL_PATH")" "$(basename "$STORAGE_LOCAL_PATH")"
    echo "    wrote $FILES_TAR_PATH ($(du -h "$FILES_TAR_PATH" | cut -f1))"
  else
    echo "==> STORAGE_LOCAL_PATH ($STORAGE_LOCAL_PATH) does not exist yet — skipping file archive" >&2
  fi
else
  echo "==> STORAGE_DRIVER=s3 — file storage is replicated separately (mc mirror / provider replication), not archived here"
fi

echo "==> Applying retention (30 daily / 12 weekly / 12 monthly)"
node "$(dirname "${BASH_SOURCE[0]}")/lib/prune-backups.js" "$BACKUP_DIR" "kg-" ".dump.gpg"
node "$(dirname "${BASH_SOURCE[0]}")/lib/prune-backups.js" "$BACKUP_DIR" "files-" ".tar.gz"

echo "==> Backup complete: $DATE_STAMP"
