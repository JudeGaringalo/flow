import type { EvacuationSiteResponse, MappedEvacuationSite } from '@/lib/evacuation-sites';
import { getServerDb } from '@/lib/server/runtime';

export const runtime = 'nodejs';
export const maxDuration = 20;

interface SiteRow {
  id: string;
  name: string;
  city: string;
  latitude: number;
  longitude: number;
}



export async function GET() {
  try {
    const db = getServerDb();
    const sites: MappedEvacuationSite[] = [];
    const pageSize = 1000;

    for (let offset = 0; offset < 10000; offset += pageSize) {
      const { data, error } = await db.from('flow_evacuation_sites')
        .select('id,name,city,latitude,longitude')
        .order('id', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      const rows = (data ?? []) as SiteRow[];
      sites.push(...rows.map(row => ({
        id: row.id, name: row.name, city: row.city,
        latitude: row.latitude, longitude: row.longitude,
      })));
      if (rows.length < pageSize) break;
      if (offset + pageSize === 10000) throw new Error('Site list exceeds the paging limit');
    }

    sites.sort((a, b) => a.name.localeCompare(b.name));
    const result: EvacuationSiteResponse = { sites, retrievedAt: new Date().toISOString() };
    return Response.json(result, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' },
    });
  } catch (error) {
    console.error('FLOW evacuation site lookup failed', error instanceof Error ? error.name : 'DatabaseError');
    return Response.json({ error: 'Recorded sites are unavailable. Try again later.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
