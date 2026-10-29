# Web Push senders

Neither sender is activated or deployed. For the concrete free hosted option, use
[Cloudflare Workers Free + D1](cloudflare/README.md): it includes the Worker,
database schema, scheduled delivery, setup commands and tests. It needs no Mac
left awake and no Firebase paid plan. Account creation/terms, database creation
and VAPID secrets must still be completed before connecting the website.

`npm ci && npm test` runs client/policy tests and the Cloudflare Worker tests.
`npm run worker:check` bundles the Worker locally without deploying it.

## Alternative: existing Node server

`server.mjs` does not run on GitHub Pages or directly on Cloudflare Workers.
Firebase Spark cannot host Cloud Functions. This alternative requires a host
with a persistent Node process, HTTPS and private persistent storage.
On a Mac it only sends while this process is running and the Mac is awake.

1. Run `npm ci` here, copy `.env.example` to `.env`, then run `npm run keys`.
   Put the generated private/public VAPID keys in `.env`; never commit `.env`.
2. Set your Firebase project and contact address. Expose the server through HTTPS,
   preserving the `Authorization` header. `ALLOWED_ORIGIN` is the website origin.
3. Start with `npm start`. Keep `data/` private on persistent storage.
4. Configure the website's `MM_PUSH_CONFIG` with `endpoint` pointing to
   `https://your-host/subscriptions` and `publicVapidKey`. Wire the notification
   client `getToken` callback to the signed-in user's Firebase ID token.

`PUT /subscriptions` accepts a PushSubscription and up to 14 future messages from
`MMNotifications.schedule`. Firebase JWT signature, project, expiry and Google
sign-in provider are checked; records are bound to the token's UID. The service
accepts only known Apple/Google/Mozilla push hosts. No Firebase Admin credential,
bank archive or spending history is required. Detailed notification copy is
optional; the default copy excludes amounts and expense names.

The loop sends due messages once per tag, skips messages over an hour late,
removes expired registrations, and retains sent tags for 16 days. A process crash
between delivery and persistence can repeat a notification; identical tags let
the browser replace it. These reminders are informational, not guaranteed alarms.
Native iOS reminders use the on-device scheduler instead and need no sender.
