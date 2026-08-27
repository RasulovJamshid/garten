# Production deployment

One VPS, Docker Compose, Caddy for automatic TLS — per
[`kindergarten-docs/docs/01-stage1-plan.md`](kindergarten-docs/docs/01-stage1-plan.md) §8. No
Kubernetes, no managed services. This doc is the checklist from "empty VPS" to "CI/CD deploys on
every push to `main`."

Two hostnames, one server, one Caddy:

| Hostname | Serves | Container |
|---|---|---|
| `alishaxkids.uz` | client UI (static SPA) | `web:80` — built and published from its **own repo** |
| `api.alishaxkids.uz` | this backend API | `api:3000` |

The `web` service sits behind a Compose profile and stays off until that image exists (§8), so
everything below deploys the API alone — `alishaxkids.uz` returns 502 until then, which does not
affect the API host.

---

## 0. What you need before starting

- A VPS (2 GB RAM minimum; Ubuntu 22.04/24.04 assumed below) with a public IP.
- A domain name with **two A records pointing at that IP** — the apex (`alishaxkids.uz`) for the
  client UI and `api.alishaxkids.uz` for this API (plus AAAA records if you have IPv6). Caddy
  requests a separate certificate per hostname and cannot get one until that name resolves — DNS
  propagation can take a few minutes to a few hours. A missing record for one host does not stop
  the other from getting its certificate.
- A GitHub repository for this code (push the local git history you already have to it).
- Nothing else. No Redis, no separate object-storage account needed — the default
  `STORAGE_DRIVER=local` writes uploads to a volume on this same VPS. MinIO is optional (only
  needed for `STORAGE_DRIVER=s3`, e.g. once you're running 2+ api containers) and its compose
  service is profile-gated off by default — see the callout in step 3.

---

## 1. Provision the server

```bash
ssh root@<server-ip>

# Docker Engine + Compose plugin
curl -fsSL https://get.docker.com | sh
apt-get install -y docker-compose-plugin

# A non-root deploy user (the CD workflow SSHes in as this user, not root)
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
mkdir -p /home/deploy/.ssh
```

Generate a dedicated deploy key **on your own machine** (not the server) and authorize it:

```bash
ssh-keygen -t ed25519 -f ./kg-deploy-key -C "kg-deploy" -N ""
# paste kg-deploy-key.pub into /home/deploy/.ssh/authorized_keys on the server
# keep kg-deploy-key private — it becomes the DEPLOY_SSH_KEY GitHub secret (step 4)
```

Basic firewall — only SSH, HTTP, HTTPS need to be reachable:

```bash
ufw allow OpenSSH
ufw allow 80,443/tcp
ufw enable
```

## 2. Clone the repo and configure secrets

As the `deploy` user:

```bash
su - deploy
git clone https://github.com/<owner>/<repo>.git app
cd app

cp .env.production.example .env.production
bash scripts/generate-prod-secrets.sh .env.production
```

Then hand-edit `.env.production` for what the generator deliberately leaves alone:

- `UI_DOMAIN` / `API_DOMAIN` / `ACME_EMAIL` — your real hostnames.
- `APP_URL` must be the **API** host (`https://api.alishaxkids.uz`) and `CORS_ORIGINS` the **UI**
  origin (`https://alishaxkids.uz`). These are no longer the same value: swapping them breaks the
  Telegram webhook in one direction and every browser call in the other.
- `SEED_TENANT_CODE`, `SEED_TENANT_NAME`, `SEED_OWNER_EMAIL` — the real first tenant.
- `--- telegram` block, if you're turning the bot on now rather than later.
- `SENTRY_DSN`, if you want error aggregation from day one (recommended).

**Do not commit this file.** `.gitignore` already excludes `.env.*` except the two `*.example`
templates — double-check `git status` shows `.env.production` as untracked, not staged, before
you ever run `git add`.

## 3. First boot (manual — before CI/CD exists)

> **Every** `docker compose` command against this file needs `--env-file .env.production` —
> Compose silently falls back to a default `.env` (which doesn't exist here) without it, and every
> `${VAR:?...}` comes back "missing a value" even though `.env.production` is filled in correctly.
> Save yourself the confusion with `alias dcprod='docker compose -f docker-compose.prod.yml
> --env-file .env.production'` and use `dcprod` from here on.
>
> Plain `up -d` (no `--profile` flag) starts only `postgres`, `api`, `backup`, `caddy` —
> **not** `minio`. That's deliberate: with the default `STORAGE_DRIVER=local` the app never talks
> to MinIO (see `src/storage/storage.module.ts`), so it isn't started at all. Only add
> `--profile s3` if you've actually switched `STORAGE_DRIVER=s3` — and be aware the official
> `minio/minio` image requires the `x86-64-v2` CPU feature set; on a VPS whose hypervisor doesn't
> expose it (check `lscpu | grep Flags` for `sse4_2`/`popcnt`) it crash-loops with `Fatal glibc
> error: CPU does not support x86-64-v2` and no config change fixes that short of a different host
> or an older pinned MinIO tag.

```bash
dcprod build api backup
dcprod up -d
dcprod logs -f caddy   # watch for the TLS cert being issued
```

Once Caddy logs show the certificate obtained, verify:

```bash
curl -fsS https://api.alishaxkids.uz/api/v1/health
# {"status":"ok","timestamp":"..."}
```

Then seed the first tenant + Owner login (one-time; safe to skip on later restarts — the seed is
idempotent but there's no reason to re-run it):

```bash
dcprod exec api npm run seed:prod
```

Use `seed:prod` here, not plain `seed` — `seed` runs through `ts-node` (fine locally/in CI) but
the production image ships a plain-JS compile of the same script instead (`dist-seed/`, built by
`npm run build:seed` in the Dockerfile) specifically so production never depends on `ts-node`.

The Owner password is whatever `generate-prod-secrets.sh` printed (or what you set by hand in
`.env.production`'s `SEED_OWNER_PASSWORD`). Log in once, confirm access, and treat that value as
compromised from then on if it was ever typed into a chat, ticket, or unencrypted note.

## 4. Wire up GitHub Actions CD

`.github/workflows/ci.yml` already has `docker-publish` (builds + pushes the image to GHCR) and
`deploy` (SSHes in and restarts the stack) jobs. They no-op with a warning until these repo
secrets exist — add them under **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | the server's IP or hostname |
| `DEPLOY_SSH_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | the **private** half of `kg-deploy-key` from step 1 |
| `DEPLOY_PATH` | `/home/deploy/app` |

And these repo **variables** (not secrets — not sensitive, just non-default):

| Variable | Value |
|---|---|
| `API_DOMAIN` | `api.alishaxkids.uz` — used only for the post-deploy smoke test |

GHCR needs no separate credential — the workflow authenticates with the automatic
`GITHUB_TOKEN`. The image it pushes is `ghcr.io/<owner>/<repo>` and defaults to **private**;
either leave it private (the server's `docker login ghcr.io` needs a token with `read:packages`
in that case — a Personal Access Token added as a `DEPLOY_PATH`-adjacent step, ask if you need
this) or make the package public from the GitHub Packages UI, which is simpler for a
single-server deploy.

Optional but recommended: turn the `production` environment (auto-created by the `deploy` job's
`environment: production`) into a protected one — **Settings → Environments → production →
required reviewers** — so a push to `main` builds and publishes automatically but a human clicks
"approve" before it actually restarts the production containers.

From here, every push to `main` that passes `test`: builds the image, pushes it to GHCR, SSHes to
the server, pulls, restarts, and smoke-tests `/health`. Migrations run automatically — the
Dockerfile's `CMD` is `prisma migrate deploy && node dist/main`, so every container start applies
whatever's pending (a no-op when there's nothing to apply).

## 5. Backups

The `backup` service (`deploy/backup/`) is already in `docker-compose.prod.yml` and started by
step 3 — it runs `scripts/backup.sh` nightly at 02:00 (server timezone) and
`scripts/check-backup-freshness.sh` at 04:30, both logged to `docker compose logs backup`.

That gets you encrypted dumps landing in the `backup_data` volume — **which is still on the same
disk as everything else.** Per `06-ops-reference.md` §6, "a backup on the same disk as the
database protects against nothing that actually happens." Ship them off-server; pick one:

```bash
# simplest: nightly rsync/rclone from your own machine or a second box
rclone sync deploy-user@<server>:/var/lib/docker/volumes/kindergarten-prod_backup_data/_data \
  remote:kg-backups --create-empty-src-dirs
```

Put the **monthly restore drill** from that same doc's §6 on an actual calendar, assigned to an
actual person. An untested backup is not a backup.

## 6. Deploying by hand (no CI/CD path)

If you ever need to push a change without going through GitHub Actions:

```bash
ssh deploy@<server> "cd app && git pull && \
  docker compose -f docker-compose.prod.yml --env-file .env.production build api && \
  docker compose -f docker-compose.prod.yml --env-file .env.production up -d"
```

## 7. Known deviation from the ops doc

`06-ops-reference.md` §3 specifies the runtime DB user (`kg_app`) should hold only
`SELECT/INSERT/UPDATE/DELETE` on domain tables and `SELECT/INSERT`-only on the append-only
ledger tables (`audit_log`, `charge`, `payment`, `payment_allocation`), with migrations running
as a separate, more-privileged user. This stack currently runs `prisma migrate deploy` with the
same `DATABASE_URL`/user the app uses at runtime — i.e. one Postgres role, full privileges,
rather than the two-role split the doc calls for. Harmless while the schema is stable, but it
means an application bug has more privilege than it should against the ledger tables. Fixing it
means a second `MIGRATE_DATABASE_URL` (superuser or owner role) used only by the `prisma migrate
deploy` step, and revoking `UPDATE`/`DELETE` from `kg_app` on the four ledger tables. Worth doing
before this handles real money at scale; not done as part of this pass.

## 8. Adding the client UI (`alishaxkids.uz`)

The frontend lives in its own repository and is deployed as a published image, not built here.
This repo owns only the routing and the Compose entry for it.

**What the frontend repo must produce:** an image that serves the built static bundle on port 80
and does its own SPA history fallback (unknown paths → `index.html`). Caddy here only forwards;
if the root page loads but deep links 404, that fallback is missing inside the web image, not in
`deploy/Caddyfile`.

**The API base URL is baked in at build time.** A Vite bundle is static files — there is no
runtime env to read — so the frontend's CI must build with:

```
VITE_API_URL=https://api.alishaxkids.uz
```

An image built against a different value cannot be repointed by editing `.env.production`; it has
to be rebuilt. Same for any other `VITE_*` value.

**Turning it on**, once the frontend repo has pushed its first image to GHCR:

```bash
# in .env.production, uncomment and set:
#   WEB_IMAGE=ghcr.io/<owner>/<web-repo>:latest

docker compose -f docker-compose.prod.yml --env-file .env.production --profile web pull web
docker compose -f docker-compose.prod.yml --env-file .env.production --profile web up -d
```

The `--profile web` flag is required on **every** compose command that should include the UI —
without it the `web` service is skipped entirely. That is deliberate: it means a missing or
unpullable web image can never take the API down with it. If you'd rather not repeat the flag,
export `COMPOSE_PROFILES=web` in the deploy user's shell profile.

**CD for the UI** belongs in the frontend repo's own workflow: build → push to GHCR → SSH to this
server → the two commands above. It should *not* be bolted onto this repo's `deploy` job — the
two deploy on different cadences, and coupling them means a frontend typo blocks an API hotfix.

**Cross-origin checklist**, if the UI loads but calls fail:

| Symptom | Cause |
|---|---|
| Preflight fails / "not allowed by CORS" | `CORS_ORIGINS` isn't exactly `https://alishaxkids.uz` (scheme and no trailing slash both matter) |
| 401 from `POST /auth/refresh`, login "forgets" | the client isn't sending `credentials: 'include'` |
| Telegram webhook never fires | `APP_URL` points at the UI host instead of `api.alishaxkids.uz` |
| `alishaxkids.uz` returns 502 | `web` isn't running — missing `--profile web` or `WEB_IMAGE` unset |
