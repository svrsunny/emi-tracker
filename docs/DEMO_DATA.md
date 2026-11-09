# Demo data

Two ways to try EMI Tracker with **fictional** data, without typing loans in yourself. All names,
lenders, amounts and transactions are made up.

## Option 1: the built-in demo (quickest)

On an **empty** app, the dashboard shows **Explore with demo data**. It adds a few clearly labelled
"Demo …" loans with payments, generated relative to today. Delete them later from the loan list, or
use *Settings → Erase all data…*.

## Option 2: the full demo backup (same data as the screenshots)

[`demo/emi-tracker-demo-backup.json`](../demo/emi-tracker-demo-backup.json) is a normal EMI Tracker
backup containing:

| Kind | Fictional content |
| --- | --- |
| Loans | Home loan — Sunrise Bank (₹45,00,000, 8.6% floating, 20 years, with a ₹1,00,000 prepayment); Car loan — Metro Auto Finance (₹8,00,000, 9.25%, 5 years, one EMI paid late); Personal loan — Kaveri Finance (₹2,50,000, 12.5%, 3 years, latest EMI unpaid) |
| Chit fund | Friends chit — Lakshmi Chits (₹1,00,000, 20 × ₹5,000, with dividends) |
| Bills | Electricity (amount varies), mobile plan, broadband, quarterly health insurance |
| One-time expense | Laptop repair |
| Lending & borrowing | Lent to "Arjun" (part returned), borrowed from "Meena", a settled entry with "Kiran" |
| Reminder | "Renew vehicle insurance" |

**Restoring replaces all data in the app.** Load it only into a fresh install, a test device or a
separate data folder, never into an app that holds your real records (or make a backup first).

- **Windows:** *Backup, Sync & Restore → Choose backup to restore…* → pick the file → confirm.
- **Android:** copy the file to the phone, then *More → Backup, sync & restore → Choose backup to
  restore…* → pick the file → *Restore this backup…* → type `RESTORE`.

### Windows: a separate demo profile

To explore without touching your real data, start the app with its own data folder (from a source
checkout):

```powershell
cd desktop
npm install
$env:EMI_TRACKER_DATA_DIR = "$PWD\.devdata"; npm start
```

Then restore the demo backup in that window. Delete `desktop/.devdata` to reset.

### Resetting

*Settings → Erase all data…* (type `DELETE ALL DATA`) empties the app. On Windows you can instead
delete the separate data folder.

## Regenerating the demo backup

The file is generated from code ([`desktop/tests/demo/make-demo-data.test.ts`](../desktop/tests/demo/make-demo-data.test.ts))
with dates relative to the day it runs, so "overdue" and "upcoming" stay realistic:

```bash
cd desktop
npm run demo:data
```

It uses the app's own storage code, so the result is always a valid backup for both apps. The same
data set is used for the [screenshots](../assets/screenshots/); to retake the Windows ones, see
[DEVELOPMENT.md](DEVELOPMENT.md#windows-app-desktop).
