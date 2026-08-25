#!/usr/bin/env bash
# The "Backup did not complete" monitoring check from
# kindergarten-docs/docs/06-ops-reference.md §6 ("No new file by 04:00" —
# a silent backup failure is the classic disaster). Wire this into whatever
# alerting already polls the server (cron + a mail/webhook, a Nagios-style
# check, etc.) — it just exits non-zero when the latest dump is stale.
#
# Usage: scripts/check-backup-freshness.sh [max-age-hours]
#   max-age-hours defaults to 26 (nightly backup at 02:00 + buffer for a
#   check that itself might run a little late).

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backup}"
MAX_AGE_HOURS="${1:-26}"

LATEST_DUMP="$(ls -t "$BACKUP_DIR"/kg-*.dump.gpg 2>/dev/null | head -n1)"
if [ -z "$LATEST_DUMP" ]; then
  echo "STALE: no backup file found in $BACKUP_DIR"
  exit 1
fi

AGE_SECONDS=$(( $(date +%s) - $(date -r "$LATEST_DUMP" +%s) ))
AGE_HOURS=$(( AGE_SECONDS / 3600 ))

if [ "$AGE_HOURS" -gt "$MAX_AGE_HOURS" ]; then
  echo "STALE: latest backup ($LATEST_DUMP) is $AGE_HOURS h old (max $MAX_AGE_HOURS h)"
  exit 1
fi

echo "OK: latest backup ($LATEST_DUMP) is $AGE_HOURS h old"
