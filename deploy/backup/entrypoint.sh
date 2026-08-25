#!/usr/bin/env bash
# Entrypoint for the `backup` service in docker-compose.prod.yml.
#
# cron does not inherit the environment of the process that starts it —
# each job runs with a near-empty environment unless it's put there
# explicitly. Since DATABASE_URL, BACKUP_GPG_RECIPIENT, STORAGE_* etc. all
# arrive as this container's runtime env (via `env_file` in compose), we
# dump them to a file the cron jobs source before running, once, at
# container start. If you rotate a secret, recreate this container
# (`docker compose up -d backup`) rather than expecting a live reload.
set -euo pipefail

printenv | grep -Ev '^(HOME|PWD|SHLVL|_|HOSTNAME)=' \
  | sed "s/^\(.*\)=\(.*\)$/export \1='\2'/" > /etc/container-env
chmod 0600 /etc/container-env

echo "$(date -Iseconds) backup container started; cron schedule:"
cat /etc/cron.d/kg-backup

# `cron -f` stays in the foreground as PID 1; job output is redirected to
# /proc/1/fd/1 (see crontab) so `docker compose logs backup` shows it.
exec cron -f
