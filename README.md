# FLOW — Next.js + Supabase, no Deno

**Flood-Level Observation & Warning**

One Next.js App Router / TypeScript application on Vercel. The website **and** the
five backend API endpoints use the Node.js runtime. Supabase provides the existing
PostgreSQL database, Auth and Realtime. Google Gemini is an optional external AI
service. No Supabase Edge Functions, Deno executable, Deno extension, Docker or
Supabase CLI is required for this setup.

## Start

Use Node.js 22. In the project root:

```sh
npm install
npm run dev
```

Open `http://localhost:3000`. The same map-first UI opens without backend credentials.
There are **no sample nodes, mock readings, fake histories or artificial timestamps**.
An unconfigured backend leaves the sensor map empty. Regular street labels/POIs
come from the basemap and are not FLOW sensor markers.

To connect real services, preserve your `.env.local` if you already have one.
Otherwise copy `.env.example` to `.env.local`. Read [live setup](docs/LIVE_SETUP.md).

## What changed

| Operation | Now runs at |
| --- | --- |
| ESP32 telemetry ingestion | `POST /api/ingest-reading` |
| Installer node registration/edit/token rotation | `POST /api/register-node` |
| Grounded Gemini/evidence summaries | `POST /api/flow-intelligence` |
| Web Push subscription management | `POST /api/manage-push` |
| Durable push outbox dispatch/retries | `POST /api/push-dispatch` |

All five are Next.js `route.ts` handlers with `runtime = 'nodejs'`. Browser API
calls now use the same website origin. Sensor data reads and Realtime still use
Supabase directly, under Row Level Security. No database records are seeded or deleted
by this source migration.

The layout, styling, supplied assets, map, bottom sheet, search, bookmarks, history,
installer UI and alert preferences are retained. Only two UI explanation strings
were updated to describe the new backend location. The former `supabase/functions`
folder and function deployment config are removed.

**Private credentials now belong in `.env.local` / Vercel Environment Variables**, not
only in Supabase function secrets. Never put them in a `NEXT_PUBLIC_` variable.

## Existing project

See [migration instructions](docs/MIGRATE_FROM_EDGE.md). Back up first; this update is
based on the supplied live-only ZIP, not a read of your current GitHub/local changes.
Use the patch rather than overwriting your whole project when you have local edits.

## Architecture

```text
ESP32 -- Wi-Fi/HTTPS + device token --> Next.js /api/ingest-reading
                                           |
                                    Supabase PostgreSQL
                                    state + history + outbox
                                      |               |
                            Realtime Broadcast     Next.js push dispatcher
                                      |               |
                                 FLOW map          Web Push service worker

Tap a node --> Next.js /api/flow-intelligence --> approved Supabase evidence --> Gemini
```

The app displays only registered nodes. A newly registered node stays **Data unavailable**
until a real report arrives. Faulty, missing and stale reports never become a claimed
current dry state. The three inputs are GPIO32 (L1), GPIO33 (L2) and GPIO25 (L3).

## Database

For a **new** development database, run `supabase/migrations/001_flow.sql`, then
`002_node_api.sql` in Supabase SQL Editor. For an existing database with the supplied
`flow_*` schema, run **only `002_node_api.sql`**. It adds atomic registration and push
subscription helpers without dropping/recreating tables. Review all SQL before use.

`supabase/` now contains SQL only, not a second JavaScript runtime. Do not delete it.

## Deployment

Push the project to GitHub and import it into Vercel as **Next.js**, Node 22.x.
Keep the standard Next.js build/output settings. Add your environment variables and
redeploy. Put only public browser keys in `NEXT_PUBLIC_` variables.

A Vercel deployment does not automatically apply SQL, configure Supabase Auth,
register devices, update ESP32 firmware, or enable push permissions. Those steps
are documented in [LIVE_SETUP.md](docs/LIVE_SETUP.md).

## Web Push retries

Push uses the existing durable PostgreSQL outbox. New transitions try a bounded
immediate dispatch using Next.js `after()`. A Supabase Cron SQL job calls the private
Next.js `/api/push-dispatch` endpoint each minute to retry missed jobs. It is a
scheduler in your existing database, **not Deno or another application server**.
No once-per-minute Vercel Cron configuration is included because Hobby cron does
not support that frequency. See `supabase/schedule-push.sql` and the live setup guide.

Do not rely on `after()` alone for guaranteed delivery. Requests, services, device
permissions and connections can fail. Queue retries are bounded; notifications can
still be delayed, repeated or not delivered. This prototype is not an official
emergency warning or road-passability service.

## Commands

```sh
npm test                 # Pure sensor checks + isolated Node API tests
npm run check:syntax     # Syntax only
npm run typecheck        # Full dependency-aware TypeScript check
npm run build            # Actual Next.js production build
npm run check            # Typecheck + tests + production build
npm run vapid            # Generate Web Push keys; keep private output private
npm run send-reading -- 2 # Explicit test sender; only a dedicated test node
```

## Verification and limits

During this delivery: **86 automated checks passed** (32 core, 14 live-only,
40 isolated backend/API checks), and all 27 TS/TSX source files passed syntax checking.
Backend tests mock the Supabase SDK, network and Next.js lifecycle. They do not
establish live service or deployment compatibility.

The npm registry was not reachable from this environment, so dependency installation,
full project type-check, `next build`, Vercel deployment, SQL migration execution,
actual sensor uploads, real Gemini calls and device Web Push were **not verified**.
Run `npm run check` locally after `npm install`, then follow the live acceptance tests.
A lockfile was not fabricated. Preserve your existing lockfile, run npm install and
commit the updated result. See [QA.md](docs/QA.md).

The live code does not generate continuous depth, rainfall, Critical Level 4,
flood-recession predictions or safe routes. Unsupported cards remain unavailable.

## Keep these folders

`app/`, `components/`, `hooks/`, `lib/`, `public/`, `supabase/`, `scripts/`.
`.next/` is disposable build output after stopping the dev server. `node_modules/`
is reinstallable but need not be deleted for this migration. Preserve `.git/`,
`.env.local`, `package.json`, your lockfile and any local project customizations.

## Official implementation references

- Next.js Route Handlers: https://nextjs.org/docs/app/api-reference/file-conventions/route
- Next.js after: https://nextjs.org/docs/app/api-reference/functions/after
- Supabase getUser: https://supabase.com/docs/reference/javascript/auth-getuser
- Supabase pg_net: https://supabase.com/docs/guides/database/extensions/pg_net
- Vercel cron plan limits: https://vercel.com/docs/cron-jobs/usage-and-pricing
- Gemini structured outputs: https://ai.google.dev/gemini-api/docs/structured-output
- Web Push signing/encryption: https://github.com/web-push-libs/web-push
