import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';

export const runtime = 'nodejs';
export const maxDuration = 20;

const SOURCE = 'https://services1.arcgis.com/IwZZTMxZCmAmFYvF/ArcGIS/rest/services/Flood_Control_5_Year/FeatureServer/0/query';
const NCR = [120.85, 14.32, 121.30, 14.86];
const MAX_FEATURES = 2000;

interface HazardFeature {
  type: 'Feature';
  geometry: Polygon | MultiPolygon;
  properties: { Var: number };
}

class HazardSourceError extends Error {
  constructor(readonly reason: string) { super(reason); }
}

function boundedBox(raw: string | null) {
  if (!raw) return null;
  const numbers = raw.split(',').map(Number);
  if (numbers.length !== 4 || numbers.some(n => !Number.isFinite(n))) return null;
  const [west, south, east, north] = numbers;
  if (west >= east || south >= north || east - west > .25 || north - south > .25)
    return null;
  const box = [
    Math.max(west, NCR[0]), Math.max(south, NCR[1]),
    Math.min(east, NCR[2]), Math.min(north, NCR[3]),
  ];
  if (box[0] >= box[2] || box[1] >= box[3]) return [];
  return box;
}

async function query(params: URLSearchParams) {
  let response: Response;
  try {
    response = await fetch(`${SOURCE}?${params}`, {
      signal: AbortSignal.timeout(8500),
      next: { revalidate: 21600 },
    });
  } catch (error) {
    throw new HazardSourceError(error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout' : 'network');
  }
  if (!response.ok) throw new HazardSourceError(`upstream_http_${response.status}`);
  let result: unknown;
  try { result = await response.json(); }
  catch { throw new HazardSourceError('invalid_json'); }
  if (!result || typeof result !== 'object' || 'error' in result)
    throw new HazardSourceError('upstream_error');
  return result;
}

export async function GET(request: Request) {
  const box = boundedBox(new URL(request.url).searchParams.get('bbox'));
  if (box === null) return Response.json({ error: 'Invalid map area.' }, { status: 400 });
  if (!box.length) return Response.json({ type: 'FeatureCollection', features: [] });

  const params = new URLSearchParams({
    where: '1=1', geometry: box.join(','),
    geometryType: 'esriGeometryEnvelope', inSR: '4326', outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', f: 'json',
  });

  let stage = 'count';
  try {
    params.set('returnCountOnly', 'true');
    const countResult = await query(params) as { count?: unknown };
    const count = countResult.count;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)
      throw new HazardSourceError('invalid_count');
    if (count > MAX_FEATURES) return Response.json(
      { error: 'Zoom in to view the detailed hazard map.' },
      { status: 422, headers: { 'Cache-Control': 'public, s-maxage=300' } },
    );
    if (count === 0) return Response.json(
      { type: 'FeatureCollection', features: [] },
      { headers: { 'Cache-Control': 'public, s-maxage=3600' } },
    );

    stage = 'features';
    params.delete('returnCountOnly');
    params.set('outFields', 'Var');
    params.set('returnGeometry', 'true');
    params.set('resultRecordCount', String(MAX_FEATURES));
    params.set('maxAllowableOffset', '0.00002');
    params.set('geometryPrecision', '5');
    params.set('f', 'geojson');
    const data = await query(params) as Partial<FeatureCollection> & { exceededTransferLimit?: boolean };
    if (data.type !== 'FeatureCollection' || !Array.isArray(data.features) ||
        data.exceededTransferLimit || data.features.length !== count)
      throw new HazardSourceError('incomplete_features');

    const features: HazardFeature[] = data.features.flatMap(feature => {
      if (!feature || feature.type !== 'Feature' ||
          (feature.geometry?.type !== 'Polygon' && feature.geometry?.type !== 'MultiPolygon') ||
          !Array.isArray(feature.geometry.coordinates) ||
          ![1, 2, 3].includes(Number(feature.properties?.Var))) return [];
      return [{
        type: 'Feature' as const,
        geometry: feature.geometry,
        properties: { Var: Number(feature.properties?.Var) },
      }];
    });
    const payload = JSON.stringify({ type: 'FeatureCollection', features });
    if (payload.length > 3_000_000) return Response.json(
      { error: 'Zoom in to view the detailed hazard map.' },
      { status: 422, headers: { 'Cache-Control': 'public, s-maxage=300' } },
    );
    return new Response(payload, { headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    } });
  } catch (error) {
    const reason = error instanceof HazardSourceError ? error.reason : 'processing_error';
    console.error('Flood hazard request failed', { stage, reason });
    return Response.json({ error: 'Flood-hazard map unavailable. Try again later.', stage, reason },
      { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
