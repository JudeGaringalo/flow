import { after } from 'next/server';
import { ApiError, failure, getServerDb, hashToken, json, readJson, takeLimit } from '@/lib/server/runtime';
import { readingBody } from '@/lib/server/validation';
import { dispatchPushJobs, pushConfigured } from '@/lib/server/push';

export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const token = req.headers.get('x-device-token') || '';
    if (!/^[a-f0-9]{64}$/.test(token))
      throw new ApiError(401, 'Unauthorized');

    const body = readingBody(await readJson(req));
    const db = getServerDb();
    const { data: credential, error: lookupError } = await db.from('flow_device_keys').select('node_id')
      .eq('node_id', body.device_id)
      .eq(
        'token_hash',
        hashToken(token)
      )
      .maybeSingle();
    if (lookupError)
      throw lookupError;

    if (!credential)
      throw new ApiError(401, 'Unauthorized');

    if (!await takeLimit('node:' + body.device_id, 120))
      throw new ApiError(429, 'Device rate limit');

    const { data, error } = await db.rpc('flow_accept_reading', {
      p_node_id: body.device_id,
      p_message_id: body.message_id,
      p_probes: body.probes,
      p_rssi: body.rssi,
      p_firmware: body.firmware,
    });
    if (error)
      throw error;

    // DB state/history/outbox commit before the response. A failed push cannot
    // undo ingestion. after() is bounded work, NOT a durable queue or a timer.
    if (data?.changed && pushConfigured()) {
      after(
        async () => {
          try {
            await dispatchPushJobs(8);
          }
          catch {
            console.error('FLOW immediate push dispatch failed; pending jobs remain in the outbox.');
          }
        }
      );
    }

    return json(data);
  }
  catch (error) {
    return failure(error);
  }
}
