# Development

How to build, run and test EMI Tracker from source. Read [CONTRIBUTING.md](../CONTRIBUTING.md) for the
project rules and [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) for how the code is organised.

## Prerequisites

| Tool | Version used | Needed for |
| --- | --- | --- |
| Git | any recent | cloning |
| Node.js + npm | 22 or newer (developed with 24) | Windows app |
| JDK | 17 or newer (Android Studio's bundled JBR works) | Android app |
| Android SDK | platform 36, build-tools 36 | Android app |
| Android Studio | optional | editing, emulator |

Gradle (9.8.2) is downloaded by the wrapper; there is no need to install it.

```bash
git clone https://github.com/svrsunny/emi-tracker.git
cd emi-tracker
```

The Windows app is developed, tested and packaged on Windows; `npm run dist` targets Windows. The CI
workflow (`.github/workflows/ci.yml`) is set up to run the unit tests on Linux.

## Windows app (`desktop/`)

```bash
cd desktop
npm install          # once: npm packages and the Electron runtime
```

| Task | Command |
| --- | --- |
| Run with live reload | `npm run dev` |
| Build and run | `npm start` |
| Type check | `npm run typecheck` |
| Lint | `npm run lint` |
| Unit and integration tests (Vitest) | `npm test` |
| End-to-end tests on the real app (Playwright) | `npm run test:e2e` |
| Everything above | `npm run verify` |
| Windows installer + portable exe | `npm run dist` → `desktop/release/` |
| Unpacked app folder only | `npm run dist:dir` |
| Regenerate the demo backup | `npm run demo:data` → `demo/emi-tracker-demo-backup.json` |
| Retake the README screenshots | `npm run build` then `npx playwright test --config playwright.screens.config.ts` |

### Use a separate data folder while developing

Never test with your real data. Point the app at a throw-away folder with the
`EMI_TRACKER_DATA_DIR` environment variable; backups then also go into that folder instead of
*Documents*:

```bash
# Git Bash / macOS / Linux
EMI_TRACKER_DATA_DIR=./.devdata npm start
```

```powershell
# PowerShell
$env:EMI_TRACKER_DATA_DIR = "$PWD\.devdata"; npm start
```

The end-to-end tests always use a new temporary folder and Wi-Fi sync port 47931, so they never touch
an installed EMI Tracker (which uses port 47830).

### Building the installer without internet

`electron-builder` checks the Electron download on every build. If you are offline, build with the
Electron already installed by `npm install`:

```bash
npm run build
npx electron-builder --win --x64 --config.electronDist=node_modules/electron/dist
```

## Android app (`android/`)

Open the `android/` folder in Android Studio, or use the Gradle wrapper (`./gradlew` on macOS / Linux /
Git Bash, `gradlew.bat` in Command Prompt or PowerShell):

| Task | Command |
| --- | --- |
| Core engine tests (JVM, fast) | `./gradlew :core:test` |
| App tests (Robolectric: data layer, backup, sync, migrations, UI flow) | `./gradlew :app:testDebugUnitTest` |
| Lint | `./gradlew :app:lintDebug` |
| Debug APK (slow UI, for development) | `./gradlew :app:assembleDebug` |
| Release APK (R8-optimised, use this on phones) | `./gradlew :app:assembleRelease` |
| Install on a connected device / emulator | `adb install -r app/build/outputs/apk/release/app-release.apk` |

Add `--offline` to any Gradle command to build from the local cache without internet.

### Signing Android releases

Without extra setup the release APK is signed with the machine's debug key, which is fine for
personal use. Official releases are signed with the project's release key, which only the maintainer
holds. To sign with your own key, run `android/make-release-key.ps1` on Windows (it asks for a password
and creates both files below), or do it by hand:

1. Create a keystore inside the `android/` folder (keep it and its passwords safe; `*.jks` files are
   git-ignored):
   ```bash
   cd android
   keytool -genkeypair -v -keystore emi-release.jks -keyalg RSA -keysize 4096 -validity 10000 -alias emi
   ```
2. Create `android/keystore.properties` (git-ignored); see
   [`android/keystore.properties.example`](../android/keystore.properties.example):
   ```properties
   storeFile=emi-release.jks
   storePassword=...
   keyAlias=emi
   keyPassword=...
   ```
3. Build with `./gradlew :app:assembleRelease`.

Android only installs an update over an existing app if both are signed with the **same key**.

## Tests that keep the two apps compatible

| What | Where |
| --- | --- |
| Same engine results on both platforms | `desktop/tests/unit/engine.test.ts` ⇄ `android/core/src/test/.../EngineTest.kt` |
| Each app reads the other's backup files | `fixtures/desktop-backup*.json` (written by `crossplatform.test.ts`) and `fixtures/android-snapshot*.json` (written by `SnapshotTest.kt`) |
| Same Wi-Fi sync keys and messages | `fixtures/lan-vector*.json`, used by `lan.test.ts` and `LanTest.kt` |

Running `npm test` and `./gradlew :core:test` rewrites these fixture files from code; commit them when
the format changes intentionally.

## Demo data

See [DEMO_DATA.md](DEMO_DATA.md) for loading the fictional data set and regenerating it.

## Debugging tips

- **Windows:** *Help & Diagnostics* shows the version, data folder, recent events and the number of
  blocked network requests. In development (`npm run dev`) DevTools are available.
- **Android:** `adb logcat -b crash` shows crashes; release builds are obfuscated by R8, so reproduce
  with a debug build for readable stack traces. The app logs no financial data.

## Project conventions

- Financial rules live in the pure modules (`desktop/src/shared/`, `android/core/`); UI code only
  displays their results.
- Every change to data goes through the repository (`repo.ts` / `Repository.kt`) in one transaction,
  with an audit entry.
- New synced tables need: a migration on both platforms, snapshot support (counts, merge, tombstones,
  validation with defaults for old backups), cross-platform fixtures and tests.
- Version numbers: see [RELEASING.md](RELEASING.md).
