#!/usr/bin/env bash
# Parses DATABASE_URL into the standard libpq PG* environment variables
# (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE) so every pg_dump/psql/
# pg_restore/createdb/dropdb call below can omit connection flags entirely.
# Sourced by the other scripts in this directory — not meant to run directly.

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set." >&2
  exit 1
fi

# node is already a hard dependency of this project (it's the app runtime),
# so it's a safer URL parser here than a hand-rolled bash/sed regex.
eval "$(node -e '
  const u = new URL(process.env.DATABASE_URL);
  const out = {
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: u.pathname.replace(/^\//, ""),
  };
  for (const [k, v] of Object.entries(out)) {
    console.log(`export ${k}=${JSON.stringify(v)}`);
  }
')"
export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE
