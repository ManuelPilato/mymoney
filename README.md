# MyMoney.

A minimal personal-finance web app for iPhone and Mac, with a fluid interface,
voice-assisted expense entry and optional Google sign-in for cross-device sync.

**[Open MyMoney](https://manuelpilato.github.io/mymoney/)**

Tap to add an expense, hold to open the finance assistant, and swipe up to see
your movements and plan. The interface supports Italian and English.

## Run locally

Requirements: Node.js 24.12 or newer and Python 3.

```sh
npm ci
npm run build
npm start
```

Open http://127.0.0.1:8765/. Keep the same address to retain the browser's local
archive. Speech support and microphone permission depend on the browser.

## Project

- `src/`: application, styles, accounting and WebGL rendering sources.
- `app/`: generated website and brand assets; the only folder deployed to Pages.
- `tests/`: offline accounting, interaction, rendering and sync checks.
- `firebase/`: Firestore security rules for per-user records.
- `scripts/`: portable development helpers.
- `ios/`: optional Capacitor iPhone container (see its README for free testing).
- `server/notifications/`: optional authenticated Web Push sender; not deployed.
- `.github/workflows/pages.yml`: tests, build, Retina checks and deployment.

Edit `src/`, then build. Changes pushed to `main` are checked and published
automatically at the same site address. Pull requests run the checks without
deploying. A failed check leaves the previous site online.

Pages must use **Settings → Pages → Source: GitHub Actions**. Only `app/` is
published; source code, tests, iOS files and server configuration stay out of
the website artifact.

## Checks

```sh
npm test
python3 -m pip install -r requirements-test.txt
python3 -m playwright install chromium
npm run test:retina
```

The visual check uses disposable synthetic data, blocks external requests and
captures desktop 4K and mobile Retina views under `tests/artifacts/` (ignored by
Git). It does not certify a physical iPhone's microphone or Safari performance.
Firestore rule tests require a separate **local** emulator at 127.0.0.1:8088;
they are deliberately excluded from `npm test`.

## Notifications and optional iPhone app

Preferences contains an explicit notification opt-in and a test button. iPhone
Web Push requires opening the installed Home Screen web app. Automatic web
reminders require the separate sender configured as `MM_PUSH_CONFIG`; no sender
is deployed by this repository. Firebase Spark and GitHub Pages alone cannot run
scheduled delivery. Default lock-screen copy hides amounts and expense names.

The iPhone container includes native haptics, speech, Google sign-in and local
notifications. `npm run ios:sync` prepares the Xcode project; `npm run ios:open`
opens it. Xcode, an Apple account and device signing are still required. Free
Personal Team builds expire after seven days; no paid membership or App Store
publication is needed to test on your own device. Native reminders are refreshed
when this device opens, edits or syncs the app, not remotely while it is closed.

## Data and Firebase

Personal archives, exports, credentials and backups must never be committed.
The Firebase web configuration is public client metadata; access to financial
records is controlled by Authentication and Firestore rules. A fresh archive
contains no personal records. The website build never deploys Firestore rules.

To operate an independent fork, configure your own Firebase project and
authorized domains in `src/firebase-config.js` and deploy your own rules.
Do not include service-account keys or administrative credentials in the app.

The repository is public for inspection. No license granting reuse of the
MyMoney brand or application has been selected yet.
