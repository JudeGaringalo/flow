# ESP32 → FLOW request contract

Retain the current hardware assignments:

| Probe | GPIO | Detected wet |
| --- | ---: | --- |
| Level 1 | 32 | LOW |
| Level 2 | 33 | LOW |
| Level 3 | 25 | LOW |

A `true` JSON boolean means wet. The backend, not the client/AI, recomputes the state:

```text
false false false → Below first threshold
true  false false → Flood Advisory
true  true  false → Flood Watch
true  true  true  → Flood Warning
Any other combination → Sensor fault
```

Register the node through the installer UI, then store that node's device token in its firmware/configuration. Do not put a Supabase elevated key on the ESP32.

```http
POST https://YOUR-FLOW-SITE.vercel.app/api/ingest-reading
Content-Type: application/json
x-device-token: YOUR_NODE_SPECIFIC_TOKEN
```

```json
{
  "device_id": "FLOW-QC-001",
  "message_id": "28dba01b-fbad-4223-b185-3017b56349da",
  "probes": [true, true, false],
  "rssi": -57,
  "firmware": "flow-0.1.0"
}
```

The example represents Level 2. Coordinates are set once during installation and are not accepted in telemetry. A message ID must be a UUID; generate one per snapshot and reuse it only when retrying that exact snapshot.

## Firmware behavior

Debounce the raw probes before sending. Send on a stable raw-state change (including faults) and about every 30 seconds for a heartbeat. Keep sensor sampling independent from networking; use backoff and keep only one request in flight. Upon reconnection, send a **current** snapshot rather than replaying an old queue as current observations.

Use HTTPS with certificate verification. Do not use `setInsecure()` for deployment. The included cloud integration is not a substitute for validating electrical wiring, water conductivity, calibration, power isolation or weatherproofing.

The current API records receipt time. Offline event buffering and strict message-order protection across rebooted devices need additional protocol work before larger deployment.

## Test the API without the sensor

Use a dedicated test node—not a public real-world monitoring node.

Windows PowerShell:

```powershell
$env:FLOW_INGEST_URL="https://YOUR-FLOW-SITE.vercel.app/api/ingest-reading"
$env:FLOW_DEVICE_ID="FLOW-TEST-001"
$env:FLOW_DEVICE_TOKEN="YOUR_TEST_NODE_TOKEN"
npm run send-reading -- 0
npm run send-reading -- 1
npm run send-reading -- 2
npm run send-reading -- 3
```

Confirm the node's raw state, event history and marker change. Repeat an identical message ID to verify retries do not duplicate events. Send an inconsistent combination to verify it becomes a sensor fault. Stop sending for over 120 seconds and verify the current condition becomes unavailable.

No Wi-Fi provisioning firmware is bundled. The web application's setup instructions describe the intended local ESP32 portal flow; they do not create a captive portal themselves.

## Backend cutover

This version receives telemetry in Next.js on Vercel, not a Supabase Edge Function.
The same per-device token and three-boolean JSON contract are retained. Update the
firmware URL to the actual HTTPS production `/api/ingest-reading` endpoint. Never use
the elevated Supabase server key in the ESP32. Register actual installation coordinates
once in the installer UI. The web ZIP does not change or upload firmware automatically.
