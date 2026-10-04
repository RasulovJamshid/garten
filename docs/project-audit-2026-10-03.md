# Project capability and logic audit

Reviewed on 3 October 2026 against the working tree in D:/Projects/garten-management at the start of the audit.

**Historical audit:** the defects below were subsequently corrected. See [the correction and validation record](project-fixes-2026-10-03.md) for current behavior. Original reproduction assertions intentionally expect the old defects and are not the maintained correctness suite.

The backend can perform the normal Stage 1 workflows, and its build and existing tests pass. It is not ready to be treated as a fully reliable kindergarten management system: this review reproduced nine defects involving authorization, billing, session rotation, branch transfers, and medical warnings. The project needs targeted corrections and acceptance testing. The evidence does not support a recommendation to rewrite it.

This audit preserves the existing application changes. It adds this review and isolated evidence under data/; it does not fix application code, delete existing artifacts, deploy anything, or change business records.

## Scope and validation

The review covered backend services and API contracts, billing and payment logic, permission scopes, the Flutter companion, deployment configuration, existing review documents, and the cached web frontend. The cached frontend is based on commit 5d39744 from 9 September 2026, with local changes to bun.lock and the generated route tree. Findings about that checkout do not establish what the current deployed website does.

Database checks used a new PostgreSQL 15.3 cluster on 127.0.0.1:55433 containing only synthetic audit records. All ten migrations applied and the seed completed. The production configuration specifies PostgreSQL 16, so these results do not verify that exact database version.

| Check | Result | What it establishes |
| --- | --- | --- |
| Backend unit tests | 68 passed | Existing unit scenarios pass |
| Existing HTTP and database tests | 78 passed across 11 suites | Existing integration scenarios pass on the isolated database |
| Additional defect reproductions | 9 passed | Each assertion confirms an observed defect; these are not correctness tests |
| Backend production build | Passed | Current backend compiles |
| Backend ESLint | Passed | src/ and test/ pass configured lint |
| Backend source type check | Passed | tsconfig.build.json passes with no emit |
| Root type check | Failed | tsconfig.json includes copied frontend projects under data/ |
| Flutter analyzer | Passed | No analyzer issues |
| Flutter tests | 21 passed | Existing mobile test scenarios pass |
| Deployment Python tests on Windows | Could not import | os.geteuid() is unavailable on Windows |
| Docker image and deployment | Unverified | The local Docker daemon was unavailable |
| Real background workers and external delivery | Unverified | Integration tests replace pg-boss with a no-op stub |

The additional checks are saved in [logic.spec.ts](../data/project-audit-2026-10-03/logic.spec.ts), with a separate [Jest configuration](../data/project-audit-2026-10-03/jest.json) and [results.json](../data/project-audit-2026-10-03/results.json). Seven reproductions use real HTTP requests and database rows. The segmented-fee and refresh-race checks call the actual services with controlled inputs or dependencies. Their passing assertions demonstrate current incorrect behavior.

Do not run those checks against a business database. The audit suite rejects a DATABASE_URL that does not identify the dedicated localhost audit port. That safeguard is specific to this local reproduction suite.

## Reproduced defects

### 1 Group filters can bypass the active children report restriction

**High priority.** In [reports.service.ts](../src/reports/reports.service.ts), childrenActive() spreads the caller's child permission filter and then sets groupAssignment again when groupId is supplied, around lines 110 to 116. This replaces the own_group restriction.

A custom user with child:read at own_group and report:read was denied direct access to a child in another group with HTTP 404. Supplying that other group's ID to /reports/children/active returned HTTP 200 and the child's name, birth date, and enrollment date.

Combine permission predicates and user filters with AND, as the children directory already does. Add a report regression test proving that a supplied group cannot widen access. This reproduces a group-scope leak within one tenant; it is not evidence of a cross-tenant leak.

### 2 Expense payment uses read scope instead of manage scope

**High priority.** In [expenses.service.ts](../src/expenses/expenses.service.ts), pay() calls findOneOrThrow(id) with its default expense:read permission, around line 95. The controller checks that expense:manage exists but does not resolve the target expense under its manage scope.

A user with expense:read for all branches and expense:manage only for branch A received 404 when editing a branch B expense, but successfully paid that same expense with HTTP 201.

Resolve the expense using expense:manage and retain the conditional unpaid-state update. Add the converse test for a user allowed to manage but not read an expense.

### 3 User administration can grant access beyond the actor's permission branches

**High priority.** [rbac-safety.service.ts](../src/rbac/rbac-safety.service.ts), assertGrantable() around line 51, checks the permission key and scope name. It does not compare the actual permitted branch sets. [users.service.ts](../src/users/users.service.ts), around lines 60 to 62 and the other role-assignment paths, checks destination branches using user:manage.

A user with user:manage for all branches but payment:read only for branch A created a new user with a chosen password and a payment-reader role in branch B. The API returned 201.

Before assigning or expanding a role, verify that every granted permission's branch footprint is contained in the actor's footprint for that permission. General authority to manage users does not satisfy the existing rule that an actor cannot grant permissions beyond their own access. Apply the same check to branch changes, role replacement, and overrides.

### 4 Leaving and returning within one month loses earlier billing attendance

**High priority.** [children.service.ts](../src/children/children.service.ts), around lines 314 to 315, resets enrollmentDate on reactivation and clears withdrawalDate. [billing-rules.service.ts](../src/billing/billing-rules.service.ts), around lines 174 to 194, reconstructs earlier enrollment only when the current enrollment date falls after the billing month.

The reproduction enrolled a child on 1 September, recorded attendance on 2 September, withdrew the child on 10 September, reactivated them on 20 September, and recorded attendance on 21 September. Appropriate tariff assignments existed for both active intervals. September billing counted only one of the two attendance records and produced 27,500 tiyin.

Calculate billing against historical enrollment episodes and their intersections with tariff assignments. A single mutable start and end pair cannot represent two active intervals in the same month. Cover same-month return, later-month return, and repeated transitions.

### 5 Segmented flat fees can collapse to the attendance minimum

**High priority for finance.** In [billing-runs.service.ts](../src/billing/billing-runs.service.ts), around lines 154 to 160, a multi-segment charge with no attendance is replaced by minChargeTiyin without checking the tariff kind's effective attendance mode.

The actual calculation service was given two equal working-day segments of an extra_class fee configured as flat_monthly: 22,000 and 44,000 tiyin. Their weighted flat fee is 33,000 tiyin. With noAttendanceBehaviour=min_charge and a 500 tiyin minimum, it returned 500 tiyin instead.

Apply the no-attendance policy only to attendance-dependent kinds, preserving flat and working-day modes. Test tariff changes across every supported mode and zero-attendance policy. This defect was reproduced with controlled billing contexts, rather than a complete HTTP enrollment scenario.

### 6 One refresh token can issue two sessions concurrently

**High priority for authentication.** [auth.service.ts](../src/auth/auth.service.ts), refresh() around lines 127 to 168, reads an unrevoked session, revokes it with an unconditional update, and issues a replacement session in separate operations.

Two synchronized calls using the same token both passed validation and created distinct replacement sessions. This defeats the expected single-use rotation property. The reproduction called the real AuthService with a controlled database dependency to force the race; it was not a live load test.

Consume the old session atomically with a conditional update or row lock inside the rotation transaction. Exactly one request should succeed. Review password-reset consumption for the same read-then-update pattern and add a separate concurrency test.

### 7 Accountant totals include canceled and inaccessible payments

**High priority.** In [dashboard.service.ts](../src/dashboard/dashboard.service.ts), accountant() around lines 76 to 85, paymentsToday filters positive payments by date but omits both the caller's payment scope and the cancellation exclusion. The director's revenue query already applies those conditions.

A branch A reader could see no payments in /payments. Their accountant dashboard still returned a branch B payment of 73,100 tiyin, even though it had been canceled with a matching negative payment.

Use the same payment scope and cancellation semantics as the payment list and director totals. Test dashboard parity with the underlying ledger for every role scope.

### 8 Changing a child's branch leaves active assignments in the old branch

**Medium priority, high before expanding branch use.** [children.service.ts](../src/children/children.service.ts), update() around line 250, accepts a new branchId without resolving existing group and tariff assignments.

After moving a child from A to B, the database still had an active group assignment to branch A and a tariff restricted to branch A. The HTTP update returned 200. This leaves the child's branch, roster assignment, and pricing inconsistent.

Define a transfer operation that ends and replaces relevant assignments atomically, or reject a branch change while incompatible assignments remain. Preserve historical attendance and charges in their original branches.

### 9 Medical warning badges omit emergency instructions

**Medium priority.** [children.service.ts](../src/children/children.service.ts), around lines 95 to 141, defines hasMedicalAlert solely from undeleted allergies. [medical.service.ts](../src/children/medical.service.ts), alerts() around line 38, also returns emergencyInstructions.

A child with emergency instructions but no allergies appeared with hasMedicalAlert=false in the directory, while their alerts endpoint returned those instructions. The medical-alert filter uses the same allergy-only definition.

Agree on one definition of a medical warning and use it consistently in badges, filters, profiles, and attendance. If this field intentionally means only allergies, rename the visible concept so staff do not infer that emergency instructions are absent.

## Additional findings from source review

These findings were established from code paths but were not included in the nine runtime reproductions.

**Manual notification retries do not use the required header.** [notifications.controller.ts](../src/notifications/notifications.controller.ts) requires Idempotency-Key but discards it. [notifications.service.ts](../src/notifications/notifications.service.ts) generates a new event ID when entityId is omitted. Retrying the same manual request and header can therefore enqueue another notification. The existing handoff describes independent manual sends, but the required header and retry-safety comments communicate a different contract. Either implement request-key deduplication or require a stable event ID and make retry behavior explicit.

**Export expiry is metadata only.** [export-worker.service.ts](../src/reports/export-worker.service.ts) sets a 24-hour expiresAt value and creates an export file without entityId. [exports.service.ts](../src/reports/exports.service.ts) returns its link without checking expiry. [files.service.ts](../src/files/files.service.ts) allows the uploader to access files without a linked entity and does not check export expiry. An uploader who retains file:read can keep accessing a previously generated report after expiry or after losing the underlying report permission. Bind exports to their jobs and recheck expiry and report authorization at download time.

**Financial writes and audit events are not consistently atomic.** [payments.service.ts](../src/payments/payments.service.ts), around line 204, logs payment creation after the financial transaction has committed. An audit failure can make the request fail after money has been recorded. [charges.service.ts](../src/billing/charges.service.ts), around line 209, logs a reversal from inside a transaction but does not pass that transaction to AuditService, unlike newer paths that do. A later rollback can leave an audit event for an uncommitted change. Use the transaction-aware audit interface consistently and test failures at the audit boundary.

## Cached web frontend incompatibilities

These are findings in data/alishax-frontend, not claims about the latest remote repository or deployed website. Its handwritten TypeScript response types do not establish that the API returns that shape.

| Workflow | Observed mismatch | Required correction |
| --- | --- | --- |
| Medical alerts | ChildMedicalTab.tsx calls .map() on a value typed as an array; the API returns an object containing allergies and emergencyInstructions | Consume the actual object and render both fields |
| Medical record form | The form resets from the top-level response; the API puts blood type and instructions inside record | Map record, allergies, and medications explicitly |
| Payment attachment | PaymentFormDialog.tsx supplies entityType=payment without entityId; the upload endpoint requires both when either is supplied and does not support payment as a bound entity type | Upload an unbound draft file using the supported contract, then attach its ID |
| Attendance roster | use-board-rows.ts fetches only the first 200 children and merges recorded attendance; children beyond that page with no attendance record are absent | Consume /attendance/board or implement complete scoped pagination |
| Branch filtering | The web roster supplies branchId to /children; the current children controller does not accept that filter | Use a supported roster endpoint or add a properly scoped branch filter |
| Temporary pickup | TemporaryPermissionForm can create an ad hoc permission, while use-pickup-checkout.ts only submits pickupPersonId | Support selecting and submitting pickupPermissionId |

Before calling the web product complete, validate these workflows against the current web checkout and the current backend contract. Source inspection of this cached checkout cannot replace that acceptance test.

## Leftovers and misleading project state

The leftover problem is partly documentation and partly build boundaries. Much of the data directory is useful historical output or a local tool workspace; age alone does not make it safe to delete.

1. **Copied projects contaminate root compilation.** [tsconfig.json](../tsconfig.json) has no explicit include and excludes only node_modules, dist, and kindergarten-docs. The root no-emit check picks up data/alishax-frontend and data/frontend-build-context and fails on their JSX, aliases, and module configuration. The backend build configuration passes. Limit root checking to the intended backend and test sources; give each app its own check.
2. **Flutter artifacts enter the backend Docker context.** [.dockerignore](../.dockerignore) excludes data but not mobile. The mobile directory contains build, .dart_tool, and native project output. Exclude mobile from the backend image context or use a narrower context. This is a configuration finding; no Docker image was built during this audit.
3. **Uncommitted work is substantial.** Before adding this report, git status showed 74 modified tracked files and 30 untracked top-level paths, including the entire mobile app, four September migrations, new tests, and deployment scripts. These files are present locally but are not represented by a reproducible commit. Review and commit coherent changes before relying on CI or deploying a checkout.
4. **README status is stale.** It says the user_role nullable-branch key defect remains, although the schema and July migration already fixed it. It lists integration tests as missing that now exist. It says type checking is green although root checking currently fails. Its local setup seeds before showing a migration step.
5. **Policy types advertise unsupported options.** billing-rules.types.ts still includes advance and estimate_then_trueup while validation accepts only arrears. Notification DTOs include SMS and email while the service rejects them. Align public contracts, examples, and UI choices with implemented policy.
6. **Historical reviews need a clear hierarchy.** September reviews and the later handoff document coexist with outdated README statements. Keep historical reviews dated and make the current handoff identify the active contract and remaining defects.
7. **Generated and temporary material needs clear ownership.** data contains frontend copies, handoff bundles, old logs, build context, and prior local review databases. tsconfig.build.tsbuildinfo is also untracked. Keep these outside source discovery and image contexts. Preserve backups and local databases until their purpose is checked. Generated openapi.json and response-contracts.json are consumed by the project and should not be deleted as apparent clutter.
8. **Deployment tests assume Unix.** test/deployment/test_frontend_deploy.py uses os.geteuid() in a decorator, so its module cannot import on Windows. This limits local verification; it does not show that the Linux deployment itself fails.

## Capability assessment

| Area | Current assessment |
| --- | --- |
| Staff login and permissions | Implemented, but refresh rotation and permission delegation have defects |
| Child records, guardians, groups, and enrollment | Main API operations exist; branch transfer consistency needs correction |
| Attendance and pickup | Backend workflows exist and have integration coverage; cached web roster and ad hoc pickup wiring need correction |
| Billing, payments, debt, and expenses | Main ledger workflows exist and tests pass; the reproduced billing and expense defects prevent a full reliability claim |
| Reports and dashboards | Implemented; report scoping and accountant totals have confirmed errors |
| Medical records | Backend records and alerts exist; warning semantics and cached web response handling need correction |
| Notifications and asynchronous exports | Implemented in source; real worker processing and external delivery were not verified |
| Flutter staff app | Analyzer and 21 tests pass; documented as an initial staff companion |
| Parent portal and full mobile parity | Not implemented as documented |

The mobile app explicitly excludes parent access, full enrollment, billing preview and commit, payment cancellation and refunds, imports, exports, role editing, document transfer, and several publishing tasks. Those are documented scope boundaries. The backend also deliberately rejects unsupported billing timing, partial expense settlement, SMS/email delivery, and announcement attachments. Define the promised product scope before treating these exclusions as implementation defects.

## Recommended repair order

1. Correct report and expense scope checks, then permission delegation across branches.
2. Make refresh rotation atomic and test concurrent token consumption.
3. Correct enrollment-episode billing and segmented-fee policy; add these scenarios to the maintained finance suite.
4. Align accountant totals, branch transfer invariants, and medical warning definitions.
5. Validate and update the current web frontend against the backend contract.
6. Repair compiler and Docker boundaries, update current documentation, and commit the intended source and migrations.
7. Run acceptance tests with real job workers, Telegram test recipients, storage, exports, and the actual deployment database version.

After those corrections, repeat a complete operational scenario: enroll a child, assign guardians/group/tariff, record attendance, authorize standing and temporary pickup, preview and commit billing, record and cancel payments, settle expenses, export reports, and verify notifications and audit records. Passing the current automated suite alone does not demonstrate these workflows under the cases reproduced here.