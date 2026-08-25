#!/usr/bin/env bash
# The monthly restore drill from kindergarten-docs/docs/06-ops-reference.md
# §6: "A backup that has never been restored is not a backup." Restores the
# latest nightly dump into a throwaway database, runs the verification
# queries, drops the database, and appends a pass/fail line to the drill
# log — put this on a monthly cron and treat a missed or failing run as an
# incident, per that doc.
#
# Usage: scripts/restore-drill.sh
# Optional env: BACKUP_DIR (default /backup), DRILL_LOG (default
#   "$BACKUP_DIR/restore-drill.log")

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

BACKUP_DIR="${BACKUP_DIR:-/backup}"
DRILL_LOG="${DRILL_LOG:-$BACKUP_DIR/restore-drill.log}"
TARGET_DB="kg_restore_drill_$(date +%s)"

LATEST_DUMP="$(ls -t "$BACKUP_DIR"/kg-*.dump.gpg 2>/dev/null | head -n1)"
if [ -z "$LATEST_DUMP" ]; then
  echo "$(date -Iseconds) FAIL no backup file found in $BACKUP_DIR" >> "$DRILL_LOG"
  echo "No backup file found in $BACKUP_DIR" >&2
  exit 1
fi

echo "==> Drilling against $LATEST_DUMP (target db: $TARGET_DB)"
OUTPUT="$(mktemp)"
if "$(dirname "${BASH_SOURCE[0]}")/restore.sh" "$LATEST_DUMP" --target "$TARGET_DB" > "$OUTPUT" 2>&1; then
  RESULT="PASS"
else
  RESULT="FAIL"
fi
cat "$OUTPUT"

# shellcheck source=lib/pg-env.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/pg-env.sh"
PGDATABASE=postgres dropdb --if-exists "$TARGET_DB"

echo "$(date -Iseconds) $RESULT backup=$(basename "$LATEST_DUMP") target=$TARGET_DB" >> "$DRILL_LOG"
echo "==> Drill result: $RESULT (logged to $DRILL_LOG)"
rm -f "$OUTPUT"

[ "$RESULT" = "PASS" ]
