# Contributing to EMI Tracker

Thank you for helping! Bug reports, ideas, documentation fixes and code are all welcome. Please read
the [Code of Conduct](CODE_OF_CONDUCT.md) first.

## Ground rules

These protect the people who trust the app with their finances. Pull requests that break them
cannot be merged:

1. **Offline and private.** No internet access, accounts, telemetry, analytics, ads, crash
   reporting or update checks. The only network traffic allowed is the existing Wi-Fi sync with a
   paired device on the home network.
2. **No personal data in the repository.** Never commit real loan, bank or payment details,
   databases, backups, screenshots of your own data, or keystores. Use the
   [demo data](docs/DEMO_DATA.md) for testing and screenshots.
3. **Both platforms stay compatible.** The Windows and Android apps share one data format and one
   set of financial rules. A change to calculations, validation or the backup/sync format must be made
   in both `desktop/src/shared/` and `android/core/`, with tests on both sides.
4. **Never log financial data.** Logs may describe events, never amounts, names or account numbers.
5. **Money is exact.** Use the existing decimal helpers (`money.ts` / `Money.kt`), never floating
   point, for amounts.

## Reporting a bug

Open an issue with the **Bug report** template. Include the app (Windows / Android), its version,
what you did, what you expected and what happened. If you can, reproduce it with the demo data and
attach screenshots of that, not of your real data.

Security problems: please follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Suggesting a feature

Open an issue with the **Feature request** template and describe the problem you want solved.
Check [docs/FAQ.md](docs/FAQ.md#known-limitations) first: some limitations are deliberate.

## Making a change

1. **Fork** the repository on GitHub and **clone** your fork:
   ```bash
   git clone https://github.com/<your-username>/emi-tracker.git
   cd emi-tracker
   ```
2. **Create a branch** named after the change:
   ```bash
   git checkout -b fix/calendar-month-total
   ```
3. Set up and build as described in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
4. Make the change. Keep it focused: one fix or feature per pull request.
5. **Add or update tests** (see below) and run the checks for every part you touched:
   ```bash
   # Windows app
   cd desktop
   npm run typecheck
   npm run lint
   npm test
   npm run test:e2e
   # Android app
   cd android
   ./gradlew :core:test :app:testDebugUnitTest :app:lintDebug
   ```
6. Update the documentation in `docs/` if behaviour changes, and add a line under
   *Unreleased* in [CHANGELOG.md](CHANGELOG.md).
7. **Commit** with a clear message, for example `fix: count one-time expenses in the calendar total`
   (the [Conventional Commits](https://www.conventionalcommits.org/) style is preferred).
8. **Push** to your fork and **open a pull request** against `main`. Fill in the template.

## Tests that are expected

| You changed | Add tests in |
| --- | --- |
| Financial calculations | `desktop/tests/unit/engine.test.ts` **and** `android/core/src/test/.../EngineTest.kt` (same cases, same expected values) |
| Bills, expenses, lending, calendar totals | `desktop/tests/unit/bills.test.ts` / `debts.test.ts` **and** `BillsTest.kt` / `DebtsTest.kt` |
| Backup / sync format | `desktop/tests/unit/crossplatform.test.ts` and `SnapshotTest.kt` (each app must read the other's files in `fixtures/`) |
| Wi-Fi sync protocol | `desktop/tests/unit/lan.test.ts` and `LanTest.kt` (shared vectors in `fixtures/lan-vector*.json`) |
| Database schema | a migration on both platforms, plus a migration test (`storage.test.ts`, `DataLayerTest.kt`) |
| Windows UI flows | `desktop/tests/e2e/app.spec.ts` |
| Android UI flows | `android/app/src/test/.../AppFlowTest.kt` |

## Code style

- Follow the style of the surrounding code; the linters (`npm run lint`, `./gradlew :app:lintDebug`)
  must pass.
- TypeScript is strict; validate anything that crosses the IPC boundary with the zod schemas in
  `validation.ts`.
- User-facing text is plain English and short. Amounts are shown in the user's chosen currency
  format.

## Licensing of contributions

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE) of
this project.
