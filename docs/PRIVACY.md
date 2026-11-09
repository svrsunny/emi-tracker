# Privacy and data handling

EMI Tracker keeps your financial data on your own devices. It never uses the internet, an
account, a server or a cloud service. The only network traffic is optional **Wi-Fi sync** between
your own phone and PC inside your home network, encrypted end to end with a key agreed when you
pair them.

## Where your data goes

| Data | Stays / goes | When |
| --- | --- | --- |
| Your records (loans, payments, bills, lending, reminders, settings) | Windows: `%APPDATA%\EMI Tracker\emi-tracker.sqlite`. Android: app-private Room database | Always |
| Recovery copies | `%APPDATA%\EMI Tracker\recovery-backups` (Windows) or app-private storage (Android) | Before a restore, a schema upgrade or a permanent delete |
ecovery-backups` (Windows) or app-private storage (Android) | Before a restore, a schema upgrade or a permanent delete |
| Backups | A file or folder **you** choose (Windows default for automatic backups: `Documents\EMI Tracker Backups`) | When you back up, or automatically if you turn it on |
| Folder-sync files | `emi-tracker-sync-<device>.json` in a folder **you** choose | When folder sync runs |
| Wi-Fi sync | Directly between your paired phone and PC on the local network, encrypted | When the phone syncs |
| Exports and reports | Files you save (CSV, JSON, PDF) | When you export |
| Receipt attachments (Windows) | Copied into `%APPDATA%\EMI Tracker\attachments` | When you attach a file |

Nothing is sent anywhere else. If you choose a folder that a cloud service mirrors (for example a
OneDrive or Google Drive folder), that service, not EMI Tracker, uploads the files: use encrypted
backups and encrypted sync files in that case.

## Guarantees

| | Desktop (Windows) | Android |
| --- | --- | --- |
| Network | Every outbound request from the app's web contents is **blocked and counted** (`session.webRequest`); the count is shown in *Help → Diagnostics*. When you turn on Wi-Fi sync, the main process listens for paired phones and **refuses connections from outside the local network** (private IPv4, link-local, loopback, IPv6 unique-local). It never connects out | `INTERNET` is declared **only for Wi-Fi sync** (Android needs it for any socket). Before connecting, the app resolves the PC address you entered and **refuses anything that is not a home-network address**. `ACCESS_NETWORK_STATE` and `FOREGROUND_SERVICE` are stripped |
| Remote content | None. Fonts (Inter, JetBrains Mono), icons (lucide) and charts (Recharts) are bundled. CSP: `default-src 'none'; script-src 'self'; connect-src 'none'` | None. Inter is bundled as TTF; Material icons are compiled into the APK |
| Telemetry / analytics / ads / crash reporting | None | None |
| Accounts / login | None | None |
| Update checks | None. Updates are installed manually | None |
| Platform cloud backup | n/a | Disabled (`allowBackup=false`, `dataExtractionRules` exclude everything) |
| Storage | SQLite (sql.js) at `%APPDATA%\EMI Tracker\emi-tracker.sqlite` | Room/SQLite in app-private storage |
| Logs | Event descriptions only, in memory, never amounts, names or account numbers | No logging of financial data |

## Electron hardening (desktop)

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`.
- A preload bridge exposes only a whitelist of IPC channels. Every payload is validated with zod
  in the main process, and the sender must be the app's own page.
- No `webview`, no new windows, navigation away from the app is prevented, and all permission
  requests (camera, geolocation, …) are denied.
- File access is limited to paths you pick in native dialogs plus the app's own data folder.
  Attachments are copied into the app folder.
- The sync passphrase and Wi-Fi pairing keys are protected with Windows DPAPI (`safeStorage`). Backup passphrases are never stored.

## App lock

- Optional, per device, never synced. PC: app PIN (4–12 digits), app password, and/or Windows Hello
  (fingerprint, face or Windows PIN, via Windows' own consent prompt). Android: the phone's screen lock
  with fingerprint / face, an app PIN or an app password (optionally with fingerprint / face).
- PIN and password are stored only as a salted hash (scrypt on the PC, PBKDF2-SHA256 on Android).
  After 5 wrong attempts you must wait 30 seconds, doubling up to 15 minutes.
- While locked the PC's main process refuses every data request and the window shows only the unlock
  screen; on Android the app shows only the unlock screen and, with the lock on, its content is hidden
  from the recent-apps screen and screenshots (`FLAG_SECURE`).
- Locks when the app starts, after it has been hidden / in the background for the chosen time, and on
  the PC also after that much idle time, when Windows locks and when the PC sleeps.
- Forgotten PIN: Windows Hello on the PC, or the phone's own screen lock on Android, also unlocks.
- Changing or turning off a PIN / password lock asks for the current PIN / password (Windows Hello
  only if you choose "Forgot it?"); changing a Windows Hello lock asks Windows Hello. On the PC the
  Windows Hello prompt is attached to the EMI Tracker window, so it opens in front of the app and
  offers every sign-in Windows has set up (fingerprint and face need that hardware; otherwise only
  the Windows PIN). It never opens while the window is hidden in the tray.
- The lock guards the app's screens. It does not encrypt the database file; Windows account security
  and Android's device encryption protect data at rest. Use encrypted backups for copies you move.

## Wi-Fi sync security

- Pairing needs the 6-digit code shown on the PC (valid 5 minutes, at most 5 wrong attempts).
  Phone and PC run an ECDH (P-256) key agreement bound to the code; each side proves it derived the
  same key. Someone only listening on the Wi-Fi cannot compute the key.
- Every snapshot travels AES-256-GCM encrypted with that key, tied to the device and direction,
  inside plain HTTP on the local network (Android's `network_security_config` allows cleartext for
  this reason; the payload itself is always encrypted).
- The phone keeps the key encrypted by the Android Keystore; the PC keeps it encrypted with DPAPI.
  *Unpair* on the phone or *Remove* on the PC revokes it.
- Limitation: someone actively intercepting traffic on your Wi-Fi during the 5-minute pairing
  window could try to guess the code. Pair on your own home network. All known limitations are listed
  in [SECURITY_AUDIT.md](SECURITY_AUDIT.md#known-limitations).

## Verification performed

- **Desktop**: the Playwright end-to-end suite records every request made by the app window and
  asserts there are no `http(s)`/`ws(s)` requests, and that the main process blocked zero
  requests during a full session (create loan, payments, heatmaps, reminders, backup and restore).
- **Android**: the installed release APK requests `POST_NOTIFICATIONS`, `INTERNET` (Wi-Fi sync
  only), and `RECEIVE_BOOT_COMPLETED` / `WAKE_LOCK` for WorkManager (`dumpsys package`). The only
  network client in the sources is `io/LanSync.kt`, which connects only after the home-network check.
  *Help → Diagnostics* shows the declared permissions on the device.
- **Wi-Fi sync**: a desktop end-to-end test pairs a test phone over HTTP, checks that a wrong code
  and a wrong key are refused, and exchanges data. Shared test vectors prove the Kotlin and
  TypeScript implementations derive the same key and open each other's messages. A real pairing
  and sync between the Android app (emulator) and the Windows app was performed on 28 Oct 2026.
- See `docs/TESTING.md` for the exact commands and results.

## Installation-time downloads (development only)

Building from source downloads dependencies once: npm packages and the Electron runtime
(desktop); Gradle, the Android Gradle Plugin and AndroidX libraries (Android). The installer and the
APK contain everything they need and never download anything at runtime.

## Sensitive data handling

- Loan account references can be masked (last four digits shown).
- Audit entries record which fields changed, not their values, in the summary text. The before
  and after JSON is kept locally for your own review and goes into backups.
- CSV exports guard against spreadsheet formula injection.
- Exports and unencrypted backups are plain files: keep them somewhere private or use encrypted
  backups.
