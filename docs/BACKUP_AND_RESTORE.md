# Backup, restore, export and sync

Your loan data exists only on your devices. Back it up.

## What a backup contains

A backup is a full snapshot of every synced table:

| Section | Contents |
| --- | --- |
| `loans` | Every loan configuration (all wizard fields) |
| `adjustments` | Rate changes, EMI changes, restructurings |
| `payments` | All payments, including reversed ones, with allocation overrides, references and notes |
| `customReminders` | Custom reminders |
| `notifications` | Notification history (sent, dismissed, snoozed) |
| `audit` | Audit history |
| `categories` | Custom categories |
| `tombstones` | Deletion markers used by sync |
| `preferences` | Currency, formats, theme, accent, heatmap palette and thresholds, dashboard layout, reminder settings |

Plus format version, schema version, app name, version and platform, device name, record counts,
and a SHA-256 checksum.

**Not included:** device-local settings (backup or sync folders, start-up behaviour, device id), the
sync passphrase, and attachment files (desktop receipts live in the app data folder; back that folder
up separately if you use attachments).

## Format (version 1)

```jsonc
{
  "format": "emi-tracker-snapshot",
  "formatVersion": 1,
  "schemaVersion": 2,
  "kind": "backup" | "sync" | "export" | "recovery",
  "createdAt": "2026-10-28T10:00:00.000Z",
  "app": { "name": "EMI Tracker", "version": "1.0.0", "platform": "desktop" | "android" },
  "deviceId": "…", "deviceName": "…",
  "counts": { "loans": 3, "payments": 61, … },
  "checksum": "<sha256 hex>",
  "data": { "loans": […], "adjustments": […], "payments": […], … }
}
```

- Money values are strings with two decimals; dates are `YYYY-MM-DD`; timestamps are ISO-8601 UTC.
- **Checksum**: SHA-256 of the *canonical JSON* of `data`, where every table is sorted by `id`
  (tombstones by `table:id`), object keys are sorted recursively, there is no whitespace, and
  string escaping matches JavaScript's `JSON.stringify`. Both apps compute it identically.

### Encrypted envelope

```jsonc
{
  "format": "emi-tracker-encrypted", "formatVersion": 1,
  "kdf": "PBKDF2-HMAC-SHA256", "iterations": 210000,
  "salt": "<base64, 16 bytes>", "iv": "<base64, 12 bytes>",
  "cipher": "AES-256-GCM", "ciphertext": "<base64: ciphertext || 16-byte tag>",
  "createdAt": "…", "kind": "backup"
}
```

The passphrase (minimum 8 characters) is never stored. A wrong passphrase or a modified file fails
authentication. Encrypted backups use `.emibackup`; encrypted sync files use `.emisync`.

## Validation before anything is restored

1. Parse JSON. Truncated or corrupted files are rejected (`corrupt`).
2. Decrypt if encrypted (`needs_passphrase`, `bad_passphrase`).
3. Check the format marker (`not_a_backup`) and version. Newer formats are rejected
   (`unsupported_version`); older ones go through `migrateSnapshot`.
4. Validate every record against the same rules as data entry (types, money format, dates,
   enumerations, cross-field rules).
5. Verify the checksum against the file's own data (`checksum_mismatch`).
6. Verify referential integrity: no payment or change may point at a missing loan.

## Restore procedure

1. Validate (as above) and show a preview: when, from which device and app version, and the record
   counts in the backup compared with your current data.
2. Ask for confirmation. You must type `RESTORE`.
3. Write a **recovery backup** of the current data
   (desktop: `%APPDATA%\EMI Tracker\recovery-backups\`; Android: app-private `recovery-backups/`).
4. Replace all synced tables in **one database transaction**.
5. Verify: record counts equal the backup's, the recomputed checksum equals the backup's, and the
   SQLite `integrity_check` plus `foreign_key_check` pass.
6. If any step fails, the previous data is written back (rollback). The error says nothing changed.

Automatic safety backups are also taken before permanently deleting a loan, before *Erase all
data*, before a database schema migration (desktop keeps a byte copy of the old database file), and
the first time a new app version opens existing data.

## Backup locations and schedule

| | Desktop | Android |
| --- | --- | --- |
| Manual backup | *Backup, Sync & Restore → Back up now*, into the chosen folder (default `Documents\EMI Tracker Backups`) | *More → Backup → Back up now*, location chosen with the system file picker (Storage Access Framework) |
| Automatic | Every N hours while the app runs, keeping the latest N `emi-tracker-auto-*` files | Every N hours via WorkManager into a folder you grant access to |
| File names | `emi-tracker-backup-YYYYMMDD-HHMMSS.json` / `.emibackup` | same |
| Verification | Each backup is read back and its checksum checked; results appear in *Backup history* | same |

## Moving to another computer or phone

Copy any backup file to the new device, install EMI Tracker, then choose *Restore*. Desktop
backups restore on Android and the reverse; both are tested in CI-style fixtures under `/fixtures`.

## Portable exports

- **Full JSON export**: the same snapshot format with `kind: "export"`, unencrypted.
- **CSV**: loans, payments (with principal/interest/fee/penalty allocation), amortization
  schedules and every report. CSV cells that start with `= + - @` are prefixed with `'` to prevent
  spreadsheet formula injection.
- **Import (desktop)**: CSV of loans (`name, lender, principal, annual_rate, installments,
  start_date, first_emi_date[, emi, category, notes]`) or payments (`loan, date, amount[, type,
  installment, reference, notes]`). Rows are validated and imported in one transaction.

## Sync

Lending & borrowing (`debts`, `debtRepayments`, schema v4) and one-time expenses (bills with
`frequency: "once"`) sync the same way; update both devices to 1.4.0 first, because older versions
reject them. Bills and their payments (`bills`, `billPayments`, schema v3) are part of every backup and sync,
with the same record-level merge; backups made before bills existed still restore.

There are two ways to sync. Both use the same snapshot format and the same merge.

### Wi-Fi sync

The Windows app runs a small server (port 47830 by default, changeable) when *Wi-Fi sync* is on.
The phone connects to the PC address you entered; requests from outside the local network are
refused. Protocol v1 (`desktop/src/main/lanProtocol.ts`, `android/core/.../Lan.kt`):

1. `POST /emi-sync/pair/start` `{deviceId, deviceName, pub}`: only while the PC shows a code.
   The PC answers with its own ephemeral P-256 public key.
2. Both derive `K = HKDF-SHA256(ECDH secret, salt = SHA-256(code), info = "emi-tracker-pair-v1" || phonePub || pcPub)`.
3. `POST /emi-sync/pair/finish` `{deviceId, proof = HMAC(K, "…:phone")}`; the PC checks it and
   answers `HMAC(K, "…:pc")`. Five wrong codes close pairing.
4. `POST /emi-sync/sync` `{deviceId, iv, data}`: the phone's sync snapshot, AES-256-GCM under `K`
   with associated data `emi-sync-req:<deviceId>`. The PC validates it like a backup, merges it,
   and returns its own snapshot (`emi-sync-res:<deviceId>`), which the phone merges.

The phone syncs when the app opens, after each change, every ~15 minutes in the background
(WorkManager) and on *Sync now*. Failures (PC off, away from home) are recorded quietly and retried.

*Sync now* is on both dashboards and in the Wi-Fi sync settings. The PC never connects to the phone,
so the PC's button raises a flag instead: `GET /hello` then answers `syncRequested: true` (for up to
10 minutes, cleared by the next sync). While EMI Tracker is open on the phone it checks `/hello`
every 5 seconds and syncs when it sees the flag; the PC button shows *Waiting for phone…* until
then. The PC's button also syncs the sync folder straight away if one is set.

### Folder sync

Folder sync is file-based and works without any network.

1. Each device writes its full snapshot to `emi-tracker-sync-<deviceId>.json` (or `.emisync` when
   encrypted) in a sync folder.
2. On sync, the app reads every *other* device's file, validates it like a backup, and merges it
   into the local data:
   - records are matched by `id`; the newer `updatedAt` wins, and ties are broken deterministically
     by canonical JSON, so the merge is commutative and idempotent;
   - deletions travel as tombstones (`table`, `id`, `deletedAt`) and remove records not edited
     after the deletion;
   - preferences: the newer `updatedAt` wins;
   - children of a deleted loan are dropped (deleting a loan requires typing its name);
   - notification history is merged too, so a reminder delivered on one device is not repeated on
     the other.
3. The merged result is applied in one transaction, then this device's file is rewritten.

You decide how files move between devices: a USB cable, an SD card, a network share, or a folder
your own file-sync tool already mirrors. The apps only read and write the folder you chose.
Encrypt sync files if the folder leaves your hands. The sync passphrase is kept encrypted with
Windows DPAPI (desktop) or the Android Keystore (Android) so background sync can run, and is never
stored in plaintext.

Limitations: edits to the *same* record on two devices between syncs resolve to the newest edit
(field-level merging is not attempted). Every change is still in the audit log.
