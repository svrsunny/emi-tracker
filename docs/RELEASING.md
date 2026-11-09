# Versioning and releases

## Version numbers

EMI Tracker uses [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

- **PATCH:** bug fixes only.
- **MINOR:** new features; data from older versions still opens.
- **MAJOR:** changes that break compatibility (for example a backup format older apps cannot read).

The two apps keep the same MINOR version when they share features. A fix for one platform only bumps
that app's PATCH number (for example Windows 1.4.1 with Android 1.4.2).

Where version numbers live:

| What | File |
| --- | --- |
| Windows app version | `desktop/package.json` → `version` |
| Android app version | `android/app/build.gradle.kts` → `versionName`, and increase `versionCode` by 1 on every release |
| Database schema | `SCHEMA_VERSION` in `desktop/src/main/db.ts` and `android/core/.../Model.kt`, plus the Room `version` in `Database.kt` (all equal) |
| Wi-Fi sync protocol | `LAN_PROTOCOL` in `desktop/src/main/lanProtocol.ts` and `Lan.PROTOCOL` in `android/core/.../Lan.kt` |

## Compatibility rules

- A new synced table or field needs migrations on **both** platforms and must default sensibly when an
  older backup lacks it. Old backups must keep restoring.
- When a release adds data that older versions reject (for example a new bill frequency), say in the
  changelog that **both apps must be updated before syncing**.

## Release checklist

1. All tests pass: `npm run verify` in `desktop/`; `./gradlew :core:test :app:testDebugUnitTest :app:lintDebug`
   in `android/`.
2. Update version numbers (table above) and move *Unreleased* entries in [CHANGELOG.md](../CHANGELOG.md)
   under the new version with the date.
3. Repeat the privacy checks in [SECURITY_AUDIT.md](SECURITY_AUDIT.md#repeating-the-review).
4. Build: `npm run dist` (Windows) and `./gradlew :app:assembleRelease` signed with the project's
   release key (Android).
5. Install both builds over the previous version and check that data is kept.
6. Tag the commit (`vX.Y.Z`) and, if publishing binaries, attach the installer, portable exe and APK to a
   GitHub release together with their SHA-256 checksums.

No binary release has been published yet.
