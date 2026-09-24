# FLOW: ESP32 flood observations on a public map

FLOW is a Next.js map of the latest reading from each registered ESP32. Everyone
can view the sensor map without signing in. The menu contains Install FLOW (the
web app) and About observations. The map is centered on Metro Manila and can zoom
out as far as the Philippines.

There is **one FLOW application table**: `public.flow_nodes`. It contains the
registered location, latest three threshold probes, last report time and a
private device-token hash. Public database permissions exclude the token hash.

The private `POST /api/register-node` route registers/edits sensors using a
server-only installer secret. The ESP32 sends its token and reading to
`POST /api/ingest-reading`. The database checks the token and updates the latest
row; Realtime tells open maps to refresh. No historical readings, notifications,
AI summaries, saved locations, FLOW admin accounts or rate-limit tables are used.

## Start

```sh
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and configure the Supabase URL, public key,
private server key and a private installer secret. For sensor registration and
firmware requests, see [live setup](docs/LIVE_SETUP.md).

The one-table schema must be applied to your hosted Supabase project before the
app runs. Once it has been applied, the local `supabase/` directory of SQL files
can be deleted; neither the app nor its build reads it. Check the hosted database
using the query in [live setup](docs/LIVE_SETUP.md). Removing the local directory
does not drop existing database tables.

The one-table migration for an existing project keeps the latest sensor row and
copies device-token hashes before dropping the other FLOW tables. The Supabase
platform may have its own tables under `auth` and `realtime`; those are not FLOW
tables.

Run `npm run check` before deployment. TypeScript and API tests use local mocks;
verify real hardware and Supabase separately. Stale or faulty readings do not
establish that a road is safe.
