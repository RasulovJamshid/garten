#!/usr/bin/env bash
# Install a watcher in the current deployment user's crontab; no sudo required.
set -Eeuo pipefail
app_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$app_dir"
[[ $EUID != 0 ]] || { echo 'Run this installer as the non-root deploy user.' >&2; exit 1; }
[[ "$app_dir" =~ ^/[a-zA-Z0-9_./-]+$ ]] || {
  echo 'Use an app path without spaces or shell metacharacters.' >&2; exit 1;
}
for command in crontab logger python3 docker; do
  command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; exit 1; }
done
[[ -f .env.production ]] || { echo 'Missing .env.production' >&2; exit 1; }
mkdir -p data
cron_file=$(mktemp)
cron_error=$(mktemp)
trap 'rm -f -- "$cron_file" "$cron_error"' EXIT
if ! LC_ALL=C crontab -l >"$cron_file" 2>"$cron_error"; then
  if ! grep -q '^no crontab for ' "$cron_error"; then
    cat "$cron_error" >&2
    exit 1
  fi
fi
# Preserve every unrelated job and refuse malformed or duplicate owned blocks.
python3 - "$cron_file" "$app_dir" "$(command -v logger)" <<'PY'
import pathlib, re, sys
file = pathlib.Path(sys.argv[1])
lines = file.read_text().splitlines()
begin, end = '# BEGIN alishax-frontend', '# END alishax-frontend'
starts = [i for i, line in enumerate(lines) if line == begin]
ends = [i for i, line in enumerate(lines) if line == end]
if starts or ends:
    if len(starts) != 1 or len(ends) != 1 or starts[0] >= ends[0]:
        raise SystemExit('Malformed frontend cron block; existing crontab was not changed.')
    del lines[starts[0]:ends[0] + 1]
app, logger = sys.argv[2:]
if not re.fullmatch(r'/[a-zA-Z0-9_./-]+', logger):
    raise SystemExit('Unexpected logger executable path.')
lines += [begin,
    f'*/2 * * * * PATH=/usr/local/bin:/usr/bin:/bin /bin/bash {app}/scripts/deploy-frontend.sh 2>&1 | {logger} -t alishax-frontend',
    end]
file.write_text('\n'.join(lines) + '\n')
PY
# Finish and check one deployment before activating the scheduled job.
/bin/bash scripts/deploy-frontend.sh
docker compose -f docker-compose.prod.yml --env-file .env.production \
  up -d --no-deps --force-recreate caddy
crontab "$cron_file"
echo 'Frontend deployed; this user will check GitHub every two minutes via cron.'
echo 'Read logs with: journalctl -t alishax-frontend (where permitted).'
