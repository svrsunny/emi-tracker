# Third-party notices

EMI Tracker is released under the [MIT License](LICENSE). The apps bundle the following third-party
components. Each remains under its own license; the full license texts are included in the
respective packages (`desktop/node_modules/<package>/LICENSE` after `npm install`, and the AndroidX /
Kotlin artifacts downloaded by Gradle).

## Fonts

| Font | Used by | License |
| --- | --- | --- |
| [Inter](https://rsms.me/inter/) | Windows app (via `@fontsource/inter`), Android app (`android/app/src/main/res/font/inter_*.ttf`) | SIL Open Font License 1.1 |
| [JetBrains Mono](https://www.jetbrains.com/lp/mono/) | Windows app (via `@fontsource/jetbrains-mono`) | SIL Open Font License 1.1 |

The SIL Open Font License allows the fonts to be bundled and redistributed with software. The font
files are unmodified. The license texts are in [licenses/OFL-1.1-Inter.txt](licenses/OFL-1.1-Inter.txt)
and [licenses/OFL-1.1-JetBrainsMono.txt](licenses/OFL-1.1-JetBrainsMono.txt).

## Windows app (`desktop/`)

Bundled into the installed app:

| Component | License |
| --- | --- |
| Electron | MIT |
| React, React DOM | MIT |
| Recharts | MIT |
| lucide-react (icons) | ISC |
| sql.js (SQLite compiled to WebAssembly) | MIT (SQLite itself is public domain) |
| decimal.js | MIT |
| zod | MIT |

Development-only tools (not shipped): TypeScript, Vite, Vitest, Playwright, ESLint and
electron-builder; see `desktop/package.json`.

## Android app (`android/`)

| Component | License |
| --- | --- |
| AndroidX (Core, Activity, Lifecycle, Navigation, Fragment, DocumentFile, Biometric, Room, WorkManager) | Apache License 2.0 |
| Jetpack Compose and Material 3, Material Icons | Apache License 2.0 |
| Kotlin standard library, kotlinx.coroutines, kotlinx.serialization | Apache License 2.0 |

Test-only libraries (JUnit, Robolectric, AndroidX Test) are not shipped. See
`android/gradle/libs.versions.toml` for exact versions.
