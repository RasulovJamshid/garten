> **Historical review:** These findings describe the code before the backend fixes in this working tree. See [the implementation and integration handoff](backend-handoff-2026-09-11.md) for current behavior, validation and explicit product limits. Original evidence is retained below.

**Backend logic review — 11 September 2026**

The backend has substantial functionality, but its logic is not complete or consistently enforced. The access-control, pickup, and finance findings below should be addressed before relying on it for daily operations. Passing the existing unit tests does not establish that the complete workflows work correctly.

This review covered the backend services, controllers, permission resolution, Prisma schema and migrations, existing tests, and the Stage 1 and billing specifications. There is no frontend in this repository. This is a source review with selected executable reproductions, not a certification of every path or a production deployment assessment.

**Verification performed**

- `npm.cmd test -- --runInBand`: 6 suites, 59 tests passed.
- `npx.cmd tsc --noEmit`: passed.
- Read-only ESLint: failed with 5,672 `prettier/prettier` errors, including Windows CRLF line-ending issues. No other lint rule reported errors. No automatic formatting was applied.
- Eight isolated checks executed actual TypeScript services or validation/calculation code with in-memory dependency substitutes. They reproduced the ignored discount flag, historical-date scope bypass, unchecked checkout, unchecked initial role assignment, reversed-charge listing, concurrent cancellation decision path, partial expense closure, and acceptance of empty billing rules.
- Database-backed e2e tests were not run: the configured local PostgreSQL port, `localhost:5433`, was unreachable. The isolated checks do not verify PostgreSQL behavior, HTTP middleware, or real concurrent transactions. Database conclusions below come from the committed migrations and application queries.
- Application code and business data were not changed.

**Priority findings**

1. **High — creating a user bypasses role-grant safety checks.**

   `POST /users` requires `user:manage`, but `UsersService.create` writes the requested `roleId` directly into nested role assignments. Unlike the later role-assignment path, it never checks whether the actor holds the role's permissions. A restricted user manager who knows the Owner role ID can create an Owner account with a password they choose. The isolated execution confirmed that initial role assignment invokes no safety check. Validate the role, its tenant, the requested branches, each permission's scope, and sensitive grants before creating the account.

   Evidence: [users.service.ts](../src/users/users.service.ts), line 53; [users.controller.ts](../src/users/users.controller.ts), line 16; [rbac-safety.service.ts](../src/rbac/rbac-safety.service.ts), line 40.

2. **High — checkout does not enforce pickup authorization.**

   `AttendanceService.checkOut` checks attendance state, then writes the supplied pickup-person ID. It does not check the person's child association, revocation, permission validity, or a temporary authorization. The person is optional, and the separate `PickupService.verify` endpoint is never called by checkout. A rejected verification therefore does not prevent release being recorded through the API. The DTO even describes permission checking as unfinished. Checkout must validate authorization itself and record the permission used, including support for ad-hoc temporary permissions.

   Evidence: [attendance.service.ts](../src/attendance/attendance.service.ts), line 282; [check-out.dto.ts](../src/attendance/dto/check-out.dto.ts), line 10; [pickup.service.ts](../src/pickup/pickup.service.ts).

3. **High — branch/group scopes are not consistently enforced.**

   The global guard checks possession of a permission; it does not restrict database rows. Attendance mutations fetch a child/record by ID without applying the operation's branch or own-group scope. Medical records, payments, charges, debts, guardians, and private file reads also have paths that only enforce tenant membership. Thus a teacher with own-group medical access can request another group's medical records, and a branch accountant can read another branch's payments. Some child/group updates instead use the *read* permission's scope, which is wrong when write access is narrower. Apply each operation's own permission scope to its target and related records.

   Evidence: [permission.guard.ts](../src/rbac/permission.guard.ts); [attendance.service.ts](../src/attendance/attendance.service.ts), line 233; [medical.service.ts](../src/children/medical.service.ts), line 24; [payments.controller.ts](../src/payments/payments.controller.ts), line 35; [debts.service.ts](../src/debts/debts.service.ts), line 48; [files.service.ts](../src/files/files.service.ts).

4. **High — tenant filtering does not prevent cross-tenant relationships.**

   For example, guardian linking validates the guardian but never loads the target child through the tenant client before inserting the link. The schema references `child(id)`, not a composite tenant/child key. A known child ID from tenant B can therefore be attached to a tenant A link; `childrenOf` includes the related child's name and status without a nested tenant filter. User creation similarly accepts unvalidated role/branch IDs. Top-level tenant injection alone cannot protect these relationships. Check related-record ownership and add suitable composite constraints where feasible. This specific database scenario still needs a live two-tenant regression test.

   Evidence: [guardians.service.ts](../src/guardians/guardians.service.ts), line 119; [tenant-extension.ts](../src/prisma/tenant-extension.ts); [initial migration](../prisma/migrations/0_init/migration.sql), line 264.

5. **High — concurrent cancellations/reversals can corrupt balances.**

   Both payment cancellation and charge reversal read “no reversal exists” and then insert, without an atomic claim or unique source-reference constraint. Two concurrent requests can both pass and insert full reversals. Cancelling a 100-unit payment twice yields a net payment total of negative 100. The isolated service check reproduced two inserts under concurrent no-reversal reads; the migrations provide no unique backstop on `source_payment_id` or `source_charge_id`. Enforce one reversal per original in PostgreSQL and make the operation transactional and safely retryable.

   Evidence: [payments.service.ts](../src/payments/payments.service.ts), line 310; [charges.service.ts](../src/billing/charges.service.ts), line 105; [initial migration](../prisma/migrations/0_init/migration.sql), line 655.

6. **High — children whose tariffs start mid-month are omitted from that month's billing.**

   The run selects candidates and assignments active on the first day only. A child joining on September 15 with a tariff effective September 15 will not appear in September's run, even after attending for the rest of the month. The day-proration helpers never run for this child because candidate selection excludes them first. Select assignments overlapping the billing period and define how tariff changes within that period are calculated.

   Evidence: [billing-runs.service.ts](../src/billing/billing-runs.service.ts), line 42; [tariffs.service.ts](../src/money/tariffs.service.ts), line 142.

7. **High — normal tariff reassignment can prevent an entire billing run from committing.**

   Assigning another tuition tariff inserts a new assignment without ending the prior one or preventing overlap by tariff kind. There is no assignment-update/removal endpoint in the tariff controller. Both assignments then produce charge lines, but `uq_charge_once` permits only one positive charge per child/period/kind. The transaction rolls back the whole run, and the error is misleadingly classified as a concurrent commit. Tariff replacement needs an explicit effective-dated transition and overlap validation.

   Evidence: [tariffs.service.ts](../src/money/tariffs.service.ts), line 96; [billing-runs.service.ts](../src/billing/billing-runs.service.ts); [initial migration](../prisma/migrations/0_init/migration.sql), line 666.

8. **High — advance payments are never allocated to newly generated charges.**

   The payment allocator leaves excess money unallocated and promises the next billing run will apply it. Billing commit only creates charges and updates the run. The only allocation inserts in the source are inside payment creation. Paying 100 before a 100 charge can therefore produce a zero net balance while the charge and ageing views still show 100 outstanding; overdue reminders can be generated for an already funded account. Reconcile available credit whenever charges are created or reversed, using the same concurrency protections as payments.

   Evidence: [payments.service.ts](../src/payments/payments.service.ts), line 306; [billing-runs.service.ts](../src/billing/billing-runs.service.ts); [debt-reminder.service.ts](../src/notifications/debt-reminder.service.ts).

9. **High — attendance corrections do not update billing, and direct status changes bypass correction history.**

   The default rules promise reverse-and-reissue for an open period and an adjustment for a closed period. `correct` only changes attendance, inserts correction history, and audits; no recalculation follows. Separately, `POST /attendance/status`, protected only by check-in permission, upserts existing historical attendance without requiring a correction reason or recording a correction. Charges can silently diverge from attendance. Implement the configured recalculation workflow and route changes to existing attendance through correction controls. The current charge uniqueness index also needs redesign to permit a replacement after reversal.

   Evidence: [attendance.service.ts](../src/attendance/attendance.service.ts), line 344; [default-billing-rules.ts](../src/billing/default-billing-rules.ts), line 52; [attendance.controller.ts](../src/attendance/attendance.controller.ts); [initial migration](../prisma/migrations/0_init/migration.sql), line 666.

10. **High — invalid billing configurations can be saved and break billing.**

    The rules DTO validates only that `rules` is an object. An empty object passes validation but throws when the calculator accesses its required fields. Nested enums, numbers, money strings, and consistency between fields are unchecked. Version creation also closes the prior version before creating the new one, outside a shared transaction, so insertion failure can leave an unintended effective-date gap. Validate the complete rules structure and perform version transitions atomically.

    Evidence: [create-billing-rules.dto.ts](../src/billing/dto/create-billing-rules.dto.ts), line 10; [billing-rules.service.ts](../src/billing/billing-rules.service.ts), line 85.

11. **Medium — advertised billing options silently do nothing.**

    `applyBeforeAttendance`, `billingTiming`, the enrollment/withdrawal proration modes, and recalculation policies are stored but not consulted by their respective execution paths. The reproduced discount example used a 10,000-tiyin tariff, half attendance, and a 2,000 fixed discount: both flag values returned 3,000, although applying the discount before attendance should return 4,000. Implement supported options and reject unsupported ones rather than accepting ineffective settings. The default enrollment-window divisor itself matches the supplied specification and is not counted as a separate defect here.

    Evidence: [calculate-charge.ts](../src/billing/calculate-charge.ts); [billing-rules.types.ts](../src/billing/billing-rules.types.ts); [billing specification](../kindergarten-docs/docs/03-billing-rules.md).

12. **Medium — financial screens disagree about reversals and overdue debt.**

    The charge list excludes cancelled funding payments, but does not exclude reversed charges; a reversed charge still appears as unpaid. Dashboard revenue sums only positive payments, so cancelling a payment leaves revenue overstated. The payment report includes cancellation rows but exports their positive amounts without a sign or cancellation indicator. Finally, `overdueOnly` tests positive net debt rather than whether a due date has passed. Reuse consistent signed-ledger and outstanding-charge calculations across lists, dashboards, reports, and reminders.

    Evidence: [charges.service.ts](../src/billing/charges.service.ts), line 21; [dashboard.service.ts](../src/dashboard/dashboard.service.ts), line 51; [reports.service.ts](../src/reports/reports.service.ts), line 236; [debts.service.ts](../src/debts/debts.service.ts), line 53.

13. **Medium — future transfers take effect immediately in current-group queries.**

    Reassignment closes the current row with a future end date and inserts the future assignment with no end date. Rosters, capacity counts, child profiles, and check-in group selection treat `effectiveTo: null` as current and ignore `effectiveFrom`. Scheduling an October 1 transfer in September therefore immediately moves the displayed child and can record September attendance under the October group. Resolve membership against the relevant date using both ends of the assignment interval.

    Evidence: [groups.service.ts](../src/groups/groups.service.ts), line 122; [groups.service.ts](../src/groups/groups.service.ts), line 161; [attendance.service.ts](../src/attendance/attendance.service.ts), line 252; [children.service.ts](../src/children/children.service.ts).

14. **Medium — child withdrawal/reactivation does not complete the associated lifecycle.**

    Withdrawal changes status and withdrawal date but does not close group/tariff assignments. Reactivation does not clear the prior withdrawal date. Check-in validates neither active status nor deletion, and billing candidates do not filter deleted/inactive children. Withdrawn children can retain places and receive flat monthly extras; reactivated children can retain a billing window that already ended. Define effective-dated lifecycle transitions and update enrollment, group membership, billing eligibility, and attendance eligibility consistently.

    Evidence: [children.service.ts](../src/children/children.service.ts), method `setStatus`; [attendance.service.ts](../src/attendance/attendance.service.ts), line 233; [tariffs.service.ts](../src/money/tariffs.service.ts), line 154.

15. **Medium — a partial expense payment closes the whole expense.**

    Paying any valid amount changes status to `paid`, regardless of the invoice amount. The reproduced 100-tiyin payment against a 10,000-tiyin expense hid the 9,900 remainder from unpaid expenses; another payment is then rejected as already paid. Either require exact full settlement for this two-state model or implement partial payments and an outstanding amount.

    Evidence: [expenses.service.ts](../src/expenses/expenses.service.ts), line 91.

16. **Medium — admin password resets leave refresh sessions valid.**

    Updating a user's password through `UsersService.update` replaces the hash without revoking sessions. The dedicated auth password-change/reset methods do revoke sessions. After an administrator resets a password, an old refresh cookie can therefore continue renewing access. Apply the same session-revocation policy to every password-reset path. The separately documented short lifetime of existing stateless access tokens is not itself counted as a defect.

    Evidence: [users.service.ts](../src/users/users.service.ts), line 91; [auth.service.ts](../src/auth/auth.service.ts), method `revokeAllSessions`.

**Additional concrete gaps found by source inspection**

| Area | Behavior and consequence | Evidence |
|---|---|---|
| Today-only attendance | A caller-supplied `date` becomes the permission's date restriction. A historical date is accepted under a `today` grant. Reproduced with `2001-01-01`. | `src/attendance/attendance.service.ts:83` |
| Date filters | Date-only payment/report end bounds become UTC midnight with `lte`, excluding most of the requested final day. Dashboard local-day boundaries also use UTC midnight instead of Tashkent midnight. | `src/payments/payments.service.ts:32`, `src/reports/reports.service.ts:240`, `src/dashboard/dashboard.service.ts:76` |
| Report completeness | Finance queries cap results at 5,000 rows before deciding whether to export asynchronously. With the default threshold of 5,000 and a strict `>` check, these reports silently truncate and never take the large-export path. | `src/reports/reports.service.ts:211`, `src/reports/reports.controller.ts:52` |
| Disabled Telegram | The worker completes jobs while leaving notifications `queued` when Telegram is disabled. Enabling it does not reschedule completed jobs, while manual retry only accepts `failed` notifications. | `src/notifications/notification-worker.service.ts:78`, `src/notifications/notifications.service.ts`, method `retry` |
| Notification deduplication | Manual sends without an entity ID all use `manual`, so subsequent messages using the same template and recipient reuse the first notification. Debt-reminder keys omit the child ID, so siblings sharing a guardian collide in the same week. | `src/notifications/notifications.service.ts`, method `send`; `src/notifications/debt-reminder.service.ts`, method `runForTenant` |
| Import concurrency | Commit checks `validated` once, inserts rows individually, then updates status at the end. Two commits can both run, and a crash can leave successful rows behind with a still-retryable job. This can duplicate children/expenses. | `src/imports/imports.service.ts`, method `commit` |

**What is already useful, and what remains unproven**

The integer-money calculation helpers, tenant filter mechanism, append-only ledger triggers, payment-allocation transaction, period checks, role safety helpers, and published-versus-draft landing separation provide a useful foundation. Existing tests cover selected arithmetic, scoping helpers, and landing content behavior. Database test files also exist for tenant isolation, RBAC, payments, concurrency, and period closure; the README's claim that several of those files are missing is stale.

The test suite still needs coverage of the complete scenarios above, including unauthorized targets, repeated/concurrent mutations, mid-month enrollment, tariff replacement, advance credit, corrections after billing, future transfers, partial expenses, large exports, and notification recovery. Real PostgreSQL execution is necessary to verify financial locking, tenant relationship constraints, and transactions. Telegram delivery and storage-driver behavior were not integration-tested during this review.

Fix access control and pickup first, then ledger integrity and billing lifecycle, then operational/reporting gaps. Re-run the existing e2e suite against an isolated seeded database and add regressions for each repaired workflow before treating the backend as ready for daily use.
