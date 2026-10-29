# MyMoney notifications — Cloudflare Free

**Ready to configure, not deployed or activated.** This is a real Worker with a
D1 database and a once-per-minute Cron Trigger. It does not need a continuously
running computer, a credit-linked Firebase plan, Cloud Functions or a paid
Cloudflare product. Creating the Cloudflare account and accepting its terms is
still required; no account, database, credentials or deployment was created here.

## What runs

- `PUT /subscriptions` verifies the Firebase Google ID token, binds the browser's
  subscription to its UID and replaces its future notification plan.
- `DELETE /subscriptions` revokes that device and deletes its pending messages.
- Cron claims and sends **one** due notification per minute, using WebCrypto,
  AES128GCM and VAPID. Apple, Google and Mozilla push endpoints are supported.
- D1 persists reminders and deduplication tags. Expired subscriptions, stale
  plans and old deduplication records are removed automatically. A lease prevents
  overlapping cron runs from sending the same item concurrently.

The website API is unchanged: its `MM_PUSH_CONFIG.endpoint` is the Worker URL
followed by `/subscriptions`, and `publicVapidKey` is the generated public key.
Do not enable that configuration before the deployment is working. Safari on
iPhone still requires the webapp installed on the Home Screen and the user's
notification permission. The existing service worker displays the MyMoney icon.

## Setup after the account terms are accepted

Run these commands from `server/notifications/`. Keep the account on **Workers
Free**; none of these steps requires enabling Workers Paid or attaching billing.

1. Install the pinned dependencies and verify the code:

   ```sh
   npm ci
   npm test
   npm run worker:check
   npx wrangler login
   ```

2. Create the free D1 database:

   ```sh
   npx wrangler d1 create mymoney-notifications
   ```

   Copy its returned ID into `cloudflare/wrangler.jsonc`, replacing the all-zero
   `database_id`. The database name is already configured. Then apply the schema:

   ```sh
   npx wrangler d1 execute mymoney-notifications --remote --file cloudflare/schema.sql --config cloudflare/wrangler.jsonc
   ```

3. Generate VAPID keys locally once:

   ```sh
   node cloudflare/generate-keys.mjs
   ```

   The script prints only the public key. The private key is saved with owner-only
   file permissions in ignored `cloudflare/.secrets.json`; an existing key file
   is never overwritten. Keep it safe: changing VAPID keys invalidates existing
   browser subscriptions. Put the public key and a real contact email in the
   `VAPID_PUBLIC_KEY` and `VAPID_SUBJECT` variables in `wrangler.jsonc`. Confirm
   `FIREBASE_PROJECT_ID` and `ALLOWED_ORIGIN` refer to this app.

4. Upload the private secret and deploy:

   ```sh
   npx wrangler secret bulk cloudflare/.secrets.json --config cloudflare/wrangler.jsonc
   npx wrangler deploy --config cloudflare/wrangler.jsonc
   ```

   If Wrangler asks to create the Worker when uploading the first secret, use the
   configured `mymoney-notifications` name. Do not select a paid plan. The resulting
   `workers.dev` HTTPS URL requires no purchased domain.

5. Set the website's `MM_PUSH_CONFIG` to that `/subscriptions` URL and the public
   key, rebuild the website, then opt in from MyMoney Preferences on a real device.
   Check a real scheduled notification and Worker CPU/error metrics before calling
   automatic delivery operational. Cron configuration may take up to 15 minutes
   to propagate. Notifications are informational reminders, not guaranteed alarms.

## Free limits and deliberate beta limits

Verified against the official documentation on 29 October 2026:

| Resource | Workers Free allowance |
| --- | --- |
| Worker requests | 100,000/day |
| CPU per invocation, including cron | 10 ms |
| D1 rows read | 5,000,000/day |
| D1 rows written | 100,000/day |
| D1 storage | 5 GB/account |

The application caps registrations at **30 devices total and 5 per account**,
stores at most 14 reminders per device, and sends at most one per minute. This is
for personal testing/a small beta. If 30 devices have a reminder at the same time,
the last can arrive about 30 minutes later. Messages more than one hour late are
discarded. Retry-After and bounded exponential delays handle transient failures;
404/410 responses remove expired subscriptions. A process interruption between
push delivery and the database acknowledgement can still repeat an alert; stable
notification tags let the browser replace it.

The cron performs at most 1,440 delivery attempts daily and uses indexed queries;
housekeeping runs hourly. Actual CPU usage must be checked in Cloudflare after
deployment: passing Node tests or a local bundle does not prove the 10 ms runtime
budget on the hosted platform. If quota is exceeded on Free, operations fail;
this configuration does not switch plans or authorize charges. Larger launches
need a measured capacity design, rather than removing these caps blindly.

## Privacy and tests

Only subscription delivery keys, UID and future notification text are stored.
No Firebase Admin key, bank archive or spending history is uploaded. The default
notification text excludes amounts/names; optional detailed notifications include
the details the user explicitly enables. Data is generated when MyMoney refreshes
its plan, so the sender cannot know changes on another device until a new plan
arrives. A revocation cancels queued messages; an already dispatched push cannot
be recalled. Keep both the D1 database and private VAPID secret private.

`worker.test.mjs` executes the schema and application queries on real SQLite,
verifies Firebase JWT signatures with temporary test keys, checks cross-account
isolation, queue leases, cancellation, deduplication, retries and limits. It also
decrypts an actual WebCrypto push with an independent implementation and verifies
its VAPID JWT. No real notification is sent by tests. `worker:check` verifies the
Worker bundles for Cloudflare without Node compatibility or filesystem APIs.

Sources: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[D1 pricing and hard free quotas](https://developers.cloudflare.com/d1/platform/pricing/),
[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
The Web Push dependency is pinned to
[`@block65/webcrypto-web-push` 2.0.0 (MIT)](https://github.com/block65/webcrypto-web-push/tree/master/packages/web-push);
JWT verification uses `jose` (MIT). Dependencies retain their own licenses.
