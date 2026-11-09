# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/)
and versions follow [Semantic Versioning](https://semver.org/) (see [docs/RELEASING.md](docs/RELEASING.md)).

The Windows and Android apps are built separately; entries say which app a change applies to when
it is not both. Downloads are on the [Releases](https://github.com/svrsunny/emi-tracker/releases) page.

## [Unreleased]

## [1.5.0] — 2026-11-09

First release with ready-made downloads: a Windows installer, a portable Windows app and an Android
APK. Both apps now share the same version number.

### Changed
- The Android APK is signed with the project's release key. An APK you built yourself earlier
  cannot be updated in place by it: back up, uninstall, install 1.5.0, then restore.

### Added
- Open-source documentation: README, features, installation, user guide, sync guide, technical
  architecture, development, FAQ, troubleshooting, privacy, security policy and security review.
- Fictional demo data set (`demo/emi-tracker-demo-backup.json`, `npm run demo:data`) and genuine
  screenshots of both apps taken with it (`assets/screenshots/`).
- MIT license and third-party notices; issue and pull request templates; CI workflow.

## [1.4.2] Android — 2026-11-07

### Fixed
- File and folder pickers (Back up now, Encrypted backup, Choose folder, Restore, exports) open
  reliably.
- Returning from a file or folder picker no longer re-locks the app (within 10 minutes).
- Encrypted backups are saved with the `.emibackup` extension.

## [1.4.1] — 2026-11-05

### Added
- Calendar shows recurring bills and one-time expenses on their due days, the total actually spent on
  each day, and the month's spending by kind (loan EMIs, chits, bills, one-time).

### Changed
- Lending & Borrowing: the totals at the top follow the selected filter (open, lent, borrowed,
  settled, all), including a "Total settled" figure.
- "EMI Calendar" is now called "Calendar".

## [1.4.0] — 2026-11-04

### Added
- One-time expenses (in Bills), optionally recorded as already paid in the same step.
- Lending & Borrowing: money lent to and borrowed from people, with part repayments, return-by
  reminders and totals. Not counted as an expense.
- Database schema v4 (lending tables) with migrations on both platforms.

### Fixed
- Correcting the date of a paid one-time expense keeps its payment.

## [1.3.2] Windows — 2026-11-03

### Fixed
- Wi-Fi sync works when bill reminders have been sent.

## [1.3.1] — 2026-11-03

### Added
- *Sync now* on both dashboards and in the Wi-Fi sync settings; the PC's button asks an open phone app
  to sync within a few seconds.

### Fixed
- Windows: app PIN and password locks work independently of Windows Hello; the Windows Hello prompt
  opens in front of the app.

## [1.3.0] — 2026-11-03

### Added
- Recurring bills with reminders; Monthly expenses (loans, chits and bills together); a "This month"
  summary on the dashboard.
- App lock: app PIN or password, Windows Hello on Windows, fingerprint / face / screen lock on
  Android; auto-lock after a chosen time.

## [1.2.0] — 2026-11-02

### Added
- Chit funds as a loan type: no interest, installments paid below the full amount count as dividend.

## [1.1.0] — 2026-10-28

### Added
- Wi-Fi sync between a paired phone and the PC on the same home network (encrypted, paired with a
  6-digit code).
- Your own reminders without a loan, and a Reminders step in the loan wizard.

### Changed
- Cleaner PDF reports on both platforms; smoother scrolling on Android.

## [1.0.0] — 2026-10-28

### Added
- First version of the Windows and Android apps: loans and payments, amortization engine,
  dashboard, heatmaps, forecasts, reminders, reports, verified (optionally encrypted) backups,
  folder sync and CSV/JSON export.

[Unreleased]: https://github.com/svrsunny/emi-tracker/compare/v1.5.0...main
[1.5.0]: https://github.com/svrsunny/emi-tracker/releases/tag/v1.5.0
