# Alishax Kids mobile

Flutter companion for the existing NestJS API, with Android and iOS projects.
This is an initial functional staff release, not full parity with the web app.
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
| Accounts | Login, rotating refresh session, password recovery via existing Telegram reset flow, language selection, logout |
| Access | Bootstrap-driven permissions and groups; independent action permissions; authorization changes reset private navigation |
| Today | Personal greeting and permitted shortcuts, including staff who lack dashboard permission |
| Attendance | Server roster, name/group/status filters, check-in, absence reasons, current-day status, refresh |
| Pickup | Select standing or temporary permission, verify, confirm identity, checkout with server revalidation |
| Children | Search, pagination, profile, linked guardians, document metadata, private photos and charge history |
| Registration | Create an applicant with branch/name/birth date; clearly identified as incomplete enrollment |
| Medical | View record/allergies/medications; edit blood type, chronic conditions, emergency instructions and note without replacing allergy/medication arrays |
| Payments | Select child, exact som-to-tiyin conversion, review, submit; securely persist uncertain operations for manual retry after restart |
| Finance | Paginated payment/charge/debt/expense cards and reversal presentation |
| Other tools | Read-only groups, guardians, announcements, notification log, users, roles and audit records |

Navigation derives from permission keys, not role names. Owner, director,
accountant, administrator, reception, teacher, nurse and custom roles can use the
same app with the backend's assigned scopes. Some business tasks remain on the web.

**Not implemented:** parent login and own-child authorization; full enrollment
(guardian linking, group/tariff assignment, activation); billing preview/commit;
payment cancellation/refunds; role editing; imports, report exports, website
editing; document upload/download and receipt sharing; announcement publication;
medication administration; native push, biometric app lock and offline attendance.
Advanced filters are not at web parity. The announcement list is a management
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

Version 1.0.1 fixes login against older deployments that do not expose
`/auth/bootstrap`: only a 404 triggers fallback to `/auth/me`. Branch/group
lookups are requested only with the corresponding permissions. Profile-loading
failures are distinguished from invalid credentials. The fallback does not add
other missing backend endpoints or broaden authorization.

Access tokens stay in memory. The `kg_refresh` cookie is stored in platform
secure storage and sent only to auth endpoints. Concurrent expired requests share
one refresh; stale responses cannot restore a signed-out session. The API host is
a build parameter and credentialed redirects are not followed.

Private records are not persisted offline. Authorized photos remain in memory.
The intentional exception is an uncertain payment: the exact payload and request
key are encrypted and keyed to API environment and user. It remains after logout
so the same staff member can resolve a lost response on next login. Confirmed
success deletes it. Validation rejection unlocks editing; transport/server errors
retain the original immutable request. No automatic network retry creates a new
financial operation.

The server assigns attendance times and enforces pickup/financial rules.
Display dates use Asia/Tashkent; money uses BigInt, never floating-point arithmetic.

## Verification

Local verification on 17 September 2026: Android debug APK built, 17 unit/widget
tests passed, and login/Today/attendance preview images rendered and inspected.
No authenticated production operations, physical-device tests, or iOS builds
were performed. The macOS CI job has not been run from this workspace.

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

Outputs are `build/previews/login.png`, `today.png`, `attendance.png`. The font
is read only by the tool and is not redistributed in the app.

Before rollout, test attendance/pickup/payment against staging with each staff
role, verify privacy and background/resume on physical Android/iOS devices, and
run the macOS build job.
