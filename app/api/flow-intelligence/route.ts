import { ApiError, checkOrigin, failure, json, readJson, requireUser, validId } from '@/lib/server/runtime';
import { summarizeNode } from '@/lib/server/intelligence';

export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const user = await requireUser(req), body = await readJson(req);
    if (!validId(body.node_id))
      throw new ApiError(400, 'Invalid node ID');

    return json(await summarizeNode(body.node_id, user.id));
  }
  catch (error) {
    return failure(error);
  }
}
