import { ApiError, failure, getServerDb, json, validId } from '@/lib/server/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const nodeId = new URL(req.url).searchParams.get('node_id');
    if (!validId(nodeId)) throw new ApiError(400, 'A valid node_id is required.');

    const { data, error } = await getServerDb().rpc('flow_node_history', { p_node_id: nodeId })
      .abortSignal(req.signal);
    if (error?.code === '42883' || error?.code === 'PGRST202' || error?.code === '42P01')
      throw new ApiError(503, 'Apply flow-node-history.sql in Supabase to enable recorded history.');
    if (error) throw error;
    if (data?.found === false) throw new ApiError(404, 'Monitoring point not found.');
    if (!data || data.node_id !== nodeId || !Array.isArray(data.spans)
      || !Number.isFinite(data.generated_at))
      throw new ApiError(502, 'Recorded history could not be loaded.');

    return json({ node_id: nodeId, generated_at: data.generated_at, spans: data.spans });
  } catch (error) {
    return failure(error);
  }
}
