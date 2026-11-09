# Privacy

**Short version:** EMI Tracker keeps your loans, payments, bills and everything else **only on your
own devices**. There are no accounts, no servers, no cloud, no ads, no analytics and no tracking.

| Question | Answer |
| --- | --- |
| Where is my data stored? | Windows: `%APPDATA%\EMI Tracker\emi-tracker.sqlite`. Android: the app's private storage. |
| Does the app use the internet? | No. The Windows app blocks every outbound request. The Android app only connects to your own PC on your home network, and only if you set up Wi-Fi sync. |
| Is anything sent to the developer? | No. There is no telemetry, crash reporting or update check. |
| Do I need an account? | No. |
| How do my phone and PC exchange data? | Only if you choose to: directly over your home Wi-Fi (encrypted, after pairing with a code), through a folder you pick, or through backup files you move yourself. |
| Is my data encrypted on the device? | The app does not encrypt its database. Your Windows account and Android's device encryption protect it. The optional app lock protects the app's screens. |
| Are backups encrypted? | Only if you choose *Encrypted backup* and a passphrase. Plain backups and exports are readable files: keep them private. |
| Does Android back up my data to Google? | No. Android cloud backup is turned off for this app. |
| How do I delete everything? | *Settings → Erase all data* in the app, then uninstall. On Windows also delete `%APPDATA%\EMI Tracker` (see [docs/INSTALLATION.md](docs/INSTALLATION.md#uninstalling)). |

The full description, with how each statement was verified in the code and tests, is in
[docs/PRIVACY.md](docs/PRIVACY.md).
