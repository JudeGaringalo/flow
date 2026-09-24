# Live setup — one Next.js app, Supabase database

No Deno installation, Deno VS Code extension, Supabase CLI or separate Edge Function
deployment is required. Keep secrets out of Git and use a development project first.

## 1. Database (Supabase SQL Editor)

**New database:** run `supabase/migrations/001_flow.sql` once, then `002_node_api.sql`.
**Already applied the supplied 001 migration:** run only `002_node_api.sql`.

The original `flow_*` tables are kept. Migration 002 adds two server-only functions:
`flow_write_node` for transactional node/credential writes and `flow_store_subscription`
for ownership-safe push registration. It does not delete or reset records.

This schema is not an automatic migration for older tables named `devices` or
`sensor_readings`. Review that schema separately rather than dropping it.

## 2. Auth

Enable Supabase **anonymous sign-ins** for browser-specific AI requests and alert
preferences. Public map reads need no user login. Installer access requires a normal
email/password Auth user added to `flow_admins` by a project administrator:

```sql
insert into public.flow_admins(user_id) values ('YOUR_INSTALLER_USER_UUID');
```

The API verifies JWTs with `supabase.auth.getUser(token)` and checks installer role
membership server-side. Never trust a browser-provided user ID or an unverified token.
Use a separate browser profile for installer testing and anonymous push testing; this
starter does not transfer anonymous preferences to an installer account on login.
Add CAPTCHA/abuse protections and an anonymous-account retention policy before launch.

## 3. Environment variables

Use `.env.local` locally; the same names go into Vercel Project Settings > Environment
Variables for the intended environment. Copy `.env.example` only when `.env.local`
does not already exist. Preserve existing secrets.

### Required for real API operations

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_KEY
SUPABASE_SECRET_KEY=YOUR_PRIVATE_SERVER_KEY
```

Use an elevated Supabase secret key or the legacy service-role key in the **private**
`SUPABASE_SECRET_KEY` variable. Never use that value as the publishable key. The code
also accepts the prior `FLOW_SERVER_KEY` / `SUPABASE_SERVICE_ROLE_KEY` server variable
names, but **Supabase function secrets are not automatically available on Vercel**.

Private keys are read only in `lib/server/`, which is protected by `server-only` imports.
Client code receives only public configuration. Never import these server modules
into client components, and never log device tokens, user tokens or subscription keys.

### Optional Gemini

```env
GEMINI_API_KEY=YOUR_GOOGLE_AI_STUDIO_KEY
GEMINI_MODEL=YOUR_AVAILABLE_STRUCTURED_OUTPUT_MODEL
AI_REQUESTS_PER_MINUTE=10
```

Choose a currently available model in your own account; quota and free-tier availability
vary. With these values unset or with a model failure, the AI endpoint uses a **labeled
evidence-based fallback**, not fabricated predictions or fake Gemini prose.

The endpoint fetches approved node/current/history/nearby evidence. Gemini selects
whitelisted fact IDs; the server assembles the approved sentences and always includes
the measured current condition independently. It does not run user SQL or forecast
flood recession. Do not send private account/device information to the AI provider.

### Optional push

Run `npm run vapid` once. Save the generated values:

```env
NEXT_PUBLIC_VAPID_PUBLIC_KEY=GENERATED_PUBLIC_KEY
VAPID_PRIVATE_KEY=GENERATED_PRIVATE_KEY
VAPID_SUBJECT=mailto:YOUR_REAL_CONTACT_EMAIL
PUSH_WORKER_SECRET=GENERATED_RANDOM_WORKER_SECRET
```

Keep the VAPID pair stable after users subscribe; rotating it requires those browsers
to subscribe again. `PUSH_WORKER_SECRET` must be at least 32 random characters and
must match the Vault secret used by the retry job. Do not use a sample password.

`SITE_ORIGIN` is optional: by default browser operations must come from the API
request's same origin. Setting it restricts requests to that exact origin. Do not
leave a localhost origin configured for your production website. CORS is not an
authentication replacement; every sensitive endpoint independently authenticates.

## 4. Run / deploy

```sh
npm install
npm run check
npm run dev
```

Import the GitHub repo into Vercel with framework **Next.js**, Node.js **22.x** and
normal output settings. Rebuild after changing public variables. No public static
export (`output: 'export'`) is used: API routes require the server runtime.

Only deploy known-good code after checking type/build errors. No live connection is
created by merely copying the files or setting `NEXT_PUBLIC_FLOW_MODE`.

## 5. Register and connect hardware

The public menu now contains only Install FLOW and About observations. Node
administration is no longer linked there. Approved installers can still register,
edit, or rotate nodes through an authorized client calling `POST /api/register-node`
with a signed-in installer access token. If you need the former in-app installer
screen, give it a protected entry point before adding hardware. Register the actual
fixed coordinates and save the generated per-device token when it is returned. New
nodes stay unavailable until a genuine reading arrives.

Change the ESP32 endpoint to:

```text
POST https://YOUR-FLOW-SITE.vercel.app/api/ingest-reading
Content-Type: application/json
x-device-token: THE_NODE_SPECIFIC_TOKEN
```

The body contract is unchanged:

```json
{
  "device_id": "FLOW-QC-001",
  "message_id": "12345678-1234-4123-8123-123456789abc",
  "probes": [true, true, false],
  "rssi": -57,
  "firmware": "flow-0.1.0"
}
```

This is an example request, not a seeded node. Register your actual ID, generate a
new message UUID per snapshot, and reuse it only for an immediate retry of the same
message. SQL recomputes level and quality from booleans; a client cannot supply its
own authoritative severity. Do not replay old buffered packets as current readings.
See ESP32.md. This web package does not flash firmware or implement Wi-Fi onboarding.

Use the final **HTTPS** production URL, with no redirect. Requests to a protected
Preview deployment may receive Vercel's login page instead of JSON. Use a reachable
production API or configure deployment-protection access explicitly. A device token
is still required either way. Never embed your elevated Supabase key in firmware.

## 6. Push notifications and retry scheduling

Realtime updates an open map. Web Push is separate and requires supported browsers,
HTTPS, permission and an active subscription. iPhone/iPad requires a supported Home
Screen web app. Delivery depends on OS/browser/network policies; it is not guaranteed.

The database transaction creates `flow_push_jobs` only for valid upward transitions
matching a user's alert preference. Heartbeats do not create a notification. Faults,
downward transitions and stale readings do not trigger flood escalation push.

The ingestion route uses Next.js `after()` for an immediate bounded batch after a
successful state change. The **database outbox is durable**, while `after()` itself is
not. For retries and backlogs, enable Supabase Cron, pg_net and Vault. Store:

- `flow_app_origin`: your stable production origin, e.g. `https://YOUR-FLOW-SITE.vercel.app`.
- `flow_push_worker_secret`: exactly the same value as Vercel `PUSH_WORKER_SECRET`.
- Optional `flow_vercel_automation_bypass`: Vercel automation-bypass secret if the
  deployment is protected. Do not expose this secret to public browser code.

Run `supabase/schedule-push.sql`. It replaces the old FLOW retry schedules by name
and points them to `/api/push-dispatch`. No old Edge Function URL remains. This is
ordinary SQL scheduling, not a Deno process. It avoids requiring minute-frequency
Vercel Cron on Hobby, which only supports daily jobs. Every scheduler/API invocation
still uses the applicable service quotas; do not assume unlimited free operation.

Before scheduling, test privately in PowerShell using environment variables:

```powershell
Invoke-RestMethod -Method Post -Uri "$env:FLOW_APP_ORIGIN/api/push-dispatch" `
  -Headers @{"x-worker-secret"=$env:PUSH_WORKER_SECRET}
```

A successful response from an empty queue says `claimed: 0`. A 401 means worker
credentials failed; 503 means push is not configured. Verify the actual notification
on your phone after a real test transition; an HTTP 200 alone does not prove receipt.

The worker rechecks follows, observation freshness/version and approved push hosts,
leases jobs to prevent concurrent selection, retries failures and removes expired
subscriptions. Browser notification tags reduce repeated display. It is not an
exactly-once or emergency-grade transport. A hard timeout after sending but before
marking a job sent may produce a repeat.

## 7. Cutover from the old backend

Keep the same database and VAPID keys. Update the web callers and hardware endpoint,
copy needed private keys into Vercel, apply 002, and redirect the Cron job. Complete
a real end-to-end test. Only then remove/disable deployed old functions and old
function secrets. Deleting source locally does not undeploy a hosted function.

## 8. Acceptance and scope

Verify: unconfigured/empty map; real node with no observation; L1/L2/L3 transitions;
fault states; stale data; permission denial; unauthorized writes; user-specific alert
preferences; AI fallback and correct source version; queue retry; real browser push.

Still outside this prototype: certified public-safety operation, unmonitored road
conditions, continuous-depth/rainfall feeds, predictive countdown/recession,
city-scale pagination, historical offline ingestion, tamper-proof ESP32 credentials,
and account-transfer workflows. See QA.md and README.md for unverified deployment work.

## Primary references

- https://nextjs.org/docs/app/api-reference/file-conventions/route
- https://nextjs.org/docs/app/api-reference/functions/after
- https://supabase.com/docs/reference/javascript/auth-getuser
- https://supabase.com/docs/guides/database/extensions/pg_net
- https://supabase.com/docs/guides/functions/schedule-functions
- https://vercel.com/docs/cron-jobs/usage-and-pricing
- https://ai.google.dev/gemini-api/docs/structured-output
- https://github.com/web-push-libs/web-push
- https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
