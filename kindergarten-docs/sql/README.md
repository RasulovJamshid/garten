# SQL

Apply in order:

    psql -d kindergarten -v ON_ERROR_STOP=1 -f 01-schema.sql
    psql -d kindergarten -v ON_ERROR_STOP=1 -f 02-config-layer.sql

Requires PostgreSQL 16. The pgcrypto and btree_gist extensions are
created by 01-schema.sql.

Verified on PostgreSQL 16.14: 49 tables, 5 views, 112 indexes,
14 triggers, 109 foreign keys, 57 check constraints. Clean run from an
empty database, plus 13 behavioural constraint tests.
