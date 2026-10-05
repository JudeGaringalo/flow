import hazardBundle from './hazard-bundle.json';
import hazardOverview from './hazard-overview.json';
import hazard100 from './hazard-100.json';
import { createTileCache } from './tile-cache';

export type HazardScenario = '5yr' | '100yr';

const REVISION = '3820095a7e40b6bc852390d43a8c6d368d6fe081';
const ARCHIVE_ROOT = `https://huggingface.co/datasets/bettergovph/project-noah-hazard-maps/resolve/${REVISION}/PMTiles/layers`;

export const HAZARD_TILE_VERSION = process.env.NEXT_PUBLIC_NOAH_TILE_VERSION?.trim()
  || '3820095a7e40-v1';
export const HAZARD_ARCHIVES: Record<HazardScenario, string> = {
  '5yr': process.env.NEXT_PUBLIC_NOAH_5YR_PMTILES_URL?.trim()
    || `${ARCHIVE_ROOT}/flood_5yr.pmtiles`,
  '100yr': process.env.NEXT_PUBLIC_NOAH_100YR_PMTILES_URL?.trim()
    || `${ARCHIVE_ROOT}/flood_100yr.pmtiles`,
};

export function validHazardTile(scenario: string, z: number, x: number, y: number) {
  return (scenario === '5yr' || scenario === '100yr') &&
    Number.isInteger(z) && z >= 0 && z <= 14 &&
    Number.isInteger(x) && x >= 0 && x < 2 ** z &&
    Number.isInteger(y) && y >= 0 && y < 2 ** z;
}

export function tileIntersectsBounds(z: number, x: number, y: number,
  bounds: readonly number[]) {
  const [west, south, east, north] = bounds;
  const count = 2 ** z;
  const xAt = (longitude: number) => Math.max(0, Math.min(count - 1,
    Math.floor((longitude + 180) / 360 * count)));
  const yAt = (latitude: number) => Math.max(0, Math.min(count - 1,
    Math.floor((1 - Math.asinh(Math.tan(latitude * Math.PI / 180)) / Math.PI) / 2 * count)));
  return x >= xAt(west) && x <= xAt(east) &&
    y >= yAt(north) && y <= yAt(south);
}

export function hazardTileUrls(scenario: HazardScenario, z: number, x: number, y: number) {
  if (!validHazardTile(scenario, z, x, y)) throw new Error('Invalid hazard tile');
  const urls: string[] = [];
  if (scenario === '100yr' && hazard100.ready && z <= hazard100.maxzoom &&
      tileIntersectsBounds(z, x, y,
        z <= hazard100.overviewMaxzoom ? hazard100.overviewBounds : hazard100.detailBounds)) {
    urls.push(`/hazard/${hazard100.version}/${z}/${x}/${y}.pbf.gz`);
  }
  if (scenario === '5yr' && hazardOverview.ready && z <= hazardOverview.maxzoom &&
      tileIntersectsBounds(z, x, y, hazardOverview.bounds)) {
    urls.push(`/hazard/${hazardOverview.version}/${z}/${x}/${y}.pbf.gz`);
  }
  if (scenario === '5yr' && hazardBundle.ready && z >= hazardBundle.minzoom &&
      z <= hazardBundle.maxzoom && tileIntersectsBounds(z, x, y, hazardBundle.bounds)) {
    urls.push(`/hazard/${hazardBundle.version}/${z}/${x}/${y}.pbf`);
  }
  urls.push(`/api/hazard-tiles/${HAZARD_TILE_VERSION}/${scenario}/${z}/${x}/${y}.pbf`);
  return urls;
}

let cache: ReturnType<typeof createTileCache> | undefined;

function waitForRetry(delay: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, delay);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

export async function loadHazardTile(scenario: HazardScenario, z: number, x: number, y: number,
  signal: AbortSignal) {
  const urls = hazardTileUrls(scenario, z, x, y);
  cache ??= createTileCache({
    maxBytes: (typeof window !== 'undefined' && window.innerWidth <= 760 ? 8 : 24) * 1024 * 1024,
    maxEntries: 512,
    ttlMs: 86_400_000,
  });
  return cache.get(urls.join('|'), signal, async sharedSignal => {
    let index = 0;
    for (let attempt = 0; ; attempt++) {
      sharedSignal.throwIfAborted();
      const controller = new AbortController();
      const abort = () => controller.abort(sharedSignal.reason);
      sharedSignal.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(() => controller.abort(), 30_000);
      let delay = 600 * 2 ** attempt + Math.floor(Math.random() * 200);
      let retryable = false;
      try {
        if (sharedSignal.aborted) abort();
        for (; index < urls.length; index++) {
          const response = await fetch(urls[index], { signal: controller.signal });
          if (response.status === 200) {
            const contentType = response.headers.get('Content-Type') ?? '';
            if (/text\/|json|html/i.test(contentType)) {
              await response.body?.cancel();
              throw new Error('Invalid hazard tile response');
            }
            const data = new Uint8Array(await response.arrayBuffer());
            controller.signal.throwIfAborted();
            return data;
          }
          await response.body?.cancel();
          if (index === urls.length - 1) {
            retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
            const retryAfter = response.headers.get('Retry-After')?.trim();
            if (retryAfter) {
              const requestedDelay = /^\d+$/.test(retryAfter)
                ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
              if (Number.isFinite(requestedDelay)) {
                if (requestedDelay > 10_000) retryable = false;
                else delay = Math.max(delay, requestedDelay);
              }
            }
            throw new Error(`Hazard tile request failed (${response.status})`);
          }
        }
        throw new Error('Hazard tile unavailable');
      } catch (error) {
        sharedSignal.throwIfAborted();
        if (attempt >= 2 || !(retryable || controller.signal.aborted || error instanceof TypeError))
          throw error;
      } finally {
        clearTimeout(timeout);
        sharedSignal.removeEventListener('abort', abort);
      }
      await waitForRetry(delay, sharedSignal);
    }
  });
}
