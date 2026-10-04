#!/usr/bin/env bash
# Fetch/build only the frontend; never run backend migrations or restart the API.
set -Eeuo pipefail
app_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$app_dir"
[[ -f .env.production ]] || { echo 'Missing .env.production' >&2; exit 1; }
for command in git docker flock python3 sha256sum; do
  command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; exit 1; }
done
state="$app_dir/data/frontend-deploy"
mkdir -p "$state"
exec 9>"$state/deploy.lock"
flock -n 9 || { echo 'Frontend deployment already running.'; exit 0; }

FRONTEND_REPO=https://github.com/AzizBokhidjonov/alishax.git
FRONTEND_BRANCH=main
[[ ! -f .env.frontend ]] || source .env.frontend
git check-ref-format "refs/heads/$FRONTEND_BRANCH" >/dev/null
dc() { docker compose -f docker-compose.prod.yml --env-file .env.production --profile web "$@"; }
# Let Compose parse its env file; never execute the production secrets as shell.
mapfile -t settings < <(dc config --format json | python3 -c '
import json,sys
c=json.load(sys.stdin)["services"]
print(c["web"]["image"])
print(c["caddy"]["environment"]["API_DOMAIN"])
print(c["api"]["environment"].get("API_PREFIX", "/api/v1"))
')
[[ ${#settings[@]} == 3 ]] || { echo 'Cannot resolve production Compose settings.' >&2; exit 1; }
web_image=${settings[0]}
api_base=${FRONTEND_API_BASE_URL:-https://${settings[1]}${settings[2]}}
api_proxy=${FRONTEND_API_PROXY_TARGET:-https://${settings[1]}}
[[ "$api_base" == https://* && "$api_proxy" == https://* ]] || {
  echo 'Production frontend API URLs must be absolute HTTPS URLs.' >&2; exit 1;
}
export GIT_TERMINAL_PROMPT=0
repo="$state/repository.git"
if [[ ! -d "$repo" ]]; then git init --bare "$repo"; fi
git -C "$repo" fetch --depth=1 "$FRONTEND_REPO" "refs/heads/$FRONTEND_BRANCH"
revision=$(git -C "$repo" rev-parse 'FETCH_HEAD^{commit}')
record_check() {
  printf '%s %s\n' "$(date -u +%FT%TZ)" "$revision" >"$state/last-successful-check.tmp"
  mv "$state/last-successful-check.tmp" "$state/last-successful-check"
}
recipe=$(cat deploy/frontend/Dockerfile deploy/frontend/context.dockerignore \
  scripts/apply-frontend-patches.py deploy/frontend/patches/*.patch | sha256sum | cut -d' ' -f1)
fingerprint=$(printf '%s\n' "$revision" "$recipe" "$api_base" "$api_proxy" \
  "${FRONTEND_LANDING_TENANT_CODE:-}" "$web_image" | sha256sum | cut -d' ' -f1)
current=$(cat "$state/current" 2>/dev/null || true)
container=$(dc ps -q web)
if [[ "$current" == "$fingerprint" && -n "$container" ]] && \
  [[ $(docker inspect --format '{{.State.Health.Status}}' "$container") == healthy ]]; then
  record_check
  echo "Frontend already current: $revision"
  exit 0
fi

build_dir=$(mktemp -d "$state/build.XXXXXX")
candidate=""
cleanup() {
  [[ -z "$candidate" ]] || docker rm -f "$candidate" >/dev/null 2>&1 || true
  # mktemp creates this direct child; never clean an arbitrary caller-supplied path.
  [[ "$build_dir" == "$state"/build.* ]] && rm -rf -- "$build_dir"
}
trap cleanup EXIT
git -C "$repo" archive "$revision" | tar -x -C "$build_dir"
python3 scripts/apply-frontend-patches.py --source "$build_dir" --patches deploy/frontend/patches
cp deploy/frontend/context.dockerignore "$build_dir/.dockerignore"
image="alishax-frontend:${fingerprint:0:24}"
docker build --pull -f "$app_dir/deploy/frontend/Dockerfile" \
  --build-arg "FRONTEND_REVISION=$revision" \
  --build-arg "VITE_API_BASE_URL=$api_base" \
  --build-arg "VITE_API_PROXY_TARGET=$api_proxy" \
  --build-arg "VITE_LANDING_TENANT_CODE=${FRONTEND_LANDING_TENANT_CODE:-}" \
  -t "$image" "$build_dir"

# Check the new SSR server before replacing the live container. No public ports.
candidate=$(docker run -d --network none "$image")
healthy=false
for ((attempt=0; attempt<45; attempt++)); do
  status=$(docker inspect --format '{{.State.Health.Status}}' "$candidate")
  if [[ "$status" == healthy ]]; then healthy=true; break; fi
  if [[ "$status" == unhealthy ]]; then break; fi
  sleep 2
done
if [[ "$healthy" != true ]]; then
  docker logs --tail 50 "$candidate" >&2
  echo "Frontend $revision failed its startup check; live site unchanged." >&2
  exit 1
fi
docker rm -f "$candidate" >/dev/null
candidate=""

previous=""
if [[ -n "$container" ]]; then
  previous=$(docker inspect --format '{{.Image}}' "$container")
else
  previous=$(docker image inspect --format '{{.Id}}' "$web_image" 2>/dev/null || true)
fi
docker tag "$image" "$web_image"
if ! dc up -d --no-deps --pull never --wait --wait-timeout 90 web; then
  if [[ -n "$previous" ]]; then
    docker tag "$previous" "$web_image"
    dc up -d --no-deps --pull never --wait --wait-timeout 90 web
    echo 'Frontend startup failed; restored previous image.' >&2
  else
    echo 'Initial frontend deployment failed; no previous image to restore.' >&2
  fi
  exit 1
fi
printf '%s\n' "$fingerprint" >"$state/current.tmp"
mv "$state/current.tmp" "$state/current"
printf '%s\n' "$revision" >"$state/revision"
printf '%s\n' "$previous" >"$state/previous-image"
record_check
echo "Frontend deployed: $revision ($image)"
