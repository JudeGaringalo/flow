import type { FeatureCollection, LineString, Point } from 'geojson';

export type TravelMode = 'walking' | 'driving';
export interface RouteOrigin {
  latitude: number;
  longitude: number;
  accuracy?: number;
}
export interface RouteDestination {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  kind?: 'evacuation' | 'help-report';
}
export interface EvacuationRoute {
  mode: TravelMode;
  origin: RouteOrigin;
  destination: RouteDestination;
  geometry: LineString;
  distance: number;
  duration: number;
  accessDistance: number;
}

const ROUTERS: Record<TravelMode, string> = {
  walking: 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/',
  driving: 'https://routing.openstreetmap.de/routed-car/route/v1/driving/',
};
let nextRequestAt = 0;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function point(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 &&
    typeof value[0] === 'number' && Number.isFinite(value[0]) && Math.abs(value[0]) <= 180 &&
    typeof value[1] === 'number' && Number.isFinite(value[1]) && Math.abs(value[1]) <= 90;
}

export function routingLocation(latitude: number, longitude: number) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= 4 && latitude <= 22 && longitude >= 112 && longitude <= 128;
}

export function parseEvacuationRoute(payload: unknown, origin: RouteOrigin,
  destination: RouteDestination, mode: TravelMode): EvacuationRoute {
  const body = object(payload);
  if (body.code === 'NoRoute' || body.code === 'NoSegment')
    throw new Error(destination.kind === 'help-report'
      ? 'No mapped route reaches this reported location.'
      : 'No mapped route connects your location to this site. Try another evacuation center.');
  const raw = object(Array.isArray(body.routes) ? body.routes[0] : null);
  const geometry = object(raw.geometry);
  const coordinates = geometry.coordinates;
  if (body.code !== 'Ok' || geometry.type !== 'LineString' ||
      !Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > 50_000 ||
      !coordinates.every(point) || typeof raw.distance !== 'number' ||
      !Number.isFinite(raw.distance) || raw.distance < 0 ||
      typeof raw.duration !== 'number' || !Number.isFinite(raw.duration) || raw.duration < 0)
    throw new Error('The routing service returned an incomplete route. Please try again.');

  const lastWaypoint = object(Array.isArray(body.waypoints) ? body.waypoints.at(-1) : null);
  const accessDistance = typeof lastWaypoint.distance === 'number' &&
    Number.isFinite(lastWaypoint.distance) && lastWaypoint.distance >= 0 ? lastWaypoint.distance : 0;
  return { mode, origin, destination, geometry: { type: 'LineString', coordinates },
    distance: raw.distance, duration: raw.duration, accessDistance };
}

function waitForRequest(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export async function fetchEvacuationRoute(origin: RouteOrigin,
  destination: RouteDestination, mode: TravelMode, signal: AbortSignal) {
  if (!routingLocation(origin.latitude, origin.longitude))
    throw new Error('Routing is available from locations within the Philippines.');
  if (!routingLocation(destination.latitude, destination.longitude) ||
      (mode !== 'walking' && mode !== 'driving'))
    throw new Error('This destination does not have valid routing coordinates.');
  signal.throwIfAborted();
  const now = Date.now();
  const requestAt = Math.max(now, nextRequestAt);
  nextRequestAt = requestAt + 1100;
  await waitForRequest(requestAt - now, signal);
  signal.throwIfAborted();

  const coordinates = [origin, destination]
    .map(p => `${p.longitude.toFixed(6)},${p.latitude.toFixed(6)}`).join(';');
  const url = new URL(ROUTERS[mode] + coordinates);
  url.search = new URLSearchParams({ geometries: 'geojson', overview: 'full',
    steps: 'false', alternatives: 'false', generate_hints: 'false', radiuses: '250;250' }).toString();
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (response.status === 429)
      throw new Error('The routing service is busy. Wait a moment and try again.');
    if (!response.ok && response.status !== 400)
      throw new Error('Routing is temporarily unavailable. Please try again.');
    return parseEvacuationRoute(await response.json(), origin, destination, mode);
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (controller.signal.aborted || error instanceof TypeError)
      throw new Error('Could not reach the routing service. Check your connection and retry.');
    if (error instanceof SyntaxError)
      throw new Error('The routing service returned an incomplete route. Please try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
}

export function evacuationRouteData(route: EvacuationRoute): FeatureCollection<LineString | Point> {
  const coordinates = route.geometry.coordinates;
  return { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { kind: 'route' }, geometry: route.geometry },
    { type: 'Feature', properties: { kind: 'start' },
      geometry: { type: 'Point', coordinates: coordinates[0] } },
    { type: 'Feature', properties: { kind: 'destination', destinationKind: route.destination.kind ?? 'evacuation' },
      geometry: { type: 'Point', coordinates: coordinates.at(-1)! } },
  ] };
}
