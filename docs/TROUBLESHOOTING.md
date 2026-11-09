# Troubleshooting

Before trying anything that changes data, **make a backup** (*Backup, Sync & Restore → Back up now*).
For sync problems see the [Sync guide](SYNC_GUIDE.md#troubleshooting).

## Installing

| Problem | Solution |
| --- | --- |
| Windows says "Windows protected your PC" | The installer is not code-signed. Click **More info → Run anyway** (only for an installer you built yourself or downloaded from this repository) |
| `npm install` fails | Use Node.js 22 or newer (`node --version`). Delete `desktop/node_modules` and try again |
| `npm run dist` fails with `getaddrinfo ENOTFOUND github.com` | You are offline. Build with `npx electron-builder --win --x64 --config.electronDist=node_modules/electron/dist` after `npm run build` |
| Gradle cannot find the Android SDK | Open `android/` once in Android Studio, or create `android/local.properties` with `sdk.dir=<path to your Android SDK>` |
| Gradle needs a newer Java | Use JDK 17 or newer; in Android Studio, *Settings → Build Tools → Gradle → Gradle JDK* |
| Android: "App not installed" when updating | The new APK is signed with a different key. Back up, uninstall, install, restore. See [INSTALLATION.md](INSTALLATION.md#updating) |
| Android blocks the install | Allow *Install unknown apps* for the file manager you opened the APK with |

## Reminders

| Problem | Solution |
| --- | --- |
| No reminders on Android | Allow notifications for EMI Tracker (*Android Settings → Apps → EMI Tracker → Notifications*), set *Battery → Unrestricted*, and check *More → Reminders & notifications → Settings* (categories, quiet hours, weekdays) |
| Android reminders arrive late | Android delays background work to save battery. *Unrestricted* battery usage helps; late reminders are marked as late |
| No reminders on Windows | The app must be running; keep *Keep running in the tray when the window is closed* on, and *Start with Windows* if you want it after a restart. Check *Reminders → Settings* and Windows' own notification settings / Focus assist |
| A reminder for something already paid | Record the payment (or *Mark paid* for a bill); reminders stop for paid items |

## Numbers

| Problem | Solution |
| --- | --- |
| EMI differs from the bank's | Use **Enter from lender** with the EMI from your papers; try *Reducing balance — daily* if your bank charges daily interest |
| Outstanding differs from the bank statement | Edit the loan → *History* → **Lender's current outstanding** with the statement date to see the difference; record missing payments, fees or rate changes |
| A payment shows on the wrong installment | Edit the payment and choose the installment it was for |
| A loan shows "overdue" although it is paid | The payment was not recorded (statuses are never guessed from dates). Record it, or mark older EMIs as paid before tracking in the loan's *History* step |

## Backups

| Problem | Solution |
| --- | --- |
| "Wrong passphrase, or the encrypted file was modified" | Check the passphrase (it is case-sensitive). Without it the file cannot be opened |
| Restore refuses a file | Only EMI Tracker backups (`.json`, `.emibackup`, `.emisync`) are accepted, and the file must not be edited. Try an older backup |
| Restore went wrong | A recovery backup of the previous data was saved first; restore it from the backup history list |
| Automatic backups stopped (Android) | The chosen folder may have been removed or access revoked. *Choose folder* again |

## App lock

| Problem | Solution |
| --- | --- |
| Forgot the app PIN / password | Windows: *Forgot your PIN? Verify with Windows Hello*. Android: *Forgot? Use the phone's screen lock* |
| "Too many attempts" | Wait for the time shown (it doubles up to 15 minutes) |
| Windows Hello only offers the Windows PIN | Windows shows only the sign-in methods set up on the PC; fingerprint and face need that hardware set up in *Windows Settings → Accounts → Sign-in options* |

## Still stuck?

Open an issue with the *Bug report* template (see [CONTRIBUTING.md](../CONTRIBUTING.md#reporting-a-bug)).
Please describe the problem with the [demo data](DEMO_DATA.md); never post your real financial
details, backups or screenshots containing them.
