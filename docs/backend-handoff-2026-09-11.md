# Backend integration update — 11 September 2026

**Current corrections:** [3 October 2026 correction record](project-fixes-2026-10-03.md) and the current OpenAPI supersede conflicting behavior in this dated handoff.

This update supersedes conflicting examples in the earlier frontend guides. Implementation is backend only. The separate frontend team should use the regenerated `openapi.json` for request names, response types, optional parameters and HTTP status codes.

## Integration contract

- Base path remains `/api/v1`. Login returns an access token and sets the refresh cookie. Send `credentials: 'include'` when refreshing.
- `GET /auth/bootstrap` returns the current user, roles, effective permissions, permission version, organization, accessible branch/group labels, own group IDs, timezone and currency. Administrative settings access is unnecessary for these lookups.
- Monetary integers are **decimal strings in tiyin**, including balances and adjustments. Do not convert them through JavaScript `Number` for arithmetic.
- Prisma date values in JSON are ISO timestamps. For date-only database columns, use the `YYYY-MM-DD` portion without converting that date to another timezone. Attendance day boundaries and date-only payment/report filters use Asia/Tashkent. Timestamp range filters include the entire `to` calendar date.
- `/children` retains its `{data, meta}` envelope. Ordinary JSON collection endpoints returning arrays accept optional `page` and/or `limit` to return the same envelope. Without those parameters they retain their array response for compatibility. Page numbers start at 1; limit defaults to 50 and cannot exceed 200. Only children currently performs pagination in the database; the compatibility adapter slices other authorized collections in memory. Large installations should move those endpoints to database pagination before increasing traffic substantially.
- Optional pagination is represented as a response union in OpenAPI. Object responses such as the attendance board and summaries keep their own shape. Report responses written directly to the response stream use their documented `format` contract and are not paginated by this adapter.
- Read `error.code` to select UI behavior. Named conflicts such as `ALREADY_CHECKED_IN`, `PICKUP_NOT_AUTHORIZED`, `CAPACITY_EXCEEDED`, `BILLING_PREVIEW_STALE`, `IDEMPOTENCY_CONFLICT` and `CONCURRENT_PAYMENT` are now codes, rather than text hidden under `CONFLICT`. `error.message` is diagnostic text. `details` remains endpoint-specific.
- POST operations normally return 201 unless the route explicitly specifies 200. Authentication POSTs remain 200.

## Attendance and pickup

`GET /attendance/board?groupId=…&branchId=…` returns `{date, data}`. Each item contains `child`, nullable `attendance`, and `recorded`. A null attendance row means no status has been recorded; it does not assert absence. Existing `/attendance/today` remains a list of recorded rows.

Check-in and checkout apply the caller's operation-specific child scope and accept events for today. Historical changes use the correction flow. A real arrival can replace today's absence entry, recording correction history and its billing outcome. A second check-in is a conflict.

Checkout requires `pickupPersonId` or `pickupPermissionId`. The permission must belong to the child, cover the day, and be unrevoked; a linked pickup person must also be unrevoked. Ad-hoc temporary permissions work without creating a standing pickup person. Checkout stores the permission used and rejects a time before check-in.

`GET /pickup/verify` accepts `childId` and either pickup identifier. It returns `allowed`, a reason, the permission ID, pickup name and available person/photo details. Checkout always verifies again; a previous successful lookup is not authorization to bypass the checkout checks.

Changing an existing status requires `attendance:correct` and a reason of at least ten characters. Non-attendance cannot coexist with a check-in: correct an erroneous checkout/check-in first, then the status. Empty `newValue` clears a timestamp. Correction timestamps must belong to the attendance date in Tashkent. Corrections include `billingResolution`: `not_required`, `applied`, or `manual_required`.

## Billing and payments

- Billing includes tariff assignments overlapping the month, including mid-month starts. Effective tariff segments are combined into one charge per child/kind. Tariff prices, discount inputs and calculation windows are saved with the charge for later attendance recalculation.
- Assigning a replacement tariff closes an overlapping earlier assignment of the same kind; conflicting future intervals are rejected. `PATCH /children/:childId/tariffs/:assignmentId` accepts `{effectiveTo}` to end an assignment. Backdated changes to billed periods require a financial adjustment.
- `GET /billing-runs?periodId=…&status=…` makes previews and committed runs recoverable. Period responses include run IDs and status. A commit rejects a stale preview; create another preview after input changes. Commit requires `Idempotency-Key`.
- Billing remains **arrears**. Advance/estimate billing configurations are rejected. Advance **payments** are supported and allocated when charges are created. The existing enrollment-window divisor default is preserved; changing that policy requires an explicit billing-rules version.
- Rules are validated before storage/simulation. Discount order, applying discounts before attendance, working-day calculation, full-month proration, rounding and recalculation policy are handled by the backend.
- Open-period attendance corrections reverse and reissue the charge when configured. Closed-period corrections create a signed adjustment in a following open period. Manual-only policies leave a visible pending resolution. `POST /children/:childId/recalculate-billing` with `{year, month}` resolves that pending financial work using saved billing inputs.
- `GET /charges` returns active positive charges, with allocated/outstanding amounts and child labels. `unpaidOnly=true` excludes reversed charges. `GET /children/:childId/charge-ledger` returns all charge entries, including reversals and signed adjustments.
- `POST /charges/adjustments` accepts `{childId, periodId, sign, amountTiyin, reason, dueDate?}`. A negative sign credits the family; a positive sign adds debt. Amount must be positive and reason must have at least ten characters. Both `charge:generate` and `charge:reverse` are required. This is a ledger adjustment, **not a cash refund**. Cash refunds are not implemented as a separate payment workflow.
- Payment requests require an idempotency key. Reusing a new payment's key with changed request data is rejected. Cancellations and charge reversals are append-only, transactionally locked, and protected against duplicate reversals in PostgreSQL.
- Omitted receipt numbers use the configured format, including the default `R-{YYYY}-{SEQ:6}`. Explicit receipt numbers remain accepted.
- Overdue filtering uses due dates rather than merely positive debt. Financial totals exclude canceled/reversed entries where they represent active balances. Payment reports list uncanceled payments; cancellation reports supply the reversal history.
- Expenses support full settlement. A partial amount is rejected and leaves the expense unpaid. A separate partial-settlement ledger is not implemented.

## Profiles, authorization and files

Child list rows now include `hasDebt` and `hasMedicalAlert`. A null badge means the caller cannot access that information. Filtering by either badge requires the corresponding permission. Payment rows include child and payer summaries; billing lines include child and tariff names.

Build profile tabs from the existing authorized child, guardian, medical, document, consent, tariff, debt and attendance endpoints. A child-read permission does not implicitly authorize medical records or financial tabs. `/users/:id/effective-permissions` also returns role sources, branch assignments and overrides for administrative permission explanations.

Role creation, cloning and assignment enforce grant scope and sensitive-permission restrictions. Branch scopes also consider where the corresponding role grant applies. Where multiple scopes exist for one permission, the broadest scope wins; its branch grants define the accessible branches. Administrative password changes revoke refresh sessions.

Private file access checks the associated resource or accessible references. Files uploaded before their parent record is created remain readable by their uploader and become available to other authorized staff when linked. Supported explicit file entity types are `child`, `medical`, `pickup_person`, `child_document`, `expense`, `import_job`, `landing_page`, and `landing_block`. Seed grants now include pickup-photo access for reception and attachment upload access for accountants/nurses as applicable. Production roles remain editable.

Future group assignments do not replace the current group early. Group admission locks the group and checks capacity across the planned interval. Staff assignments can be changed back to a previously assigned staff member; null clears a staff slot. Withdrawal ends group/tariff assignments and removes future assignments; reactivation clears withdrawal and starts the new enrollment window.

## Imports and notifications

An import commit locks its job. With `skipInvalid=false`, a runtime row failure rolls the entire import back. With `skipInvalid=true`, failed rows roll back to a savepoint and successful rows commit together. Replaying a completed job returns its result. Imported temporary passwords use cryptographic randomness.

Announcements support staff targeting and delayed delivery: create the announcement, then publish it to enqueue delivery for `publishAt`. Deleted/expired announcements are skipped at delivery. Attachment delivery is explicitly rejected until a provider implementation exists. Notification channels currently supported are Telegram and internal; SMS/email requests are rejected.

Manual notification retries now reuse the required `Idempotency-Key` and identical payload, including sends without `entityId`. Reusing the key with a changed payload returns 409. Intentional separate sends use new keys; domain-event sends can additionally supply a stable `entityId`. Sibling reminders use separate child event keys. Workers serialize delivery attempts per notification, and a recurring recovery scan requeues queued notifications, including work left while Telegram was disabled. Telegram does not provide an atomic transaction with this database, so a process failure immediately after remote delivery can still leave delivery status uncertain.

## Backend deployment and validation

Run `npm run prisma:generate` and `npm run prisma:migrate:deploy` during backend rollout. This change adds four migrations: integrity constraints/receipt counters, financial adjustments, attendance billing resolution, and payment request hashes. Existing inconsistent tenant links or duplicate reversals must be reconciled before the constraints can apply; migrations do not silently rewrite historical financial records.

`npm run openapi` regenerates response contracts from controller return types and Prisma selections, and updates the checked-in schema. Runtime Swagger uses the same generated contracts. Regenerate after changing response shapes. Dynamic JSON fields such as calculation traces and report cell values intentionally retain flexible schemas.

Validation used an isolated PostgreSQL 15.3 database with Telegram disabled, not the configured business database. Unit and HTTP/database regression tests cover calculation policies, tenant boundaries, role safety, payment/billing concurrency, pickup authorization, attendance recalculation, imports and pagination. The test database retains append-only ledger fixtures. Production PostgreSQL and real external message delivery were not exercised.

Final verification: production build and ESLint passed; 68 unit tests and 78 HTTP/database tests passed. OpenAPI contains 206 operations across 164 paths.
