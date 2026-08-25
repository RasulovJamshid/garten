# Standalone cron container that runs scripts/backup.sh and
# scripts/check-backup-freshness.sh on the schedule in ./crontab — the
# "nightly 02:00 encrypted dump" from kindergarten-docs/docs/06-ops-reference.md §6.
# Kept as its own tiny image rather than cramming cron into the api image:
# the api container should do exactly one job and restart cleanly; backups
# have a different lifecycle (they must keep running even if the api
# container is mid-deploy) and different OS packages (postgresql-client,
# gnupg, cron) that have no business in the app runtime image.
#
# node:22-slim (Debian bookworm), not alpine, to reuse
# scripts/lib/pg-env.sh's `node -e` URL parser as-is — same reasoning as
# the main Dockerfile.
FROM node:22-slim

# Debian bookworm's default `postgresql-client` package is v15; pg_dump
# should match (or exceed) the server's major version (16, per
# docker-compose.prod.yml) to avoid "server version newer than pg_dump"
# warnings/incompatibilities, so pull postgresql-client-16 from the
# official PGDG apt repo instead of the Debian default.
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates gnupg lsb-release cron tzdata \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-16 \
    && rm -rf /var/lib/apt/lists/*

ENV TZ=Asia/Tashkent
WORKDIR /app

COPY scripts/ ./scripts/
RUN chmod +x scripts/*.sh

COPY deploy/backup/crontab /etc/cron.d/kg-backup
RUN chmod 0644 /etc/cron.d/kg-backup && crontab /etc/cron.d/kg-backup

COPY deploy/backup/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Backups land here — docker-compose.prod.yml mounts this to a volume.
# Reminder (ops-reference §6): that volume living on the same disk as
# postgres protects against nothing that actually happens. Sync it
# off-server (rclone/rsync/etc.) — this container does not do that part.
VOLUME /backup

CMD ["/entrypoint.sh"]
