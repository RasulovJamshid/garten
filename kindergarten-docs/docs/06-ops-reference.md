# Operations Reference

Audit specification · error registry · configuration · non-functional requirements · migration runbook · ops runbook.

---

## 1. Audit log specification

### What is recorded

| Category | Actions |
|---|---|
| Auth | `auth.login`, `auth.login_failed`, `auth.logout`, `auth.password_reset`, `auth.session_revoked` |
| RBAC | `role.create`, `role.update`, `role.delete`, `role.grant`, `role.revoke`, `user.role_assign`, `user.role_remove`, `user.override_set` |
| Users | `user.create`, `user.update`, `user.activate`, `user.deactivate` |
| Children | `child.create`, `child.update`, `child.status_change`, `child.delete`, `child.group_transfer` |
| Medical | `medical.read`, `medical.update`, `allergy.create`, `incident.create` |
| Attendance | `attendance.correct` (never plain check-in — too high volume) |
| Pickup | `pickup.person_add`, `pickup.person_revoke`, `pickup.temporary_grant` |
| Finance | `charge.create`, `charge.reverse`, `payment.create`, `payment.cancel`, `discount.create`, `discount.revoke`, `tariff.change`, `billing.commit`, `period.close`, `period.reopen`, `billing_rules.create` |
| Expenses | `expense.create`, `expense.pay` |
| Data | `import.commit`, `export.generate`, `file.download` (sensitive entities only) |
| Settings | `settings.update`, `template.update` |

`medical.read` is deliberately on the list. Read access to health data is itself an auditable event — it is how you answer "who looked at this child's records."

Normal check-ins are **not** audited: 200 children × 200 days = 40,000 rows/year of noise. `attendance_day` already carries `check_in_by` and timestamps; that is the audit trail.

### Record format

```json
{
  "id": 184023,
  "tenantId": "...",
  "userId": "...",
  "action": "payment.cancel",
  "entityType": "payment",
  "entityId": "...",
  "oldValue": { "status": "active", "amountTiyin": "150000000" },
  "newValue": { "status": "cancelled", "reason": "duplicate entry" },
  "diff": { "status": ["active", "cancelled"] },
  "ipAddress": "10.0.0.42",
  "userAgent": "...",
  "traceId": "01J8...",
  "occurredAt": "2026-07-29T14:22:11+05:00"
}
```

### Rules

- **Append-only, enforced by trigger.** `UPDATE` and `DELETE` on `audit_log` raise an exception — already implemented in the DDL and verified.
- **Never log secrets:** password hashes, tokens, refresh tokens, bot token. Redact by field-name allowlist, not blocklist — a blocklist misses the next field someone adds.
- **`traceId` links the audit row to application logs.** Without it, investigating an incident means correlating by timestamp, which fails under concurrency.
- **Retention: 3 years minimum** for financial actions. Personal-data actions follow whatever retention the client's legal counsel specifies. Partition `audit_log` by month once it exceeds ~5M rows.
- **Read access:** Owner and Director only, via `audit:read`. Never exposed to accountants for their own actions — that defeats the purpose.

### The three highest-value queries

```sql
-- who touched this payment
SELECT * FROM audit_log WHERE entity_type='payment' AND entity_id=$1 ORDER BY occurred_at;

-- everything a user did in a window
SELECT * FROM audit_log WHERE tenant_id=$1 AND user_id=$2
  AND occurred_at BETWEEN $3 AND $4 ORDER BY occurred_at;

-- all permission changes ever (the security review query)
SELECT * FROM audit_log WHERE tenant_id=$1
  AND action LIKE 'role.%' OR action LIKE 'user.role_%' ORDER BY occurred_at DESC;
```

---

## 2. Error code registry

Consolidated. `code` is the contract; `message` is English debug text; clients localize from `code`.

### Auth / RBAC
| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHENTICATED` | 401 | Missing or invalid token |
| `TOKEN_EXPIRED` | 401 | Access token expired — refresh |
| `ACCOUNT_LOCKED` | 423 | Too many failed attempts |
| `ACCOUNT_INACTIVE` | 403 | User deactivated |
| `FORBIDDEN` | 403 | Authenticated but lacks permission |
| `OUT_OF_SCOPE` | 403 | Permission held, but record outside scope |
| `ROLE_PROTECTED` | 403 | Owner role cannot be modified |
| `ROLE_IN_USE` | 409 | Users still hold this role |
| `LAST_OWNER` | 409 | Cannot remove the final Owner |
| `SELF_LOCKOUT` | 403 | Cannot revoke own admin permissions |
| `PRIVILEGE_ESCALATION` | 403 | Cannot grant a permission you lack |
| `SENSITIVE_PERMISSION` | 403 | Requires `role:manage:sensitive` |
| `UNKNOWN_PERMISSION` | 400 | Key not in the code catalog |
| `INVALID_SCOPE` | 400 | Scope not allowed for that permission |

### Domain
| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 422 | Field-level errors in `details` |
| `NOT_FOUND` | 404 | Also returned for out-of-scope records |
| `DUPLICATE` | 409 | Unique constraint; `details` carries the existing record |
| `CAPACITY_EXCEEDED` | 409 | Group full — `?force=true` for Director+ |
| `ALREADY_CHECKED_IN` | 409 | Duplicate check-in for the day |
| `NOT_CHECKED_IN` | 409 | Check-out without check-in |
| `PERMISSION_EXPIRED` | 403 | Pickup permission not valid today |
| `PICKUP_NOT_AUTHORIZED` | 403 | Person not linked to this child |
| `OVERLAPPING_ASSIGNMENT` | 409 | Child already in a group for that range |

### Finance
| Code | HTTP | Meaning |
|---|---|---|
| `PERIOD_CLOSED` | 409 | Write attempted into a closed period |
| `PERIOD_NOT_FOUND` | 404 | Period not created yet |
| `BILLING_ALREADY_COMMITTED` | 409 | Second commit for the same period |
| `CHARGE_ALREADY_EXISTS` | 409 | Duplicate charge, same child/period/kind |
| `IMMUTABLE_RECORD` | 409 | UPDATE/DELETE on a ledger row |
| `ALREADY_REVERSED` | 409 | Reversal already exists |
| `ALLOCATION_EXCEEDS_PAYMENT` | 422 | Allocations sum > payment amount |
| `ALLOCATION_EXCEEDS_CHARGE` | 422 | Allocation > charge outstanding |
| `NO_ACTIVE_TARIFF` | 422 | Child has no tariff for the period |
| `RULES_OVERLAP` | 409 | Billing-rules effective ranges overlap |
| `RULES_IN_CLOSED_PERIOD` | 409 | `effectiveFrom` inside a closed period |

### Infrastructure
| Code | HTTP | Meaning |
|---|---|---|
| `RATE_LIMITED` | 429 | `Retry-After` header set |
| `IDEMPOTENCY_CONFLICT` | 409 | Same key, different payload |
| `FILE_TOO_LARGE` | 413 | Exceeds `MAX_UPLOAD_MB` |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | MIME not in allowlist |
| `STORAGE_UNAVAILABLE` | 503 | MinIO unreachable |
| `INTERNAL_ERROR` | 500 | `traceId` returned; details never leaked |

---

## 3. Environment configuration

```bash
# --- core
NODE_ENV=production
PORT=3000
API_PREFIX=/api/v1
APP_URL=https://kg.example.uz

# --- database
DATABASE_URL=postgresql://kg_app:***@postgres:5432/kindergarten
DATABASE_POOL_MAX=20
DATABASE_STATEMENT_TIMEOUT_MS=15000

# --- auth
JWT_SECRET=***                     # 32+ random bytes
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d
PASSWORD_MIN_LENGTH=10
LOGIN_MAX_ATTEMPTS=5
LOGIN_LOCKOUT_MINUTES=15

# --- storage (pluggable: local | s3)
STORAGE_DRIVER=local               # local | s3
STORAGE_LOCAL_PATH=/data/files     # local driver only; MUST be a mounted volume
S3_ENDPOINT=http://minio:9000      # s3 driver: set for MinIO, omit for real AWS
S3_BUCKET=kg-files
S3_ACCESS_KEY=***
S3_SECRET_KEY=***
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true           # true for MinIO
MAX_UPLOAD_MB=20
ALLOWED_MIME=image/jpeg,image/png,image/webp,application/pdf

# --- telegram
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=***
TELEGRAM_BOT_USERNAME=my_kg_bot
TELEGRAM_MODE=polling
TELEGRAM_RATE_LIMIT_PER_SEC=25

# --- localization / time
DEFAULT_TIMEZONE=Asia/Tashkent
DEFAULT_LANGUAGE=ru
DEFAULT_CURRENCY=UZS

# --- jobs
PGBOSS_SCHEMA=jobs
JOB_CONCURRENCY=5

# --- observability
LOG_LEVEL=info
SENTRY_DSN=***
```

**Rules:** all secrets from environment, never committed, never in the database. Fail fast on boot if any required variable is missing — a server that starts with `JWT_SECRET` undefined is a silent catastrophe. Validate the whole set with a Zod schema at startup.

The database user `kg_app` gets `SELECT/INSERT/UPDATE/DELETE` on domain tables and `SELECT/INSERT` only on `audit_log`, `charge`, `payment`, `payment_allocation`. Migrations run as a separate, more privileged user. This makes the append-only guarantee hold even against application bugs.

---

## 4. Non-functional requirements

| Requirement | Target | Notes |
|---|---|---|
| Concurrent users | 25 | One kindergarten. 150 at 6 branches. |
| Peak load window | 07:30–09:00 | Morning check-in rush — the only real spike |
| Check-in response time | < 300 ms p95 | Reception cannot queue |
| List endpoints | < 500 ms p95 | At 5,000 children |
| Report generation (sync) | < 5 s | Beyond that, switch to async job |
| Billing run, 500 children | < 30 s | Preview and commit each |
| Dashboard load | < 1 s | Single aggregate call |
| Uptime target | 99% business hours | 07:00–19:00 local; not a 24/7 system |
| RPO (max data loss) | 24 h | Nightly backup. 1 h if WAL archiving added. |
| RTO (max downtime) | 4 h | Restore + verify |
| Data retention, financial | 3 years min | Per local accounting practice — confirm with accountant |
| Data retention, attendance | 3 years | |
| Audit retention | 3 years | |
| Database size, year 1 | < 5 GB | Files dominate; DB itself is small |
| File storage, year 1 | ~20 GB | Photos + document scans |

**Load-test target: 5,000 children, 3 years of attendance (~3M rows), 100k payments.** That is well beyond the actual client and proves headroom.

---

## 5. Data migration runbook

Run this **before** go-live, never during.

### Phase 1 — collect and assess
1. Gather every Excel file, paper register, and Telegram log currently in use.
2. Inventory what exists: how many children, how many with complete parent data, how far back attendance goes.
3. **Decide explicitly what NOT to migrate.** Historical attendance older than the current academic year is almost always not worth it. Historical payments are dangerous (see phase 4).

### Phase 2 — clean (in Excel, before touching the system)
4. Deduplicate children by name + birth date. Expect 3–8% duplicates.
5. Normalize phone numbers to `+998XXXXXXXXX`. Expect 15–20% malformed.
6. Deduplicate guardians by phone — this is what collapses "one parent record per child" into the correct M:N.
7. Map children → guardians. Flag any child with no guardian; these must be resolved by hand.
8. Map old group names → new group records.
9. Fill missing birth dates. A child without a birth date cannot be age-grouped.

### Phase 3 — dry run
10. Import into **staging**, using the same files.
11. Run the validation report: row counts, unmatched guardians, missing fields.
12. Have the administrator open 20 random children and verify against paper.
13. Fix source files, repeat. Expect 2–4 iterations.

### Phase 4 — opening balances (the dangerous part)
14. Import **only opening balances**, not historical payment history. One `charge` of kind `manual` per child, description "Opening balance as of {date}", dated the day before go-live.
15. The accountant signs a printed list of every opening balance before import. **Written confirmation, not verbal.**
16. Any balance the accountant cannot confirm is imported as zero and handled manually. A wrong opening balance propagates into every subsequent statement and is nearly impossible to unwind after payments allocate against it.
17. Do not import old payments. They have no charges to allocate against and will corrupt the ledger.

### Phase 5 — production
18. Freeze the old system: no new entries in Excel from this moment.
19. Import to production in dependency order: branches → groups → guardians → children → child-guardian links → tariffs → child tariffs → discounts → opening balances.
20. Run reconciliation: total opening balances in system == total on the signed sheet. **If it does not match to the tiyin, stop and investigate.**
21. Archive the old files read-only, dated, and keep them for 3 years.

---

## 6. Operations runbook

### Backups
```bash
# nightly 02:00 — full logical dump, encrypted
pg_dump -Fc kindergarten \
  | gpg --encrypt --recipient ops@kg \
  > /backup/kg-$(date +%F).dump.gpg

# weekly — files, depending on STORAGE_DRIVER
#   s3:
mc mirror --overwrite minio/kg-files /backup/files/
#   local: the directory MUST be in the backup set. Forgetting it means a
#   restore brings back records whose documents and photos are all gone.
tar czf /backup/files-$(date +%F).tar.gz -C /data files

# retention: 30 daily, 12 weekly, 12 monthly
```

Store off the production server. A backup on the same disk as the database protects against nothing that actually happens.

### Choosing a storage driver

| | `local` | `s3` (MinIO or cloud) |
|---|---|---|
| Setup | Nothing — a mounted volume | A MinIO container plus credentials |
| Backup | **Must be added to the routine manually** | `mc mirror`, or provider replication |
| Breaks when | You run 2+ app containers — each has its own disk | Never |
| Data localization | Trivially in-country | In-country only if MinIO is self-hosted |

Start with `local` for the first client: one less container, one less credential set, and the backup is a `tar`. Switch to `s3` the moment you run more than one app container — a local volume is not shared between them, and uploads will land on whichever container happened to serve the request while reads hit the other.

**Migrating local → s3 later** is a copy plus an env change. `object_key` values are identical under both drivers, so no database migration is needed:

```bash
mc cp --recursive /data/files/ minio/kg-files/
# set STORAGE_DRIVER=s3, restart, verify healthCheck passes
```

### Restore drill — monthly, non-negotiable
```bash
gpg --decrypt /backup/kg-2026-07-28.dump.gpg > /tmp/restore.dump
createdb kg_restore_test
pg_restore -d kg_restore_test /tmp/restore.dump

# verification queries — must all return sane values
psql kg_restore_test -c "SELECT count(*) FROM child WHERE deleted_at IS NULL;"
psql kg_restore_test -c "SELECT sum(amount_tiyin*sign) FROM charge;"
psql kg_restore_test -c "SELECT sum(amount_tiyin*sign) FROM payment;"
psql kg_restore_test -c "SELECT max(occurred_at) FROM audit_log;"

dropdb kg_restore_test
```

Log the date and result. **A backup that has never been restored is not a backup** — put this drill on the calendar, assign it to a person, and treat a missed drill as an incident.

### Monitoring — the alerts that matter
| Alert | Threshold | Why |
|---|---|---|
| API down | 2 consecutive failed pings | Obvious |
| Disk usage | > 80% | Postgres corrupts ugly when a disk fills |
| Backup did not complete | No new file by 04:00 | Silent backup failure is the classic disaster |
| Failed jobs in queue | > 10 | Notifications silently not sending |
| p95 latency | > 2 s for 5 min | |
| 5xx rate | > 1% over 5 min | |
| Telegram bound rate | < 60% | Feature quietly not working |

Everything else is noise. Seven alerts that always mean something beat forty that get ignored.

### Incident: "the debt figures look wrong"
This is the call you will get. Procedure:
1. **Do not edit the database.** Ever. The ledger is append-only for exactly this reason.
2. Pull `v_child_balance` and `v_charge_outstanding` for the child.
3. Pull the charge's `calculation_trace` — it shows every step from base tariff to final amount.
4. Pull the audit log for that child's charges and payments.
5. In almost every case the answer is one of: an attendance correction after billing, a discount with the wrong date range, an unallocated advance payment, or a reversal the accountant forgot they made. The trace shows which.
6. Fix forward with a reversal and reissue, or an adjustment charge. Never with an `UPDATE`.

### Incident: suspected unauthorized access
1. Revoke all sessions: `UPDATE user_session SET revoked_at = now()`.
2. Query the audit log for that user across the suspected window.
3. Check `login_attempt` for the source IP pattern.
4. Rotate `JWT_SECRET` (this invalidates every token globally).
5. Force password reset for affected accounts.
6. Review `role.%` audit entries — the first thing an escalation attempt touches is permissions.

### Deployment
```
1. Announce a maintenance window outside 07:00-19:00
2. Back up first, verify the file exists and has non-zero size
3. Run migrations (expand-only: add columns/tables, never drop in the same release)
4. Deploy the application
5. Smoke test: login, check-in a test child, load the dashboard, generate a report
6. Watch error rates for 30 minutes
7. Rollback plan: previous image + the pre-deploy backup
```

Never drop a column in the same release that stops using it. Two releases: stop writing, then drop. That is what makes rollback possible.
