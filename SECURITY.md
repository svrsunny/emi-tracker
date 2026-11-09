# Security policy

EMI Tracker stores personal financial records, so security reports are taken seriously.

## Supported versions

Only the latest code on the default branch is supported. There are no long-term support releases.

| Component | Current version |
| --- | --- |
| Windows app (`desktop/`) | 1.4.1 |
| Android app (`android/`) | 1.4.2 |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

1. Use GitHub's **private vulnerability reporting**: on the repository page open
   *Security → Report a vulnerability*. This sends the report privately to the maintainer.
2. If that option is not available, open a public issue titled "Security contact request" with
   **no technical details**, and the maintainer will arrange a private channel.

Please include:

- the affected app (Windows, Android or both) and version (*Help & Diagnostics* on Windows, the
  version line at the bottom of *More* on Android);
- steps to reproduce, and what an attacker could achieve;
- whether the issue needs physical access, the same Wi-Fi network, or a malicious file.

Never include your real financial data, backups or databases in a report. Use the
[demo data](docs/DEMO_DATA.md) to reproduce problems.

This is a volunteer project: there is no bug bounty and no guaranteed response time, but every
report will be read.

## Scope

In scope:

- the Wi-Fi sync protocol (pairing, key agreement, encryption, the local HTTP server);
- backup encryption and restore validation;
- the app lock (PIN / password hashing, throttling, bypasses);
- the Electron security configuration (IPC validation, CSP, blocked network access);
- anything that could send data off the device or expose it to other apps.

Known, documented limitations are listed in
[docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md#known-limitations); reports that
show a practical attack beyond those limitations are welcome.

## Security design in brief

- No internet use, accounts, telemetry or cloud. See [PRIVACY.md](PRIVACY.md).
- Wi-Fi sync: ECDH P-256 pairing bound to a 6-digit code, AES-256-GCM for every message, home-network
  addresses only. See [docs/SYNC_GUIDE.md](docs/SYNC_GUIDE.md#security).
- Encrypted backups: AES-256-GCM, PBKDF2-HMAC-SHA256 with 210,000 iterations; passphrases are never stored.
- App lock: salted scrypt (Windows) or PBKDF2 (Android) hashes, throttling after 5 wrong attempts.
