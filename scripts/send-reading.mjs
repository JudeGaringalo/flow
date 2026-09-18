// Sends an actual authenticated TEST message to YOUR Supabase ingestion endpoint.
// Use only with your dedicated test node, never to fake readings on a deployed node.
import { randomUUID } from 'node:crypto';

const level = Number(process.argv[2] ?? 0);

if (!Number.isInteger(level) || level < 0 || level > 3)
  throw new Error('Usage: npm run send-reading -- 0|1|2|3');

const { FLOW_INGEST_URL, FLOW_DEVICE_TOKEN, FLOW_DEVICE_ID } = process.env;

if (!FLOW_INGEST_URL || !FLOW_DEVICE_TOKEN || !FLOW_DEVICE_ID)
  throw new Error('Set FLOW_INGEST_URL, FLOW_DEVICE_TOKEN and FLOW_DEVICE_ID in this shell.');

const response = await fetch(FLOW_INGEST_URL, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-device-token': FLOW_DEVICE_TOKEN
  },
  body: JSON.stringify(
    {
      device_id: FLOW_DEVICE_ID,
      message_id: randomUUID(),
      probes: [level >= 1, level >= 2, level >= 3],
      rssi: -50,
      firmware: 'manual-integration-test'
    }
  ),
  signal: AbortSignal.timeout(15000)
});

console.log(response.status, await response.text());

if (!response.ok)
  process.exitCode = 1;
