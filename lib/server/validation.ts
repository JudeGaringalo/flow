import 'server-only';
import { ApiError, validId } from './runtime';

export function readingBody(body: Record<string, unknown>) {
  if (!validId(body.device_id))
    throw new ApiError(400, 'Invalid device_id');

  if (typeof body.message_id !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.message_id)) {
    throw new ApiError(400, 'message_id must be a UUID');
  }

  if (!Array.isArray(body.probes) || body.probes.length !== 3
    || body.probes.some(p => typeof p !== 'boolean')) {
    throw new ApiError(400, 'probes must be three booleans: [L1_wet, L2_wet, L3_wet]');
  }

  const rssi = body.rssi ?? null, firmware = body.firmware ?? null;
  if (rssi !== null
    && (typeof rssi !== 'number' || !Number.isInteger(rssi) || rssi > 0 || rssi < -127))
    throw new ApiError(400, 'Invalid RSSI');

  if (firmware !== null && (typeof firmware !== 'string' || firmware.length > 40))
    throw new ApiError(400, 'Invalid firmware version');

  // Invalid physical combinations are recorded as a sensor fault by the database,
  // never discarded or converted into a claimed safe/below-threshold reading.
  return {
    device_id: body.device_id,
    message_id: body.message_id,
    probes: body.probes as [
      boolean,
      boolean,
      boolean
    ],
    rssi: rssi as number | null,
    firmware: firmware as string | null
  };
}

export function nodeBody(body: Record<string, unknown>) {
  if (!validId(body.id))
    throw new ApiError(400, 'Node ID must use uppercase letters, digits and hyphens (3–40 characters).');

  if (body.action !== 'create' && body.action !== 'update' && body.action !== 'rotate')
    throw new ApiError(400, 'Unknown action');

  if (body.action === 'rotate')
    return {
      id: body.id,
      action: body.action
    } as const;

  if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 80)
    throw new ApiError(400, 'Location name is required (maximum 80 characters).');

  if (typeof body.latitude !== 'number' || !Number.isFinite(body.latitude)
    || Math.abs(body.latitude) > 90
    ||
    typeof body.longitude !== 'number'
    || !Number.isFinite(body.longitude)
    || Math.abs(body.longitude) > 180)
    throw new ApiError(400, 'Invalid coordinates');

  if (body.area !== undefined && (typeof body.area !== 'string' || body.area.length > 100))
    throw new ApiError(400, 'Invalid area (maximum 100 characters).');

  return {
    id: body.id,
    action: body.action,
    name: body.name.trim(),
    area: (body.area || '') as string,
    latitude: body.latitude,
    longitude: body.longitude
  };
}

const PUSH_DOMAINS = ['fcm.googleapis.com', 'push.services.mozilla.com', 'web.push.apple.com', 'notify.windows.com'];

export function allowedPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 2048)
    return false;

  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash
      &&
      PUSH_DOMAINS.some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain));
  }
  catch {
    return false;
  }
}

export function subscriptionBody(value: unknown) {
  if (!value || typeof value !== 'object')
    throw new ApiError(400, 'Invalid subscription');

  const s = value as {
    endpoint?: unknown;
    keys?: {
      p256dh?: unknown;
      auth?: unknown;
    };
  };
  if (!allowedPushEndpoint(s.endpoint))
    throw new ApiError(400, 'Push service endpoint is not allowed');

  const p = s.keys?.p256dh, a = s.keys?.auth;
  if (typeof p !== 'string' || typeof a !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(p)
    || !/^[A-Za-z0-9_-]+={0,2}$/.test(a)) {
    throw new ApiError(400, 'Invalid subscription keys');
  }

  const publicKey = Buffer.from(p, 'base64url'),
    auth = Buffer.from(a, 'base64url');
  if (p.length > 100 || a.length > 32 || publicKey.length !== 65 || publicKey[0] !== 4
    || auth.length !== 16)
    throw new ApiError(400, 'Invalid subscription keys');

  return {
    endpoint: s.endpoint,
    p256dh: p,
    auth_key: a
  };
}
