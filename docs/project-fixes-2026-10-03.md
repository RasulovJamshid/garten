# Corrections and validation — 3 October 2026

The nine defects reproduced in [the project audit](project-audit-2026-10-03.md) and its
additional source findings have been corrected in the local working tree. The backend
supports the audited Stage 1 workflows with regression coverage for the failing cases.
This record establishes local behavior; production deployment and external delivery
have separate verification requirements below.

Existing user changes were preserved. Original file contents before these edits are
saved locally under data/project-fixes-2026-10-03/before/. No business database was
changed, no source was committed, and no server or website was deployed.

## Corrected behavior

| Audit finding | Result |
| --- | --- |
| Active-child report group filter replaced permission scope | Permission predicates and requested filters are combined with AND. A foreign group cannot widen own-group access. |
| Expense payment resolved expense:read rather than expense:manage | Payment resolves its target under manage scope, including users without a read grant. Financial writes and audit events share a transaction. |
| Permission delegation ignored the actor's actual branches | User creation, role assignment/replacement, branch expansion, overrides and assigned-role permission changes compare granted branches against each permission's branch access. |
| Reactivation discarded earlier same-month billing attendance | Billing reconstructs historical enrollment episodes and intersects them with tariff segments. Frozen calculation snapshots preserve those episodes; older snapshots remain readable. |
| Zero-attendance segmented flat fees became the attendance minimum | The minimum-charge override applies only to attendance-dependent modes. Weighted flat fees retain their calculated amount. |
| Concurrent refresh requests consumed the same token twice | Refresh token consumption and replacement session creation are atomic. Password reset consumption is also single-use under concurrency. |
| Accountant totals included canceled and inaccessible payments | Dashboard payments use the payment permission scope and exclude canceled ledger entries. |
| Branch changes left incompatible current/future assignments | Changing branch returns 409 BRANCH_TRANSFER_ASSIGNMENTS while incompatible group or branch-specific tariff assignments remain. End those assignments before moving the child. Historical records remain in their original branches. |
| Medical badges ignored emergency instructions | Badges, filters, alerts and medical reports include allergies or nonempty emergency instructions. |
| Manual notification header was discarded | A tenant-scoped request key, payload hash and stable event ID deduplicate retries. Changed payloads under the same key return 409 IDEMPOTENCY_CONFLICT. |
| Export expiry and revoked access were unenforced | Export metadata and file downloads check expiry, creator and current report/domain access, including narrowing of branches/groups. New files link to export jobs. Legacy files are resolved by job file ID; exports without access snapshots require regeneration. |
| Financial audit events were outside their write transaction | Payment creation, charge creation/reversal, billing commit and expense writes persist their audit events in the same transaction. Injected audit failure tests prove payment/reversal rollback. |

Billing commits also recompute totals from the lines calculated under the commit locks.
The report-access registry uses attendance:correct for correction exports, matching
the underlying report query.

## Web contract fixes

The inspected web source is the cached AzizBokhidjonov/alishax checkout at commit
5d39744 from 9 September 2026. Corrections are maintained in
[the frontend patch](../deploy/frontend/patches/0001-api-contracts.patch), covering 50 files:

- Medical forms map the nested record response; the alerts view renders allergies and emergency instructions.
- Draft attachments upload without an incomplete or unsupported entity binding.
- Attendance uses the complete scoped /attendance/board response, including children without recorded attendance.
- /children supports a branchId filter within the caller's child-read scope.
- Pickup selection, verification and checkout support ad hoc pickupPermissionId as well as standing pickupPersonId.
- Notification forms offer Telegram and internal delivery. Unsupported SMS/email options are removed.
- The form schema typing and source formatting issues found by the web checks are corrected.

The deployment watcher applies the tracked patch to its archived upstream checkout before
building. Patch/helper changes affect the deployment fingerprint. A source mismatch stops
the update before replacing the running application; an entirely upstream-applied patch is
accepted. The helper checks all pending patches before changing files. The corrected files
were reproduced exactly by applying the patch to a clean archive of the inspected commit.

The cached source is not the current remote repository. If newer upstream changes overlap,
reconcile the patch during rollout. Browser acceptance of staff workflows and live deployment
were not performed in this session.

## Limited-role workflow corrections

The follow-up permission review fixed the operational dependencies in the backend,
web screens and Flutter companion. These changes preserve resource scopes.

| Workflow | Corrected behavior |
| --- | --- |
| Teacher child list and group filters | Group and branch labels come from authenticated bootstrap, without requiring group:read or branch:manage. Teachers see their currently assigned groups and children. Unrelated report:read=all cannot widen those labels. |
| Teacher assignment dates | Staff assignments use the Tashkent calendar date, including their final valid day and the UTC/Tashkent midnight boundary. |
| Child detail and filters | Guardian, consent, medical, finance and attendance controls follow their own permissions. Reception's today-only access does not expose month/history controls. Debt/medical filters are hidden when unauthorized; saved unauthorized filters are omitted from requests. Create, update and status actions use their respective permissions. |
| Attendance and pickup actions | Correction controls require attendance:correct. Check-in/status and checkout controls are checked separately. Pickup readers do not receive a checkout action without attendance:checkout. |
| Finance child/payer selection | /lookups/children returns only IDs, names and branch ID under the selected operation's scope. The operation key is explicitly allowlisted and must be held. Payment payer selection returns only linked guardian IDs/names under payment:create. Branch-limited filters cannot widen access. |
| Accountant across branches | All-scoped payments/charges can select their permitted children while full child and guardian profiles remain branch-limited. Payment-only users no longer need child:read or guardian:read for selection; web and mobile use the scoped lookup. |
| Administrator staff assignment | The default administrator template includes operational attendance, pickup and medical-alert grants, allowing assignment of teacher and reception roles under the existing anti-escalation checks. Full clinical and financial grants are still required to delegate those specialized roles. |
| Mobile child details | Guardian links require guardian:read. Teachers can open permitted allergies/emergency instructions without full medical access or clinical edit controls. |

Teacher provisioning still requires a branch association and an active dated group-staff
assignment. Unassigned teachers receive NO_SCOPE_ASSIGNMENT for scoped child queries.
This is a configuration requirement; granting access to all children would defeat own-group scope.

Default role grants now live in src/rbac/default-role-grants.ts and are shared with the
development seed and regression fixtures. The new administrator migration updates only a
system role whose complete grant/scope map exactly matches the previous template. Customized
roles and intentional revocations are preserved. An owner must review and update those roles
through the existing role-management flow if operational delegation is desired. Do not rerun
the development seed against a customized production tenant to apply this fix.

Regression tests cover real teacher/reception/accountant/payment-only HTTP flows, scope
denials, successful payment recording, administrator delegation and migration idempotency,
permission-version invalidation and customization preservation. Flutter widget tests exercise
payment-only navigation/selection and teacher medical alerts without forbidden profile calls.

## Leftover and contract cleanup

Root TypeScript explicitly includes backend, tests, scripts and seeds. Copied projects and
local databases under data/, and the separate Flutter app, cannot contaminate backend checks.
The backend Docker context excludes mobile/ and TypeScript build caches.

Production builds disable incremental compilation: Nest deletes dist/ before building,
while the previous cache could survive outside that directory and skip unchanged output.
Repeated builds now emit the complete application, including required runtime modules.

Public policy types match supported arrears billing and Telegram/internal delivery.
OpenAPI and response contracts were regenerated. README setup applies migrations before
seeding, removes resolved schema/test claims, and identifies current versus historical
documentation. September handoffs point to this record; historical audit evidence remains
available.

Deployment tests import safely on Windows. Portable patch tests run there; POSIX deployment
tests are explicitly skipped and remain in Linux CI.

## Validation

Database verification used only the isolated PostgreSQL 15.3 cluster on
127.0.0.1:55433 with synthetic records. Twelve migrations are applied; Prisma schema
validation and migration status pass.

| Check | Final result |
| --- | --- |
| Backend unit tests | 86 passed across 11 suites |
| Backend HTTP/database tests | 108 passed across 13 suites, including 21 October audit cases and 9 permission workflow cases |
| Backend ESLint and root TypeScript | Passed |
| Production backend build | Passed, including repeated full-output build checks |
| OpenAPI generation | Passed, 166 paths |
| Real pg-boss workers | Passed: internal notification processing, async XLSX/PDF generation, local storage, authenticated downloads and expiry |
| Web lint and TypeScript | Passed using the web checkout's own tools |
| Web production SSR build | Passed |
| Clean frontend archive plus patch | Exactly matches all 50 corrected files |
| Flutter analyzer and tests | No issues; 23 tests passed |
| Portable deployment patch tests | 4 passed |
| POSIX deployment integration tests | 9 skipped on Windows; configured in Linux CI |
| Deployment shell syntax / Python fixtures | Passed locally |

An earlier full HTTP run had one transient local database connection error in the existing
billing concurrency suite. That suite passed on rerun, and the complete final run passed.
The final isolated connection string used connection_limit=3 and pool_timeout=20.
Expected database errors in concurrency, duplicate and injected audit-failure cases are
part of successful negative tests.

Maintained regression coverage:
[HTTP/database cases](../test/project-audit-regression.e2e-spec.ts),
[limited-role workflows](../test/permission-workflows.e2e-spec.ts),
[lookup/date scope](../src/rbac/lookup-scope.spec.ts),
[mobile permission workflows](../mobile/test/permission_workflows_test.dart),
[enrollment episodes](../src/billing/enrollment-windows.spec.ts),
[export access](../src/reports/report-access.spec.ts),
[patch application](../test/deployment/test_frontend_patches.py), and
[real worker smoke](../test/runtime/worker-smoke.cjs).

CI now runs the real-worker smoke after its production build against its isolated PostgreSQL
service, with external Telegram delivery disabled. See README for local commands.
Local test artifacts and the final HTTP results are under data/project-fixes-2026-10-03/.
The temporary local PostgreSQL server was stopped after verification.

## Rollout and remaining limits

Deployments must apply
[20261003120000_notification_request_idempotency](../prisma/migrations/20261003120000_notification_request_idempotency/migration.sql)
and
[20261003140000_administrator_operational_permissions](../prisma/migrations/20261003140000_administrator_operational_permissions/migration.sql),
then regenerate the Prisma client and ship the backend, frontend patch and mobile changes together.
The migrations add notification request storage and update unchanged administrator templates;
they do not rewrite ledger or enrollment history. The normal backend image startup applies migrations.
Existing September migrations in the user's working tree must also be included in a deployment.

The historical enrollment correction relies on recorded status history and dated tariffs.
Missing or already incorrect historical records cannot be reconstructed reliably from code;
review affected old bills before issuing adjustments. Existing committed charges remain
immutable. Use the existing financial resolution flow for corrections.

The substantial preexisting working tree remains uncommitted. Source, new tests, migrations,
deployment helper and patches must travel together in the reviewed release.

Docker image/Compose execution, production PostgreSQL 16, S3 storage, real Telegram test-recipient
delivery, live browser/device workflows and the actual deployed web revision remain unverified
locally. Production database privilege separation remains the operational gap documented in
DEPLOYMENT.md. No parent portal, full mobile parity, unsupported billing timing or additional
notification providers were added; those are documented product scope boundaries.
