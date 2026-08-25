# Production deployment

One VPS, Docker Compose, Caddy for automatic TLS — per
[`kindergarten-docs/docs/01-stage1-plan.md`](kindergarten-docs/docs/01-stage1-plan.md) §8. No
Kubernetes, no managed services. This doc is the checklist from "empty VPS" to "CI/CD deploys on
every push to `main`."

There is no `web` (frontend) service yet — this deploys the API only. See the README "Status"
section for where the frontend stands.

---

## 0. What you need before starting

- A VPS (2 GB RAM minimum; Ubuntu 22.04/24.04 assumed below) with a public IP.
- A domain name, with an **A record pointing at that IP** (and AAAA if you have IPv6). Caddy
  cannot get a TLS certificate until this resolves — DNS propagation can take a few minutes to a
  few hours.
- A GitHub repository for this code (push the local git history you already have to it).
- Nothing else. No Redis, no separate object-storage account — MinIO runs on the same VPS.

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

- `DOMAIN` / `ACME_EMAIL` / `APP_URL` / `CORS_ORIGINS` — your real domain.
- `SEED_TENANT_CODE`, `SEED_TENANT_NAME`, `SEED_OWNER_EMAIL` — the real first tenant.
- `--- telegram` block, if you're turning the bot on now rather than later.
- `SENTRY_DSN`, if you want error aggregation from day one (recommended).

**Do not commit this file.** `.gitignore` already excludes `.env.*` except the two `*.example`
templates — double-check `git status` shows `.env.production` as untracked, not staged, before
you ever run `git add`.

## 3. First boot (manual — before CI/CD exists)

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production build api backup
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
docker compose -f docker-compose.prod.yml logs -f caddy   # watch for the TLS cert being issued
```

Once Caddy logs show the certificate obtained, verify:

```bash
curl -fsS https://<your-domain>/api/v1/health
# {"status":"ok","timestamp":"..."}
```

Then seed the first tenant + Owner login (one-time; safe to skip on later restarts — the seed is
idempotent but there's no reason to re-run it):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec api npm run seed
```

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
| `DOMAIN` | your domain (used only for the post-deploy smoke test) |

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
