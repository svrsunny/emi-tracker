# Testing

All results below were produced by actually running the suites on Windows 11 (Node 24, Electron
45.1, JDK 25 from Android Studio, Gradle 9.8.2, AGP 9.4.1) on 28 Oct 2026.

## Summary

| Suite | Command | Result |
| --- | --- | --- |
| Desktop type check | `cd desktop && npm run typecheck` | ✅ no errors |
| Desktop lint | `npm run lint` | ✅ no errors or warnings |
| Desktop unit + integration (Vitest) | `npm test` | ✅ **92 / 92** passed (5 files) |
| Desktop end-to-end (Playwright, real Electron app + packaged exe) | `npm run test:e2e` (after `npm run dist`) | ✅ **9 / 9** passed |
| Desktop installer | `npm run dist` | ✅ `release/EMI Tracker-Setup-1.0.0.exe` + portable exe |
| Android core engine (JUnit, JVM) | `cd android && ./gradlew :core:test` | ✅ **45 / 45** passed |
| Android app (Robolectric: data, backup, sync, migration, worker, Compose UI flow) | `./gradlew :app:testDebugUnitTest` | ✅ **11 / 11** passed |
| Android lint | `./gradlew :app:lintDebug` | ✅ 0 errors, 16 warnings (style; see below) |
| Android debug APK | `./gradlew :app:assembleDebug` | ✅ `app/build/outputs/apk/debug/app-debug.apk` (21.7 MB) |
| APK permission audit | `adb shell dumpsys package com.emitracker.app` | ✅ `INTERNET` only for Wi-Fi sync (home network only, see *Offline* below) |

## What is covered

### Financial engine (identical cases on both platforms)
`desktop/tests/unit/engine.test.ts`, `android/core/src/test/.../EngineTest.kt`

- EMI formula against known examples (8,884.88; 13,215.07; 43,391.16 with all three rounding
  modes; zero rate; flat rate)
- Full contract schedule: principal sums to the loan, per-row identities
  (opening − principal = closing, interest + principal = EMI), total interest, final-row
  adjustment, remaining-installment counter
- Month-end and leap-year due dates (31 → 29 Feb / 30 Apr; non-leap 28 Feb), quarterly and
  weekly frequencies, leap day counted in daily-reducing interest
- On-time payments and the invariants: total paid = principal + interest + fees + unapplied;
  principal repaid + outstanding = principal; projected principal = outstanding
- Past due is never assumed paid; due today, grace period; partial payments and arrears;
  missed marker then late payment; late fee and penal-interest estimates; advance payments
  (prepaid); excess becomes extra principal; waiver; reversed payments ignored; manual lender
  allocation
- Prepayment reducing tenure (months and interest saved) or reducing EMI; foreclosure closes
  the loan and cancels later rows; closure is amortized, not balance ÷ EMI
- Variable rates: keep-EMI extends tenure, recompute-EMI keeps tenure, mid-period rate change
  split pro rata; EMI change; restructuring
- Moratorium (capitalised and interest-only), installments paid before tracking (estimates),
  opening-outstanding override, unrecorded history flagged, not inferred; lender reconciliation;
  non-converging EMI; long arrears still converge and reconcile future outflow

### Aggregation, heatmaps, forecasts, reminders
`aggregate.test.ts`, `reminders.test.ts`, `PortfolioTest.kt`

- Dashboard totals equal the sum of per-loan summaries and the recorded payments; outstanding
  versus future outflow distinction; next EMI, due windows, closure, loan filter
- Daily heatmap totals equal payment history; *no data* versus zero; calendar states; monthly
  installments and completion %, overdue counts; intensity thresholds; series and annual / FY totals
- Scenarios: baseline unchanged; EMI increase; extra monthly; one-time and annual prepayment;
  rate increase costs interest; combined beats single; simulated records never persisted
- Reminders: offsets and time, due, overdue repeats with interval and maximum, dedupe, snooze
  expiry, recalculation after payment, catch-up and late flag, catch-up window, quiet hours
  across midnight, weekdays, disabled categories, per-loan opt-out, backup reminder, month-end
  custom repeats

### Storage, backup, restore, sync, migrations, validation
`storage.test.ts` (desktop), `SnapshotTest.kt` + `DataLayerTest.kt` (Android)

- Schema created with foreign keys; **v1 → v2 migration** on a real v1 database keeps data
  (both platforms; Android DDL checked against Room's exported schema); atomic persistence and
  reload; rollback of a failed transaction
- Validation of loans and payments (negative amounts, impossible dates, first EMI before start,
  allocation exceeding amount, missing installment, unknown loan); duplicate prevention with
  explicit override; reversal with audit trail (no deletion); permanent delete requires the exact
  name and leaves tombstones; audit summaries contain field names, not values
- **Backup → restore into a clean database**: identical record counts, preferences, reminders
  and identical computed balances; encrypted backups (no plaintext, wrong passphrase rejected);
  rejection of truncated, tampered (checksum), foreign and future-version files; failed restore
  leaves data untouched; automatic-backup pruning only touches automatic files
- **Sync** between two devices through a folder: additions, last-writer-wins edits, deletions
  propagate, idempotent and commutative merge, encrypted sync files
- **Cross-platform**: Android parses and decrypts the desktop backup, recomputes identical
  outstanding, total paid, interest paid, remaining interest, closure and installments paid, and
  re-encodes it to the same checksum (model parity). The desktop verifies the snapshot written by
  Android (checksum, decryption, schema, identical engine results). Android restores the desktop
  backup into Room.
- Canonical JSON escaping matches JavaScript; CSV round-trip and formula-injection guard

### End-to-end and UI
- **Desktop (Playwright + Electron)**, `tests/e2e/app.spec.ts`: create a loan through the
  wizard → record a payment → duplicate warning → loan detail and amortization → heatmap
  (daily, monthly, calendar) and cell details → reminder settings and test notification → back up,
  modify, restore with typed confirmation, verify the change is gone → all pages in light theme →
  **no external network request** and zero blocked requests.
- **Android (Robolectric + Compose)**, `AppFlowTest.kt`: onboarding → wizard (6 steps) → loan
  appears on the dashboard → record the first EMI from the schedule (advance) → heatmap shows
  activity → reminder settings changed and saved. A second test checks the privacy onboarding. The
  restore UI uses the system file picker (not automatable in Robolectric); the restore pipeline is
  covered by `DataLayerTest`.
- **Android worker** (`DataLayerTest.workerDeliversRemindersOnceAndRespectsPermission`):
  without notification permission → inbox only; no duplicate on re-run; with permission →
  Android notification; editing a loan that has payments works; a paid installment produces no
  further reminders.

### Packaged and on-device checks
- **Packaged Windows app** (`tests/e2e/packaged.spec.ts`, run against `release/win-unpacked/EMI Tracker.exe`):
  starts, loads demo data, writes `emi-tracker.sqlite` into its data folder, reopens with the
  data intact after a restart, the integrity check passes, and there are 0 external requests. ✅ passed.
- **Android emulator** (Pixel 6 image, Android 14, `adb install` of `app-debug.apk`): onboarding
  rendered; the real `POST_NOTIFICATIONS` system dialog was shown and granted; demo data loaded; the
  WorkManager job posted a real Android notification for the overdue demo EMI with *Snooze* and
  *Dismiss* actions; dashboard, loans list (1 overdue) and heatmap verified from screenshots, with
  no crash in logcat. This exposed two UI fixes (status-bar icon contrast, current rate on loan
  cards), now applied.

## Offline verification

- Desktop: the Playwright suite records all requests and asserts none are external; diagnostics
  report 0 blocked requests for a full session. CSP forbids remote scripts, styles and connections.
- Android: `aapt2 dump permissions app-debug.apk` →
  `POST_NOTIFICATIONS`, `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED`, and the AndroidX-internal
  `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`. **No `INTERNET`.** A source scan for
  `HttpURLConnection|OkHttp|Socket|URL(|Retrofit|ktor|WebView` in `app/src/main` and
  `core/src/main` finds nothing.

## Bugs found by the tests and fixed

- Room `@Insert(REPLACE)` deletes and re-inserts the row, so editing a loan that already had
  payments violated `ON DELETE RESTRICT`. Fixed by switching to `@Upsert`.
- Database work dispatched on the main thread from several UI actions. All moved to IO.
- The bottom navigation bar disappeared on the Heatmaps tab (route with optional argument).
- Validation used value-transforming `.trim()`, so a reminder title with a trailing newline
  changed on restore and failed the post-restore checksum. Validators no longer transform values,
  and checksums are verified on the raw file data.
- Future cash outflow double-counted overdue amounts; non-convergence was flagged too early when
  long arrears existed.
- An adjustment effective on a due date applied to that period; it now applies from the next.

## Lint warnings (Android, non-blocking)

`OldTargetApi` and `GradleDependency` (API 37 exists, but the machine has platform 36 installed
and Compose 1.12 needs 37), `UseKtx` style suggestions, `ModifierParameter` ordering, one unused
resource and one obsolete SDK check.

## How to run everything

```bash
cd desktop && npm install && npm run verify
```

```bash
cd android && ./gradlew :core:test :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

## Version 1.1.0 run (28 Oct 2026)

| Check | Command | Result |
| --- | --- | --- |
| Desktop type check, lint | `npm run typecheck`, `npm run lint` | ✅ clean |
| Desktop unit tests | `npm test` | ✅ 101 passed (new: Wi-Fi protocol, cross-platform vectors, print document) |
| Desktop end-to-end | `npx playwright test` | ✅ 12 passed: wizard Reminders step, standalone reminder, 3 PDF reports, Wi-Fi pairing (wrong code and wrong key refused) and sync, installed app, no external requests |
| Android core tests | `./gradlew :core:test` | ✅ 49 passed (new `LanTest`: desktop vector reproduced, RFC 5869 HKDF, addresses) |
| Android app tests | `./gradlew :app:testDebugUnitTest` | ✅ 11 passed (UI flow covers the Reminders step and *My reminders*) |
| Android lint | `./gradlew :app:lintDebug` | ✅ 0 errors (expected warning: cleartext base config for Wi-Fi sync) |
| Real devices together | release APK on an emulator ↔ desktop app | ✅ paired with the code, PC → phone (+110 records), phone → PC (a new reminder), in-place update kept data |
| PDFs rendered and inspected | desktop and Android summary and schedule PDFs rendered to images | ✅ white pages, nothing cut off, header on every page, page x of y |
| Scrolling (emulator, software GPU) | `dumpsys gfxinfo` while flinging Payment history | release build: 190 frames, median 46 ms; debug build: 46 frames, median 65 ms |

Not verified: a physical phone, a physical second PC on real Wi-Fi (the emulator reaches the PC
through its virtual network), and reminder delivery over several days.

## Version 1.2.0: chit funds (2 Nov 2026)

| Check | Result |
| --- | --- |
| Desktop unit tests (`npm test`) | ✅ 106 passed, incl. 5 chit tests (no interest, dividends settle the month, outstanding, overdue, other loans unchanged) |
| Desktop end-to-end (`npx playwright test`) | ✅ 13 passed, incl. adding a chit through the wizard (no interest field, 20 months suggested) and recording ₹4,600 → ₹400 dividend |
| Android core (`./gradlew :core:test`) | ✅ 54 passed, incl. `ChitTest` (same expectations) and the shared fixture chit `K1` reproduced from the desktop backup |
| Android app (`./gradlew :app:testDebugUnitTest`) | ✅ 11 passed (restores the 3-loan desktop backup incl. the chit) |
| Emulator, release APK 1.2.0 | ✅ updated in place over 1.1.0 keeping data; chit wizard shows only chit value, installment, months and first installment date |

The desktop e2e Wi-Fi test now uses port 47931, so it never collides with a real EMI Tracker
syncing on the same PC (default port 47830).

## Version 1.3.0: bills, monthly expenses, app lock (3 Nov 2026)

| Check | Result |
| --- | --- |
| Desktop unit tests | ✅ 113 passed, incl. `bills.test.ts`: due dates (month-end, quarterly, yearly, end date), next due, monthly expenses totals (loans + chits + bills, future months), bill reminders, merge with tombstones, storage incl. re-syncing a bill that has payments |
| Desktop end-to-end | ✅ 15 passed, incl. adding a bill and marking it paid, Monthly expenses, and the app lock (set PIN, lock, data requests refused while locked, wrong PIN refused, unlock, turn off) |
| Android core | ✅ 60 passed, incl. `BillsTest` with the same expectations as the desktop tests |
| Android app | ✅ 13 passed: bills storage / sync / delete, Room migration v1 → v3, PIN lock with throttling, UI flow through Expenses and Bills |
| Android lint | ✅ 0 errors |
| Emulator, release APK 1.3.0 | ✅ updated in place from 1.0.0 keeping data; added a bill, marked it paid, Monthly expenses totals; set a PIN, lock now, wrong PIN refused, right PIN unlocks, re-locks after a minute in the background; screenshots blocked while the lock is on |

Not verified: Windows Hello and fingerprint prompts (need a person), a physical phone.

## Version 1.3.1: PC app lock fix, Sync now (3 Nov 2026)

| Check | Result |
| --- | --- |
| Desktop unit tests | ✅ 113 passed |
| Desktop end-to-end | ✅ 15 passed, incl. switching a PIN lock to a password (refused without the current PIN, no Windows Hello prompt), unlocking with the password, turning it off; *Sync now* on the dashboard → `/hello` reports `syncRequested` → the phone syncs → the PC confirms and the flag clears |
| Windows Hello prompt | ✅ window-attached prompt (`IUserConsentVerifierInterop`) builds and opens the Windows Security dialog; PowerShell script parses cleanly. Not verified: completing it (needs a person) |
| Android core / app | ✅ core tests and 13 app tests passed; lint 0 errors |
| Not verified | the phone picking up the PC's *Sync now* on a real phone (the request / reply is covered by the desktop end-to-end test with a simulated phone) |

## Version 1.3.2: Wi-Fi sync with bill reminders (3 Nov 2026)

| Check | Result |
| --- | --- |
| Desktop unit tests | ✅ 113 passed, incl. a sent bill reminder passing backup / sync validation (`bills.test.ts`) |

## Version 1.4.0: one-time expenses, lending & borrowing (4 Nov 2026)

| Check | Result |
| --- | --- |
| Desktop unit tests | ✅ 120 passed, incl. `debts.test.ts`: one-time due date and monthly expenses, a corrected date keeping its payment, pending / status / totals, reminders before / on / after the return date and none once settled, merge with tombstones and old backups, storage refusing more than is pending, upsert on sync, delete with tombstones |
| Cross-platform fixtures | ✅ each app reads the other's file with a one-time expense, a lent and a borrowed entry, a part repayment, a deleted entry's tombstone and a sent `debt` reminder (`crossplatform.test.ts`, `SnapshotTest`) |
| Desktop end-to-end | ✅ 17 passed, incl. a one-time expense recorded as paid and shown in Monthly expenses; lending, a refused over-repayment, a part repayment, borrowing, totals, and nothing in Monthly expenses |
| Android core | ✅ 65 passed, incl. `DebtsTest` with the desktop expectations |
| Android app | ✅ 15 passed: a corrected one-time date keeping its payment, storage, sync merge and delete for lending, migration v1 → v4 (Room schema matches `MIGRATION_3_4`), UI flow adding a one-time expense (saved as paid) and a lending entry |
| Android lint | ✅ 0 errors; release APK 1.4.0 built (3.3 MB) |
| Not verified | the phone's repayment dialog ("Got money back" / "Paid back") on a device. Robolectric never goes idle with any AlertDialog open: opening the bill payment dialog (in use since 1.3.0) in the same test hangs identically, so it is a test-harness limit, not a lending bug. Repayment storage is tested. (Checked on the emulator in 1.4.2.) |

## Version 1.4.1: calendar with bills and daily spending, lending totals per filter (5 Nov 2026)

| Check | Result |
| --- | --- |
| Desktop unit tests | ✅ 121 passed, incl. spending by day (loan, chit, bill and one-time payments on the day they were paid; reversed payments and lending excluded; one-loan filter) and lending totals for open / settled / all entries |
| Desktop end-to-end | ✅ 17 passed, incl. the calendar showing a paid bill and "Spent" on its day, and the Lending page cards switching with the filter (Lent → "Got back so far", Settled → "Total settled") |
| Android core / app | ✅ 66 / 15 passed (same spending and lending-total expectations in `DebtsTest`); lint 0 errors |
| Not verified | the phone calendar and lending cards on a device (compiled and unit-tested only) |

## Version 1.4.2 (Android): file and folder pickers (7 Nov 2026)

| Check | Result |
| --- | --- |
| Regression test | ✅ `AppFlowTest.filePickersOpenFromTheActivity` launches the folder, create-file and open-file pickers from `MainActivity` |
| Android core / app / lint | ✅ 66 / 16 passed, 0 lint errors |
| Emulator, release APK (Android 14) | ✅ no crash anywhere: Back up now (saved, status "Today"); Encrypted backup (saved as `.emibackup`); automatic-backup Choose folder (Documents, permission granted); Restore (plain backup replaced 6 demo loans with 0, recovery copy kept; encrypted: wrong passphrase refused, right one validates); folder sync Choose folder + Sync now (sync file written); exports (Full JSON, Loans CSV, report PDF and CSV); app PIN lock set to "as soon as you leave": no lock after a picker, locks after Home, wrong PIN refused, right PIN unlocks; every tab and More screen opened; lending repayment dialog (part payment, then settled; Settled shows "Total settled ₹10,000"); bill Mark paid dialog; 1.4.2 installed over 1.4.1 keeping data |
| Not verified | fingerprint / phone screen lock prompt (the emulator has no screen lock or enrolled fingerprint); Wi-Fi sync with the PC (no PC on the emulator's network) |
