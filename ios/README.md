# MyMoney iPhone prototype

This is an iOS app container for the existing web interface. The website remains a separate build. No paid service, Apple membership, signing identity or provisioning profile is configured in this repository.

## Prepare and run

```sh
npm ci
npm run ios:sync
npm run ios:open
```

In Xcode, select the App target, choose your Apple account's **Personal Team** under Signing & Capabilities, connect your iPhone, enable Developer Mode if iOS requests it, and run on that device. A free Personal Team installation expires after seven days and must be rebuilt/reinstalled. Each tester can build on their own Mac and account; distribution through TestFlight is a separate paid Developer Program capability.

`ios:sync` rebuilds and copies the web interface. Generated web copies, build products and signing files are excluded from Git. Native changes need a new device build. Updating GitHub Pages alone does not update this app's bundled interface.

## Native integrations

- MyMoney's existing opaque 1024px lowercase `m` icon is used by iOS and its notifications.
- The speech adapter uses Apple's Speech framework, prefers on-device recognition when supported, emits a live audio level, and releases the microphone when stopped or backgrounded. It does not save audio. System consent is required, and Apple recognition can use the network when on-device support is unavailable.
- Soft impact, selection and success feedback use system generators with a minimum spacing between impulses. Safari gets a silent no-op.
- Local notifications require opt-in. At most 48 upcoming MyMoney reminders are scheduled; they are recalculated when the app refreshes its data. They do not require a server to arrive after the app closes. This is not remote push delivery.
- Google Sign-In uses Google's official native SDK and the registered Firebase iOS configuration. The resulting short-lived credential is passed to the existing Firebase JavaScript Auth and Firestore integration. No administrative key is included. Native bridge logging is disabled to avoid exposing token payloads.

## Verification limits

The JavaScript bridge has isolated tests and the project/plist/Swift syntax can be checked without an iOS SDK. A successful Xcode build, real-device Google login, speech permissions, haptics and notification delivery still need physical-device validation. Do not describe the prototype as installed or App Store ready until those checks have passed.
