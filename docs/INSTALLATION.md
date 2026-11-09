# Installation

EMI Tracker has two apps: one for **Windows** and one for **Android**. You can use either on its own or
both together (see the [Sync guide](SYNC_GUIDE.md)).

Download the files from the **[Releases page](https://github.com/svrsunny/emi-tracker/releases/latest)**, or build them yourself from the source code
(below). Only download EMI Tracker from this repository's Releases page.

- [Download and verify](#download-and-verify) · [Requirements](#requirements)
- [Windows](#windows): [build](#build-the-windows-installer) · [install](#install-on-windows) · [first start](#first-start-on-windows)
- [Android](#android): [build](#build-the-android-apk) · [install](#install-on-android) · [permissions](#android-permissions) · [first start](#first-start-on-android)
- [Updating](#updating) · [Uninstalling](#uninstalling)

## Download and verify

| File | For |
| --- | --- |
| `EMI-Tracker-Setup-<version>.exe` | Windows installer (recommended) |
| `EMI-Tracker-Portable-<version>.exe` | Windows, a single file that runs without installing |
| `EMI-Tracker-<version>.apk` | Android |
| `SHA256SUMS.txt` | SHA-256 checksums of the files above |

To check that a download is complete and unchanged, compare its checksum with the line in
`SHA256SUMS.txt`:

```powershell
# Windows PowerShell
Get-FileHash .\EMI-Tracker-Setup-1.5.0.exe -Algorithm SHA256
```

```bash
# macOS / Linux / Git Bash
sha256sum EMI-Tracker-1.5.0.apk
```

The Android APK is signed with the project's release key (certificate `CN=EMI Tracker`). Its
SHA-256 certificate fingerprint is
`a2:bc:a9:3e:cf:ff:71:d4:8b:56:a0:c9:5d:a7:71:d6:d2:28:5b:e0:a5:16:ee:03:ef:46:bf:0a:ce:df:49:d1`.

With a downloaded file, skip the *Build* steps below and go straight to *Install*.

## Requirements

| | Windows app | Android app |
| --- | --- | --- |
| To **use** | Windows 10 or 11, 64-bit | Android 8.0 or newer |
| To **build** | [Node.js](https://nodejs.org/) 22 or newer (with npm) and [Git](https://git-scm.com/) | JDK 17 or newer and the Android SDK (platform 36, build-tools 36). Installing [Android Studio](https://developer.android.com/studio) gives you both |
| Storage | About 400 MB installed | About 10 MB |
| Internet | Only to download build tools once; the app never uses it | Only to download build tools once; the app never uses it |

Get the source code first:

```bash
git clone https://github.com/svrsunny/emi-tracker.git
cd emi-tracker
```

## Windows

### Build the Windows installer

```bash
cd desktop
npm install
npm run dist
```

This creates two files in `desktop/release/`:

- `EMI Tracker-Setup-<version>.exe`: a normal installer.
- `EMI Tracker-Portable-<version>.exe`: a single file that runs without installing.

### Install on Windows

1. Double-click `EMI Tracker-Setup-<version>.exe`.
2. Windows SmartScreen may say *"Windows protected your PC"* because the app is not code-signed.
   Click **More info → Run anyway**.
3. Choose an install folder (it installs for your user only, no administrator rights needed) and
   finish.
4. Start **EMI Tracker** from the Start menu or the desktop shortcut.

### First start on Windows

1. The welcome screen explains that everything stays on this PC. Continue.
2. On the empty dashboard choose **Add your first loan**, **Add a reminder**, or **Explore with demo
   data** to look around with fictional loans (you can delete them later).
3. Recommended: open **Backup, Sync & Restore** and turn on automatic backups into a folder of your
   choice (for example on another drive).
4. Optional: **Settings → App lock** to protect the app with a PIN, password or Windows Hello.

By default the app keeps running in the **system tray** when you close the window, so reminders still
appear. Change this in *Settings* ("Keep running in the tray when the window is closed",
"Start with Windows").

Your data is stored in `%APPDATA%\EMI Tracker\emi-tracker.sqlite`.

## Android

### Build the Android APK

With Android Studio: open the `android/` folder and choose **Build → Generate App Bundles or APKs →
Build APK(s)** for the *release* variant. Or from a terminal:

```bash
cd android
./gradlew :app:assembleRelease
```

On Windows Command Prompt use `gradlew.bat :app:assembleRelease`.

The APK is written to `android/app/build/outputs/apk/release/app-release.apk` (about 3 MB). Use this
release build on your phone: it is much faster than the debug build.

> Without your own signing key the APK is signed with your computer's debug key. That is fine for
> personal use. Keep building on the same computer so updates install over the previous version; see
> [DEVELOPMENT.md](DEVELOPMENT.md#signing-android-releases) to use your own key.

### Install on Android

**Without a cable:** copy `app-release.apk` to the phone (for example to *Downloads*), open it in
your file manager, allow **Install unknown apps** for that file manager when asked, and tap
**Install**.

**With a USB cable** (USB debugging turned on in *Developer options*):

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

Google Play Protect may warn about an app from an unknown developer; choose to install anyway only if
you built it yourself from this repository.

### Android permissions

| Permission | Why |
| --- | --- |
| Notifications (asked on Android 13+) | EMI, bill and other reminders. You can refuse and allow it later |
| Internet | Only for Wi-Fi sync with your own PC on your home network; the app refuses any other address |
| Run at startup, keep awake briefly | So reminders are re-scheduled after a restart (WorkManager) |
| Use biometrics / fingerprint | Only used if you turn on the app lock with fingerprint or face |

The app never asks for contacts, location, camera, microphone, SMS or storage-wide access. Files are
read or written only where you choose them with Android's file picker.

### First start on Android

1. The welcome screen explains the privacy model. Choose **Allow reminders & continue** (or continue
   without notifications).
2. Add your first loan, a reminder, or **Explore with demo data**.
3. Recommended: *More → Backup, sync & restore → Automatic backups → Choose folder*.
4. For the most punctual reminders set *Android Settings → Apps → EMI Tracker → Battery →
   Unrestricted*.

## Updating

- **Windows:** install the newer `EMI Tracker-Setup-<version>.exe` over the old one. Your data is kept,
  and a recovery copy is made the first time a new version opens it.
- **Android:** install the newer APK over the old one; your data is kept. This works because every
  release APK is signed with the same key. An APK you **built yourself** is signed with a different key,
  so moving between a self-built APK and a downloaded one needs a one-time *back up → uninstall →
  install → restore*.
- If you use both apps, **update both** before syncing: an older app may not understand data written by
  a newer one (see [CHANGELOG.md](../CHANGELOG.md)).

## Uninstalling

**Before uninstalling, make a backup** if you might want your data later.

- **Windows:** *Settings → Apps → Installed apps → EMI Tracker → Uninstall*. Your data in
  `%APPDATA%\EMI Tracker` is **kept on purpose**; delete that folder yourself if you want it gone.
  Backups you saved elsewhere (by default `Documents\EMI Tracker Backups`) are also kept.
- **Android:** long-press the app → *Uninstall*, or *Settings → Apps → EMI Tracker → Uninstall*. This
  deletes the app's data. Backups and sync files you saved to folders remain there.
- To erase the data but keep the app: *Settings → Erase all data…* in either app.
