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
