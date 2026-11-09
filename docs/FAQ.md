# Frequently asked questions

## General

**What is EMI Tracker?**
A private app for Windows and Android that tracks your loans and EMIs, chit funds, recurring bills,
one-time expenses and money lent to or borrowed from people, with reminders, reports and backups.
Everything stays on your own devices.

**Is it free?**
Yes. It is open source under the [MIT License](../LICENSE).

**Does it connect to my bank?**
No. You enter your loans and payments yourself. The app never connects to banks, websites or any
online service.

**Do I need both apps?**
No. Each app works on its own. Using both lets you keep them in sync (see the [Sync guide](SYNC_GUIDE.md)).

**Where can I download it?**
From the [Releases page](https://github.com/svrsunny/emi-tracker/releases/latest): a Windows installer, a portable Windows app and an Android APK.
See [INSTALLATION.md](INSTALLATION.md).

**Is there an iPhone, Mac or Linux version?**
No. Only Windows and Android are supported.

## Money and calculations

**Why is my EMI slightly different from my bank's?**
Banks round differently and some charge interest on daily balances. In the *Add loan* wizard choose
**Enter from lender** and type the EMI from your loan papers; you can also pick daily interest
(*Reducing balance — daily*) and the rounding mode. To align with your statement, enter the lender's
outstanding balance on the loan (*History → Lender's current outstanding*) and the app shows the
difference.

**Why do some numbers say "Estimate"?**
Figures that depend on assumptions (EMIs you said were paid before tracking, projections into the
future, calculated EMIs not yet confirmed) are labelled so you know they are not from your records.

**Can it handle floating rates, prepayments and part payments?**
Yes: rate changes with an effective date, prepayments (reduce tenure or EMI), part payments, advance
payments, foreclosure, missed EMIs, fees and penalties. See [FINANCIAL_CALCULATIONS.md](FINANCIAL_CALCULATIONS.md).

**Which currency does it use?**
Indian rupees (₹) with Indian digit grouping by default; currency, grouping and decimals can be
changed in *Settings*.

## Data and privacy

**Where is my data?**
Windows: `%APPDATA%\EMI Tracker\emi-tracker.sqlite`. Android: the app's private storage. See
[PRIVACY.md](PRIVACY.md).

**What happens if I lose my phone or my PC breaks?**
Your data is only as safe as your backups. Turn on **automatic backups** into a folder on another
drive, an SD card, or a folder your own cloud tool mirrors, and/or keep the other device synced.

**I forgot my encrypted-backup passphrase.**
The backup cannot be opened without it; nobody can recover it. Make a new backup with a passphrase
you will remember.

**I forgot my app PIN.**
On Windows use Windows Hello ("Forgot your PIN?"); on Android use the phone's own screen lock. If
neither is set up on the device, the lock cannot be bypassed: reinstalling deletes the data, so restore
from a backup afterwards.

**Is the Wi-Fi sync secure?**
The content is encrypted and authenticated with a key agreed when you pair with a code, and it only
works inside your home network. Read the limitations in the [Sync guide](SYNC_GUIDE.md#security).

## Sync

**Do phone and PC need internet for sync?**
No, only the same home Wi-Fi.

**Why doesn't the PC push changes to my phone?**
The phone always starts the exchange. The PC's *Sync now* asks an open phone app to sync; otherwise the
phone syncs when opened and about every 15 minutes.

**I erased everything on one device and the data came back.**
*Erase all data* only clears that device. On the next sync the other device's records are added again.
Erase on both devices before they sync, or unpair first. See
[SYNC_GUIDE.md](SYNC_GUIDE.md#conflicts-and-deletions).

## Known limitations

- **No automatic bank import.** Statements are not read; everything is entered by you.
- **No cloud or online backup** by design; you choose where backup files go.
- **Wi-Fi sync needs the Windows app running** and the phone on the same network. It does not work
  between two phones or two PCs; folder sync or backups can be used instead.
- **Android background timing is approximate.** Android may delay reminders and background sync to
  save battery; set the app's battery usage to *Unrestricted* for the best timing. Missed reminders
  are delivered late, never dropped.
- **Windows reminders need the app running** (the system tray is enough).
- **The app lock does not encrypt the database**; device encryption and your Windows account protect
  stored data.
- **Windows installer not code-signed:** SmartScreen warns on first install.
- **Self-built Android APKs** are signed with a different key than the released APK, so one cannot be
  updated in place by the other (back up, uninstall, install, restore).
- **English only.** Dates and currency can be formatted, but the interface is in English.
- **Receipt attachments are Windows-only** and are not synced.
- **Lending & borrowing has no interest.**
