## What this changes

<!-- A short description and the issue it fixes, e.g. "Fixes #12" -->

## Which app

- [ ] Windows (`desktop/`)
- [ ] Android (`android/`)
- [ ] Documentation only

## Checklist

- [ ] No real financial or personal data in code, tests, fixtures or screenshots
- [ ] No new network access, telemetry, accounts or cloud services
- [ ] Calculation, validation or data-format changes are made on **both** platforms, with tests on both
- [ ] Tests added or updated, and these pass:
  - Windows: `npm run typecheck`, `npm run lint`, `npm test` (and `npm run test:e2e` for UI changes)
  - Android: `./gradlew :core:test :app:testDebugUnitTest :app:lintDebug`
- [ ] Docs in `docs/` and `CHANGELOG.md` (*Unreleased*) updated if behaviour changed

## Screenshots (demo data only)
