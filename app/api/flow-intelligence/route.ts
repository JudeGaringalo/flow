import { getNodeIntelligence } from '@/lib/server/intelligence';
import { ApiError, checkOrigin, failure, json, validId } from '@/lib/server/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

export async function GET(req: Request) {
  try {
    checkOrigin(req);
    const nodeId = new URL(req.url).searchParams.get('node_id');
    if (!validId(nodeId)) throw new ApiError(400, 'A valid node_id is required.');
    return json(await getNodeIntelligence(nodeId));
  } catch (error) {
    return failure(error);
  }
}
