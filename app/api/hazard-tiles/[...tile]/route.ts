import { EtagMismatch, PMTiles, type RangeResponse, type Source } from 'pmtiles';
import {
  HAZARD_ARCHIVES,
  HAZARD_TILE_VERSION,
  validHazardTile,
  type HazardScenario,
} from '@/lib/hazard-tiles';
import { createTileCache } from '@/lib/tile-cache';

export const runtime = 'nodejs';
export const maxDuration = 30;

class TimedSource implements Source {
  private resolvedUrl: string;

  constructor(private readonly url: string) {
    this.resolvedUrl = url;
  }

  getKey() { return this.url; }

  async getBytes(offset: number, length: number, signal?: AbortSignal,
    etag?: string): Promise<RangeResponse> {
    const timeout = AbortSignal.timeout(20_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const options = {
      signal: requestSignal,
      headers: { Range: `bytes=${offset}-${offset + length - 1}` },
      cache: 'no-store' as const,
    };
    let response = await fetch(this.resolvedUrl, options);
    if ((response.status === 401 || response.status === 403) && this.resolvedUrl !== this.url) {
      await response.body?.cancel();
      this.resolvedUrl = this.url;
      response = await fetch(this.url, options);
    }
    if (response.status !== 206 && response.status !== 200) {
      await response.body?.cancel();
      throw new Error(`Archive range unavailable (${response.status})`);
    }
    const contentLength = Number(response.headers.get('Content-Length'));
    if (response.status === 200 && (!contentLength || contentLength > length)) {
      await response.body?.cancel();
      throw new Error('The archive host does not support range requests');
    }
    const currentEtag = response.headers.get('ETag');
    const strongEtag = currentEtag && !currentEtag.startsWith('W/') ? currentEtag : undefined;
    if (etag && strongEtag && etag !== strongEtag) {
      await response.body?.cancel();
      throw new EtagMismatch('The archive changed during a tile request');
    }
    const data = await response.arrayBuffer();
    requestSignal.throwIfAborted();
    if (data.byteLength > length) throw new Error('Invalid archive range response');
    if (response.url) this.resolvedUrl = response.url;
    return {
      data,
      etag: strongEtag,
      cacheControl: response.headers.get('Cache-Control') ?? undefined,
      expires: response.headers.get('Expires') ?? undefined,
    };
  }
}

const archives = new Map<HazardScenario, PMTiles>();
const tiles = createTileCache({
  maxBytes: 32 * 1024 * 1024,
  maxEntries: 512,
  ttlMs: 86_400_000,
});

export async function GET(request: Request,
  { params }: { params: Promise<{ tile: string[] }> }) {
  const { tile } = await params;
  const [version, scenario, rawZ, rawX, rawY] = tile;
  if (tile.length !== 5 || version !== HAZARD_TILE_VERSION ||
      !/^(0|[1-9]\d?)$/.test(rawZ ?? '') ||
      !/^(0|[1-9]\d{0,4})$/.test(rawX ?? '') ||
      !/^(0|[1-9]\d{0,4})\.pbf$/.test(rawY ?? '')) {
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  const z = Number(rawZ), x = Number(rawX), y = Number(rawY.slice(0, -4));
  if (!validHazardTile(scenario, z, x, y)) {
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  const name = scenario as HazardScenario;
  try {
    const data = await tiles.get(tile.join('/'), request.signal, async signal => {
      let archive = archives.get(name);
      if (!archive) {
        archive = new PMTiles(new TimedSource(HAZARD_ARCHIVES[name]));
        archives.set(name, archive);
      }
      try {
        const result = await archive.getZxy(z, x, y,
          AbortSignal.any([signal, AbortSignal.timeout(25_000)]));
        return result ? new Uint8Array(result.data) : new Uint8Array();
      } catch (error) {
        if (archives.get(name) === archive) archives.delete(name);
        throw error;
      }
    });
    return new Response(data.slice().buffer, { headers: {
      'Content-Type': 'application/x-protobuf',
      'Cache-Control': 'public, max-age=86400',
      'CDN-Cache-Control': 'public, s-maxage=604800, stale-while-revalidate=86400',
      'Vercel-CDN-Cache-Control': 'public, s-maxage=604800, stale-while-revalidate=86400',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch {
    return Response.json({ error: 'Hazard tile unavailable. Try again later.' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
