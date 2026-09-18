import {
  checkOrigin,
  failure,
  getServerDb,
  json,
  readJson,
  requireUser,
  takeLimit,
  ApiError
} from '@/lib/server/runtime';
import { allowedPushEndpoint, subscriptionBody } from '@/lib/server/validation';

export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const user = await requireUser(req);
    if (!await takeLimit('push-user:' + user.id, 10))
      throw new ApiError(429, 'Rate limit');

    const body = await readJson(req), db = getServerDb();
    if (body.action === 'unsubscribe') {
      if (!allowedPushEndpoint(body.endpoint))
        throw new ApiError(400, 'Invalid endpoint');

      const { error } = await db.from('flow_push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', body.endpoint);
      if (error)
        throw error;

      return json({ unsubscribed: true });
    }

    if (body.action !== 'subscribe')
      throw new ApiError(400, 'Unknown action');

    const subscription = subscriptionBody(body.subscription);
    // SQL enforces ownership and the per-account subscription cap atomically.
    const { error } = await db.rpc('flow_store_subscription', {
      p_user_id: user.id,
      p_endpoint: subscription.endpoint,
      p_p256dh: subscription.p256dh,
      p_auth_key: subscription.auth_key,
    });
    if (error?.code === '42501' || error?.code === '23505')
      throw new ApiError(
        409,
        'This browser push subscription belongs to a different session. Remove it in that session first.'
      );

    if (error?.code === '54000')
      throw new ApiError(400, 'Maximum browser subscriptions reached');

    if (error)
      throw error;

    return json({ subscribed: true });
  }
  catch (error) {
    return failure(error);
  }
}
