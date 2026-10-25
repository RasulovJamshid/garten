# Alishax Kids mobile

Flutter companion for the existing NestJS API, with Android and iOS projects.
Version 1.1 adds a native feature workspace covering all 196 authenticated business
operations in the committed API contract. Daily staff screens remain available.
It is implemented in Dart, not a WebView. No backend or live deployment changes
are required by this app.

## Run

Use Flutter **3.44.0 / Dart 3.12**, Java 17 and the Android SDK. Dependencies are
locked in `pubspec.lock`.

```sh
cd mobile
flutter pub get --enforce-lockfile
flutter run --dart-define=API_BASE_URL=https://api.alishaxkids.uz/api/v1
```

The default API is the real deployed backend. Log in with an existing staff
account. There are no embedded credentials, runtime mock mode, or automatic demo
seeding. Use a separate HTTPS staging API and test accounts for acceptance tests;
mutations against the production API act on real records. An emulator cannot
access the host through `localhost`; use a reachable HTTPS staging hostname.
Cleartext traffic and insecure TLS overrides are intentionally absent.

## Implemented scope

| Area | Mobile behavior |
| --- | --- |
| Accounts | Login, rotating refresh session, password recovery via existing Telegram reset flow, password change, language selection, logout |
| Access | Bootstrap-driven permissions and groups; independent action permissions; authorization changes reset private navigation |
| Today | Personal greeting and permitted shortcuts, including staff who lack dashboard permission |
| Attendance | Server roster, name/group/status filters, check-in, absence reasons, current-day status, refresh |
| Pickup | Select standing or temporary permission, verify, confirm identity, checkout with server revalidation |
| Children | Search, pagination, profile, linked guardians, document metadata, private photos and charge history |
| Registration | Create an applicant with branch/name/birth date; clearly identified as incomplete enrollment |
| Medical | View record/allergies/medications; edit blood type, chronic conditions, emergency instructions and note without replacing allergy/medication arrays |
| Payments | Select child, exact som-to-tiyin conversion, review, submit; securely persist uncertain operations for manual retry after restart |
| Finance | Paginated payment/charge/debt/expense cards and reversal presentation |
| Other tools | Groups, guardians, announcements, notification log, users, roles and audit lists with full workspace actions |

Navigation derives from permission keys, not role names. Owner, director,
accountant, administrator, reception, teacher, nurse and custom roles can use the
same app with the backend's assigned scopes. Open **More → All features** for the
complete workspace, or use the actions button on a child or resource record.

The workspace adds full child/profile and enrollment actions; guardian linking;
group transfers and staffing; tariffs and discounts; periods; billing rule versions,
simulation, preview/explanation/commit; charges, adjustments and reversals; payment
cancellation and receipts; expenses; attendance corrections and history; consents;
medical allergy/medication records; pickup administration; roles, grants, overrides
and users; settings, branches and holidays; notification templates, sends and
announcement publication; Telegram invites; all reports and export jobs; spreadsheet
imports; files; and landing-page drafts, blocks, SEO, publication and versions.

Forms use API request schemas, including enums, nested objects/arrays, nullable
assignments and validation constraints. Monetary fields accept UZS and send exact
integer tiyin strings. Optional fields are omitted until selected. Record pickers
request only permitted lookups; IDs can also be entered manually. Read results have
contextual actions and selectable values. Advanced arbitrary configuration objects
use a field editor. All 196 action titles, request fields, enum options, permission
descriptions and common record metadata have Uzbek/Russian labels. Authored names,
notes and descriptions are preserved. The home screen and feature browser use
responsive cards; optional form fields sit behind an expandable section. Language
selection updates all open screens, and layouts adapt to enlarged text. The profile card shows every assigned role using its localized API name; refreshing the profile updates role badges without requiring role-management permission.


File uploads use native selection and detected MIME types. Private downloads, PDF
receipts and XLSX/PDF reports use the authenticated transport, then the native share
sheet to save/share. Large reports returning 202 expose an export-status action and
a file-download action once ready. Imports provide template, validation, job detail
and commit actions. Financial and notification operations requiring idempotency
retain their immutable payload and key in secure storage after uncertain responses.
Successful writes disable repeat submission on the same screen.

**Not supplied by the current API:** parent login/own-child authorization, native
push registration, offline attendance, biometric app lock, payment refund accounting
(separate from cancellation), and medication administration logging. No mobile
workaround grants staff permissions to parents or invents unsupported endpoints. The announcement list is a management
surface, not a staff/parent inbox. These are follow-up features, not simulated controls.

Parent access requires a distinct backend authorization contract. Never grant
staff permissions to parents as a workaround.

## Platforms

- **Android 7 / API 24+**, matching the resolved secure-storage plugin. Flutter
  `PopScope` handles native back navigation. Internet permission is included;
  Android backup is disabled for encrypted credentials.
- **iOS 15+**, iPhone and iPad, with Keychain entitlements and HTTPS defaults.
  Safe areas, keyboard insets, system text scaling, adaptive dialogs and progress
  indicators are supported. Portrait and landscape remain enabled.
- Phones use bottom navigation; widths of at least 720 logical pixels use a rail.
- iOS compilation requires **macOS/Xcode**. The Windows development machine cannot
  compile or sign an IPA. `.github/workflows/mobile.yml` includes an unsigned iOS
  build job; adding the workflow does not mean that job has run.

References: [Flutter iOS](https://docs.flutter.dev/deployment/ios),
[Flutter Android](https://docs.flutter.dev/deployment/android),
[secure storage](https://pub.dev/packages/flutter_secure_storage).

## Build and signing

```sh
flutter build apk --debug
# mobile/build/app/outputs/flutter-apk/app-debug.apk
```

For Android release, copy `android/key.properties.example` to
`android/key.properties` and configure a private upload keystore. Keep keystores
and passwords out of git. Release tasks fail without signing configuration;
debug signing is never substituted for a release signature.

```sh
flutter build appbundle --release --dart-define=API_BASE_URL=https://api.alishaxkids.uz/api/v1
```

On macOS:

```sh
flutter build ios --debug --no-codesign
# Set Apple team, provisioning and final identifier in Runner.xcworkspace.
flutter build ipa --release
```

Development identifiers are `uz.alishaxkids.alishax_mobile` (Android) and
`uz.alishaxkids.alishaxMobile` (iOS). Finalize before creating store listings.
Distribution credentials, store metadata, privacy declarations, TestFlight/Play
delivery and physical-device acceptance are not included. Nothing is published.

Existing project branding is in `assets/logo-mark.png`. Native icons are generated
with `dart run flutter_launcher_icons`; the source image remains unchanged.

## Network and financial behavior

The login compatibility behavior from version 1.0.1 remains: it fixes login against older deployments that do not expose
`/auth/bootstrap`: only a 404 triggers fallback to `/auth/me`. Branch/group
lookups are requested only with the corresponding permissions. Profile-loading
failures are distinguished from invalid credentials. The fallback does not add
other missing backend endpoints or broaden authorization.

Access tokens stay in memory. The `kg_refresh` cookie is stored in platform
secure storage and sent only to auth endpoints. Concurrent expired requests share
one refresh; stale responses cannot restore a signed-out session. The API host is
a build parameter and credentialed redirects are not followed.

Private records are not persisted offline. Authorized photos remain in memory.
The intentional exception is an uncertain idempotent payment, billing commit or
notification send: the exact payload and request
key are encrypted and keyed to API environment and user. It remains after logout
so the same staff member can resolve a lost response on next login. Confirmed
success deletes it. Validation rejection unlocks editing; transport/server errors
retain the original immutable request. No automatic network retry creates a new
financial operation.

The server assigns attendance times and enforces pickup/financial rules.
Display dates use Asia/Tashkent; money uses BigInt, never floating-point arithmetic.

## Contract maintenance

From the repository root:

```sh
npm run mobile:contract
npm run mobile:contract:check
npm run mobile:localization
npm run mobile:localization:check
```

The offline generator reads OpenAPI request schemas, controller permission
decorators (including class-level and multiple requirements), DTO validation
constraints and nullable primitive types. It accounts for every route: 196 business
operations in the workspace and 12 public/integration/session routes handled by
dedicated flows or excluded from staff operations. New undocumented controller
operations and stale generated assets fail the CI contract check. Run
`npm run openapi` before regenerating after API changes. No database is touched
by the mobile contract generator.

Edit translations in `tool/localization/*.tsv`, then run the localization generator
and `dart format lib/core/feature_labels.dart` from the mobile directory. Permission
labels come from the backend catalog. CI rejects stale translations; the Flutter
coverage test catches missing action, field and enum labels when the API changes.

## Daily workflows

The **Sections** directory organizes all 33 API sections by daily work, families,
finance, communication, team access, reporting and organization settings. Search
finds tasks by their translated names. Collections load immediately; selecting a
record opens its own details and relevant actions. Back preserves the list and
search. Changing effective access still closes private routes.

Finance includes payments, charges, debts, expenses, tariffs, discounts, periods,
billing rules and billing runs. Child profiles expose related family, medical,
document, attendance and financial tasks. Standard forms show common optional
fields directly, select related records by name and keep the main action visible.
Edits fetch current details where the API has a matching read endpoint. Existing
role assignments, nested medical data and unchanged fields remain available.

Permission sets use searchable checklists with valid scopes. Notification
recipients choose a parent or staff member by name; template variables appear as
named fields. Website blocks use typed localized forms and ordering controls.
Billing-rule creation starts from the active rules. New website form schemas and
permission choices are generated from server code with
`npm run mobile:workflows`; CI runs `npm run mobile:workflows:check`.

Reference selections respect API permissions. Files, imports and exports without
list endpoints use records opened or created during the current session. Attachment
fields can upload device files directly. Group staff and child assignments retain
the dedicated guided screens introduced in 1.3.0.

## Verification

Local verification for 1.4.0 on 4 October 2026: the contract and translation freshness
checks, Flutter analysis and all 67 unit/widget tests passed. Tests render all 196
operation screens in both languages at phone size with enlarged text. They also
cover complete request localization, optional-field inclusion/removal, report
labels and live language switching, in addition to medical records, typed expenses,
nullable assignments, multipart replay and billing recovery. Additional checks cover
Back navigation, profile refreshes, stale search responses, staff assignment changes,
child assignment dates, attachment uploads, array selectors and narrow Russian layouts.
All 33 sections render in both languages; all 196 guided tasks render without
automatically sending writes. Tests also verify edit hydration, nested record
identity, role preservation, recipient selection, content labels and block ordering.
Android debug APK builds.
No authenticated live-server operations or iOS builds were performed here.

On Windows, Kotlin caches can fail when the project and Pub cache are on different
drives. The local verification build temporarily used `kotlin.incremental=false`
and `kotlin.compiler.execution.strategy=in-process`; original Gradle settings were
restored afterward.


```sh
dart format --output=none --set-exit-if-changed lib test tool
flutter analyze
flutter test --timeout=30s
flutter build apk --debug
```

Tests cover precise money, Tashkent dates, response shapes, simultaneous 401s,
logout races, unsafe URLs, permissions, phone/tablet layouts, restored payment
retry identity and denied pickup. Synthetic responses do **not** establish
authenticated live-server compatibility or iOS hardware behavior.

Optional visual previews with synthetic fixtures and a local font:

```sh
flutter test tool/preview_test.dart --dart-define=PREVIEW_FONT=/path/to/font.ttf
```

Outputs in `build/previews/` include login, attendance, and Uzbek/Russian home,
account, section directory, finance, staff details and editing, website content,
group directory, staff assignment and name picker screens. The font
is read only by the tool and is not redistributed in the app.

Before rollout, test attendance/pickup/payment against staging with each staff
role, verify privacy and background/resume on physical Android/iOS devices, and
run the macOS build job.

Appearance and daily attendance (1.5.0):
- More > Account > Appearance offers system, light and dark themes. The preference
  survives restart and changes theme without resetting navigation.
- Davomat starts with group selection and name search, with counts for waiting,
  in the garden, all absence reasons and collected children. Group changes hide
  the old roster until the new one loads. Pickup verification remains required.
- The attendance section opens the daily board; its history button opens history
  and correction tasks. Absence entry shows the selected child's name.
- Verified with 70 passing tests, Flutter analysis, generated metadata checks,
  and phone-sized synthetic light/dark previews in Uzbek and Russian.

Pickup and attendance fixes (1.5.1):
- Granting-parent selectors use only the selected child's linked, non-deleted
  guardians. Changing the child clears child-specific recipient selections.
- Pickup lists the child's parents separately from additional authorized people.
  Parent verification and checkout each validate the current child-guardian link
  under the employee's child scope. Checkout stores pickup_guardian_id.
- Arrival, absence and checkout update the affected card from the successful API
  response; they do not reload the board or block other children's actions.
- Backend deployment is required BEFORE using parent pickup. Apply migration
  20261004120000_attendance_guardian_pickup via `npx prisma migrate deploy`, then
  run the updated API (the production Docker entrypoint already applies migrations).
  No production deployment or production migration was performed in this session.


Usability fixes (1.5.3, 25 October 2026):
- Today and the child directory share enrollment; the Children tab and directory share the same collection UI. Attendance history is available from the main tab.
- Payment entry points share the dedicated review/recovery flow, including optional payer, receipt, bank, attachment and allocation fields. Pending requests from the former directory form remain recoverable with their original payload and key.
- Business dates display local Tashkent time; working days use named chips, hours use time pickers, and bank/tax settings use named fields while retaining custom values.
- Template selection handles the API templateKey and shows named variables with Uzbek/Russian message previews.
- Lists include available branch, billing period, due date, channel, queue/event time, recipient reference and record reference. Scoped child lookups remain permission-limited; they do not provide group/birth-date details.
- Required fields, keyboard-aware actions, field-specific removal labels, explicit discard/payment confirmations and several navigation/empty-state labels were improved.
- Validation: 93 unit/widget tests passed, Dart analysis clean, generated contract check passed, Android debug APK built. Physical Galaxy S9 validation uses read-only navigation and unsent drafts on the live API; no business submissions, backend deployment or production data changes.
- Follow-up audit work: guided import/publishing sequences, deeper parent-contact/report navigation, comprehensive role coverage and TalkBack/contrast testing.

Usability follow-up (1.5.4, 25 October 2026):
- Child record pages show linked parents and selectable phone numbers directly, using the existing child-read permission and endpoint.
- Enlarged text uses a compact horizontally scrollable navigation bar with complete labels and automatic selected-tab visibility; first invalid form fields scroll into view and text inputs receive focus.
- Write and logout confirmations name their action. Password recovery explains Telegram delivery and administrator fallback.
- Reports default to in-app results, with separate PDF/XLSX export actions. Finance lists prioritize payments and debts.
- Imports present template, validation and result-review steps. Commit loads the selected job and requires validated status; website publication first loads a draft review.
- Collection empty states describe access scope and filters; attendance distinguishes an empty roster from completed arrivals.
- Verification: 105 unit/widget tests pass, Dart analysis clean, Android debug APK built. Physical Galaxy S9 checks cover direct parent contacts, 200% text navigation, finance ordering, required-field focus with the keyboard, import steps, in-app reports and publication draft review. Device testing also corrected publication permissions, date-only display, generic child-action labels and raw empty-report output. No live business records were changed; imports, payments and publication were not submitted. Full TalkBack and contrast verification remain outstanding.
