#!/usr/bin/env bash
# Run once on the existing Ubuntu/Debian server after copying these deploy files.
# A deployment-only account uses its own crontab; sudo installs a system timer.
set -Eeuo pipefail
if [[ $EUID != 0 ]]; then
  exec /bin/bash "$(dirname "${BASH_SOURCE[0]}")/install-frontend-cron.sh"
fi
app_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
deploy_user=${1:-${SUDO_USER:-deploy}}
id "$deploy_user" >/dev/null
[[ "$deploy_user" != root ]] || { echo 'Pass the non-root Docker deploy user.' >&2; exit 1; }
# Keep generated systemd directives unambiguous; no arbitrary unit-file syntax.
[[ "$app_dir" =~ ^/[a-zA-Z0-9_./-]+$ && "$deploy_user" =~ ^[a-z_][a-z0-9_-]*$ ]] || {
  echo 'Use an app path without spaces and a normal Linux deploy username.' >&2; exit 1;
}
[[ -f "$app_dir/.env.production" ]] || { echo 'Missing .env.production' >&2; exit 1; }
runuser -u "$deploy_user" -- test -w "$app_dir/data" || {
  echo "Create a writable $app_dir/data directory for $deploy_user first." >&2; exit 1;
}
cat >/etc/systemd/system/alishax-frontend.service <<EOF
[Unit]
Description=Build and deploy changes from AzizBokhidjonov/alishax
Wants=network-online.target
After=network-online.target docker.service
Requires=docker.service

[Service]
Type=oneshot
User=$deploy_user
WorkingDirectory=$app_dir
ExecStart=/bin/bash $app_dir/scripts/deploy-frontend.sh
TimeoutStartSec=30min
UMask=0027
EOF
cat >/etc/systemd/system/alishax-frontend.timer <<'EOF'
[Unit]
Description=Check the Alishax frontend main branch every two minutes

[Timer]
OnBootSec=90s
OnUnitInactiveSec=2min
RandomizedDelaySec=15s
Unit=alishax-frontend.service

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
# Finish one successful build before enabling periodic deployment.
systemctl start alishax-frontend.service
cd "$app_dir"
runuser -u "$deploy_user" -- docker compose -f docker-compose.prod.yml \
  --env-file .env.production up -d --no-deps --force-recreate caddy
systemctl enable --now alishax-frontend.timer
systemctl list-timers alishax-frontend.timer --no-pager
echo 'Frontend deployed; subsequent frontend commits will deploy automatically.'
