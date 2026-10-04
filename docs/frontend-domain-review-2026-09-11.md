> **Historical review:** These findings describe the code before the backend fixes in this working tree. See [the implementation and integration handoff](backend-handoff-2026-09-11.md) for current behavior, validation and explicit product limits. Original evidence is retained below.

**Kindergarten workflow and frontend API review — 11 September 2026**

The domain model is appropriate for a Stage 1 kindergarten administration system: children, guardians, effective-dated groups, attendance, pickup permissions, tariffs, discounts, charges, payments, expenses, medical records, documents, and staff permissions. The REST resource structure is reasonable. However, several complete workflows and frontend contracts are unfinished. “Most records exist” is not equivalent to “every screen can be integrated correctly.”

This supplements [the implementation logic review](logic-review-2026-09-11.md). Findings are based on current source, the checked-in OpenAPI document, seed roles, and the frontend specifications. No live API/database validation was possible in the earlier review because local PostgreSQL was unreachable. No application implementation was changed here.

**Fit with daily kindergarten operations**

| Workflow | Existing foundation | What needs completion or a business decision |
|---|---|---|
| Admission | Child, guardian links, documents, consent, status, group assignment, tariff assignment | Enrollment is several separate writes with no explicit readiness result. Define prerequisites for activation, and handle partial completion, future enrollment, withdrawal and return. |
| Morning register | Active children directory plus today's recorded attendance | The frontend must merge these datasets. An unmarked child is not necessarily absent. Define expected/not-arrived/present/absent/checked-out states, and how a child previously marked absent is checked in. |
| Pickup | Permanent people, temporary permissions, separate verification | Checkout must enforce authorization. An ad-hoc permission has no pickup-person ID, while checkout accepts only a person ID; the full temporary-person release flow is incomplete. |
| Group management | Capacity, staff slots, effective dates, transfer history | Future transfers currently appear immediately; withdrawal does not release assignments. Date-aware rosters and capacity must agree. |
| Monthly billing | Attendance calculation, discounts, preview/commit, immutable charges | Mid-month candidates, tariff replacement, advance allocation and attendance corrections are incomplete. The business must confirm the divisor and absence/refund policy. |
| Money collection | Payments, FIFO allocation, receipt output, net balance | Cancellation and refund are different events. Define partial refunds/credits, one-off fees, automatic receipt numbering, and due dates for manual charges. Current endpoints do not cover these as a complete workflow. |
| Parent/staff communication | Telegram bindings, templates, manual publication, delivery log | Scheduled announcements store `publishAt` but do not schedule delivery. Staff audience resolves to no recipients. Stored attachments are not delivered by announcement fan-out. |
| Medical and documents | Records, allergies, medications, alerts, expiration dates | Role access must match each screen. A dedicated medication-administration or incident log would be additional scope, if this kindergarten needs one. |

Sources: [children service](../src/children/children.service.ts), [attendance service](../src/attendance/attendance.service.ts), [pickup service](../src/pickup/pickup.service.ts), [billing runs](../src/billing/billing-runs.service.ts), [announcements](../src/notifications/announcements.service.ts).

**Billing policy cannot be inferred from the word “kindergarten”**

The documented default is attendance-based billing after the month, with fixed discounts before percentage discounts and working days restricted to the child's enrollment window. Under that formula, a child eligible for 11 days who attends all 11 receives `monthly tariff × 11 / 11`, or the full monthly base. If the intended policy is half a monthly fee for half a month, the denominator instead needs to be the full month's working days. This is a business-policy question even though the current helper follows the supplied specification. Separately, the billing candidate-selection defect can skip a tariff starting mid-month altogether.

Confirm these policies before treating the calculator as correct for this kindergarten:

- Fixed monthly fee, attendance-based arrears, or advance payment with later adjustment.
- Whether absence, illness, vacation and holidays reduce tuition, meal fees, or both.
- Full-month versus enrollment-window divisor for joining/leaving mid-month.
- Whether discounts apply per child, per tariff, or per family, and whether they are manual or automatic.
- One-time registration fees versus recurring fees. An open-ended `registration_fee` assignment currently creates a flat charge each billing month.
- Treatment of advances, refundable deposits, partial credits/refunds, and receipts.

Sources: [billing defaults](../src/billing/default-billing-rules.ts), [day calculation](../src/billing/billable-days.ts), [charge calculation](../src/billing/calculate-charge.ts), [billing specification](../kindergarten-docs/docs/03-billing-rules.md).

Payroll, curriculum, kitchen/menu/inventory, parent portal, GPS and online payment integrations are explicitly deferred in the Stage 1 plan. Their absence is not a defect against the agreed scope. A full childcare platform would require additional modules; the current product is an administration, attendance and finance backend.

**Frontend integration findings**

1. **OpenAPI does not describe most response bodies.** A script counted 199 HTTP operations in `openapi.json`; only 22 contain an explicit success-response schema. The other 177 include JSON-producing auth, payments, debts, billing, roles, reports, pickup, dashboards and landing operations, as well as operations that may return no body or files. The guide's instruction to generate complete response types from this document cannot currently be followed. Describe JSON responses, binary responses, empty responses, and errors explicitly.

2. **Some documented contracts contradict the implementation.** `GET /payments` optional query filters are marked required in OpenAPI. Attendance check-in and group creation advertise HTTP 200, but their undecorated Nest POST handlers use the default 201. Check-in and calendar advertise `AttendanceDayDto.child`, but their service responses do not include that relation. Date-only fields are advertised as `YYYY-MM-DD`, while directly returned Prisma `Date` objects serialize as ISO timestamps. Contract checks need to cover actual status, JSON shape and serialization.

3. **Lists have incompatible behavior.** `/children` returns `{data, meta}`, but payments, groups, users and many other lists return arrays. Payments and attendance lists stop at 500 rows without a continuation mechanism. The guide says all lists support pagination, sorting and a shared envelope; the implementation does not. Small lookup lists may reasonably remain arrays, but pageable directories and ledgers need an explicit consistent contract.

4. **Rows lack some screen-required display data.** Child directory rows have names/group/photo but no returned debt or medical-alert badge fields, despite supporting those filters. Payment rows contain child/payer/staff IDs without names, contrary to the integration guide's payment-name example. Billing preview lines contain child/tariff IDs and calculations but no child/group/tariff display labels. This data can often be assembled from other endpoints, but increases requests and may encounter permission restrictions. Add safe summary relations or documented batch lookups; do not require full medical/finance access to render unrelated screens.

5. **Child profile composition needs an explicit contract.** The main profile includes group, guardian links and allergies, but not the current tariffs or financial summary promised in the functional spec. Separate tariff/debt/document endpoints exist, so this is primarily a composition/documentation gap. Document the authorized tab requests or offer permission-aware expansions. Never expose restricted financial or medical data merely to save an HTTP call.

6. **Billing runs cannot be browsed or recovered by period.** The API can create a preview, get a run by known ID, explain, commit and discard. There is no `GET /billing-runs` list/filter operation. Period responses do not include their runs. A frontend that loses an uncommitted preview ID cannot browse back to it. Add period/status filtering and links to previews and committed runs; local browser storage is not an adequate source of truth for this workflow.

7. **Some required actions are missing.** There is no safe effective-dated tariff replacement/end-assignment API, no attendance-to-finance recalculation/adjustment action, and no checkout request field for an ad-hoc pickup permission. These cannot be fixed by frontend response mapping. The backend must own the transactions and validation.

8. **Application bootstrap and lookup permissions are incomplete.** `/auth/me` provides the user, roles, permissions and branch IDs, but not branch labels, assigned-group summaries, organization display settings, timezone or currency. Reading branches requires `branch:manage`; reading settings requires `settings:manage`. Teachers have no seeded `group:read`. Add minimal authorized bootstrap/lookups so ordinary users can render navigation, filters and settings-dependent text without administrative grants.

9. **Seeded roles do not support every documented screen.** Reception has pickup permissions but lacks `file:read`, preventing authorized pickup-photo downloads. Accountants have payment/expense permissions but no `file:manage`, preventing attachment uploads. These are seed-policy mismatches, not proof of the deployed tenant's editable grants. Validate complete screen flows using each seeded persona and least-privilege file access.

10. **Errors are not consistently machine-actionable.** Several distinctive conditions, including `ALREADY_CHECKED_IN`, `CAPACITY_EXCEEDED` and `BILLING_ALREADY_COMMITTED`, are placed in the message under a generic `CONFLICT` code. Some validation errors are 400 with string arrays, others 422 with different detail shapes. The frontend should not parse English messages to decide whether to retry, offer an override, or mark an offline operation successful. Standardize stable codes and field-level details.

11. **Configuration and scheduling fields overpromise behavior.** `receiptNumberFormat` is stored but never used to generate receipt numbers; omitted receipt numbers fall back to a payment UUID in receipts. Announcement scheduling and staff targeting are accepted but not executed. Hide unsupported controls only as a temporary product decision; the durable solution is to implement or reject the corresponding option.

12. **The handoff documents need reconciliation.** Besides response and pagination mismatches, the functional spec uses request names such as `role` instead of `roleId`, nested `audience` instead of `audienceType`/`audienceIds`, and settings `name` instead of `displayName`. It promises permission provenance, while effective-permissions returns only the resolved map. The whitelist rejects unsupported body fields. Do not tell frontend developers that either the prose or current OpenAPI is universally authoritative until both match execution.

Evidence: [OpenAPI](../openapi.json), [integration guide](frontend-integration-guide.md), [functional specification](frontend-functional-spec.md), [auth controller](../src/auth/auth.controller.ts), [branch controller](../src/admin/branches.controller.ts), [settings controller](../src/admin/settings.controller.ts), [children response DTOs](../src/children/dto/child-response.dto.ts), [attendance response DTOs](../src/attendance/dto/attendance-response.dto.ts), [payment service](../src/payments/payments.service.ts), [billing controller](../src/billing/billing-runs.controller.ts), [seed roles](../prisma/seed.ts), [error filter](../src/common/filters/all-exceptions.filter.ts).

**Proposed minimum frontend contract — additions, not existing endpoints**

| Contract | Necessary contents |
|---|---|
| Extend `/auth/me` or add bootstrap | Safe organization settings, current user, branch/group summaries, permission scopes; exclude administrative secrets and banking data. |
| Attendance board read | Date-aware eligible roster including unmarked children, group/name/photo, attendance ID and status/times, permission-filtered alerts, and action availability if useful. |
| Child directory/detail DTOs | Stable summary fields and scoped badge data; explicit contract for loading guardian, document, medical and finance tabs. |
| Payment/charge list DTOs | IDs plus safe display summaries, amounts, effective cancellation/reversal status, allocation/outstanding values, and pagination. |
| Billing-run list/detail | Period, status, totals, timestamps, run ID, child/tariff summaries, calculation trace, and a way to return to a saved preview. |
| Workflow mutations | Validated activation/withdrawal, tariff replacement, pickup by authorization, and auditable financial adjustments. |
| Shared API contracts | Accurate request/response/error schemas, defined date serialization, stable error codes, pagination and file-access rules. |

These can be implemented with ordinary NestJS controllers/services and DTOs; the findings do not imply a framework rewrite or a need for GraphQL. Separate tab requests are acceptable where documented and authorized. Build the final contract around complete user tasks and keep financial decisions and authorization on the server.

The next validation should walk through admission → first attendance → authorized pickup → first bill → payment → correction → withdrawal using actual HTTP responses, then repeat the relevant screens as teacher, reception, accountant and administrator. This checks both business fit and whether the frontend receives everything it needs without excessive permissions.
