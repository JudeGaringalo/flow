import { ApiError, failure, getServerDb, hashToken, json, readJson } from '@/lib/server/runtime';
import { readingBody } from '@/lib/server/validation';

export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const token = req.headers.get('x-device-token') || '';
    if (!/^[a-f0-9]{64}$/.test(token))
      throw new ApiError(401, 'Unauthorized');

    const body = readingBody(await readJson(req));
    const { data, error } = await getServerDb().rpc('flow_accept_reading', {
      p_node_id: body.device_id,
      p_token_hash: hashToken(token),
      p_message_id: body.message_id,
      p_probes: body.probes,
      p_rssi: body.rssi,
      p_firmware: body.firmware,
    });
    if (error?.code === '42501')
      throw new ApiError(401, 'Unauthorized');
    if (error)
      throw error;

    return json(data);
  }
  catch (error) {
    return failure(error);
  }
}
