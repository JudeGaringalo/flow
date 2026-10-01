import { ApiError, checkOrigin, failure, getServerDb, json, readJson } from '@/lib/server/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function validEndpoint(input: unknown): input is string {
  if (typeof input !== 'string' || input.length < 30 || input.length > 2048) return false;
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && (host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com'
        || host === 'web.push.apple.com' || host.endsWith('.push.apple.com')
        || host.endsWith('.notify.windows.com'));
  } catch { return false; }
}

function validKey(input: unknown, max: number): input is string {
  return typeof input === 'string' && input.length >= 16
    && input.length <= max && /^[A-Za-z0-9_-]+$/.test(input);
}

function subscriptionBody(body: Record<string, unknown>) {
  const subscription = body.subscription;
  if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription))
    throw new ApiError(400, 'Invalid push subscription');
  const value = subscription as Record<string, unknown>;
  const keys = value.keys;
  if (!keys || typeof keys !== 'object' || Array.isArray(keys))
    throw new ApiError(400, 'Invalid push subscription');
  const key = keys as Record<string, unknown>;
  if (!validEndpoint(value.endpoint) || !validKey(key.p256dh, 180) || !validKey(key.auth, 100))
    throw new ApiError(400, 'Invalid push subscription');
  return { endpoint: value.endpoint, p256dh: key.p256dh, auth: key.auth };
}

export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const body = await readJson(req);
    const { endpoint, p256dh, auth } = subscriptionBody(body);
    const latitude = body.latitude, longitude = body.longitude;
    if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180)
      throw new ApiError(400, 'Invalid location');
    const { data, error } = await getServerDb().rpc('flow_store_push_subscription', {
      p_endpoint: endpoint, p_p256dh: p256dh, p_auth_key: auth,
      p_latitude: Math.round(latitude * 1000) / 1000,
      p_longitude: Math.round(longitude * 1000) / 1000
    });
    if (error) throw error;
    if (data !== true) throw new ApiError(403, 'Subscription already belongs to another browser');
    return json({ saved: true });
  } catch (error) { return failure(error); }
}

export async function DELETE(req: Request) {
  try {
    checkOrigin(req);
    const body = await readJson(req);
    const { endpoint, p256dh, auth } = subscriptionBody(body);
    const { error } = await getServerDb().from('flow_push_subscriptions').delete()
      .eq('endpoint', endpoint).eq('p256dh', p256dh).eq('auth_key', auth);
    if (error) throw error;
    return json({ removed: true });
  } catch (error) { return failure(error); }
}
