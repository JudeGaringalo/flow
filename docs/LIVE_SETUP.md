# FLOW live setup

FLOW stores one latest reading per ESP32 in `public.flow_nodes`. The public map reads
those rows directly and uses Supabase Realtime to refresh when a node changes. Only
the private Next.js API can write a node or accept a device reading.

## Database

The one-table schema must already be applied to the hosted Supabase database.
Local SQL files are not used at runtime and can be deleted after their SQL has
run successfully. Deleting files does not apply SQL or remove old database tables.
In Supabase SQL Editor, check which FLOW tables actually exist:

```sql
select tablename
from pg_tables
where schemaname = 'public' and tablename ~ '^flow_'
order by tablename;
```

For this version of FLOW, that query should return only `flow_nodes`. If it
returns old FLOW tables, the one-table cleanup has not completed; run that
database migration before using this version. Also confirm the sensor rows and
device-token hashes were carried over. If no `flow_nodes` table exists, first
apply the one-table schema to the hosted project. SQL Editor history or a
previously saved migration can provide the SQL; this code patch does not include
SQL files.

`flow_nodes` stores the device ID, registered coordinates, the latest probes/status,
last seen time, token hash and most recent message UUID. Public clients can select
only the observation columns. The token hash is never returned to the browser.
Supabase's internal Auth and Realtime tables are managed by Supabase and are separate
from FLOW application tables.

## Server keys

Copy `.env.example` to `.env.local`, then set:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_KEY
SUPABASE_SECRET_KEY=YOUR_PRIVATE_SERVER_KEY
FLOW_INSTALLER_SECRET=YOUR_RANDOM_32_PLUS_CHARACTER_SECRET
```

Set the same variables in your hosting environment. Keep both private keys out of
Git, browser code and ESP32 firmware. `FLOW_INSTALLER_SECRET` is used only in a
private terminal when creating or editing a sensor. There are no FLOW admin accounts.
Public visitors need no sign-in.

## Register your ESP32

On Windows PowerShell, set `FLOW_APP_ORIGIN` to your deployed HTTPS site and
`FLOW_INSTALLER_SECRET` to the value configured on the server. Then run:

```powershell
$headers = @{ 'x-flow-installer-secret' = $env:FLOW_INSTALLER_SECRET }
$body = @{ action = 'create'; id = 'FLOW-TEST-001'; name = 'Test sensor'; area = 'Test area'; latitude = 14.5; longitude = 121.0 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$env:FLOW_APP_ORIGIN/api/register-node" -Headers $headers -ContentType 'application/json' -Body $body
```

Use the real sensor ID and fixed location. A create response returns a new
`device_token` exactly once. Store it securely in that ESP32's configuration.
`action = 'update'` edits its name/location; `action = 'rotate'` with its ID
issues a replacement token. The installer secret and device token are different.
The sensor shows as unavailable until it sends a real reading.

## Send a reading

The ESP32 posts to `https://YOUR-FLOW-SITE/api/ingest-reading` with header
`x-device-token: THE_NODE_SPECIFIC_TOKEN` and JSON:

```json
{
  "device_id": "FLOW-TEST-001",
  "message_id": "12345678-1234-4123-8123-123456789abc",
  "probes": [true, true, false],
  "rssi": -57,
  "firmware": "flow-0.1.0"
}
```

Use a new UUID for each snapshot; reuse it only for an immediate retry of that
same snapshot. The server verifies the device token inside the database
transaction and calculates Level 0–3 from the three boolean probes. A faulty
probe combination is displayed as a sensor fault. Heartbeats refresh the last
seen time. FLOW remembers only the most recent message UUID, so this is not a
full historical replay log.

## Run and check

```sh
npm install
npm run check
npm run dev
```

Verify that an unregistered device token is refused, a valid ESP32 report appears
on the public map, and a stale/disconnected reading shows as unavailable. Install
FLOW from the public menu if you want it on a phone's Home Screen; that is a web
app install, separate from registering an ESP32. This prototype is not an official
flood warning or road safety service.
