import {
  checkOrigin,
  failure,
  getServerDb,
  hashToken,
  json,
  newDeviceToken,
  readJson,
  requireAdmin,
  takeLimit,
  ApiError
} from '@/lib/server/runtime';
import { nodeBody } from '@/lib/server/validation';

export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const user = await requireAdmin(req);
    if (!await takeLimit('admin:' + user.id, 20))
      throw new ApiError(429, 'Rate limit');

    const body = nodeBody(await readJson(req));
    const token = body.action === 'update' ? null : newDeviceToken();
    // One transaction: node registration and credential creation cannot split.
    const { data, error } = await getServerDb()
      .rpc('flow_write_node', {
        p_action: body.action,
        p_id: body.id,
        p_name: 'name' in body ? body.name : null,
        p_area: 'area' in body ? body.area : '',
        p_latitude: 'latitude' in body ? body.latitude : null,
        p_longitude: 'longitude' in body ? body.longitude : null,
        p_token_hash: token ? hashToken(token) : null,
      });
    if (error?.code === '23505')
      throw new ApiError(409, 'This node ID is already registered. Use Edit or Rotate token.');

    if (error?.code === 'P0002')
      throw new ApiError(404, 'Node not found');

    if (error)
      throw error;

    return json(token ? {
      id: body.id,
      device_token: token
    } : data);
  }
  catch (error) {
    return failure(error);
  }
}
