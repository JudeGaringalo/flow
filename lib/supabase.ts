import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from './config';
import { normalizeNode } from './core';
import type { Follow, NodeInput, Observation } from './types';

let pending: Promise<SupabaseClient> | undefined;

export function getSupabase(): Promise<SupabaseClient> {
  if (!config.supabaseUrl || !config.supabaseKey)
    throw new Error('Set your Supabase URL and publishable key, then rebuild the app.');

  if (!pending)
    pending = import('@supabase/supabase-js')
      .then(
        ({ createClient }) => createClient(config.supabaseUrl, config.supabaseKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        })
      )
      .catch(e => {
        pending = undefined;
        throw e;
      });

  return pending;
}

let sessionRequest: ReturnType<typeof createAnonymousSession> | null = null;

async function createAnonymousSession() {
  const client = await getSupabase();
  const { data: { session }, error } = await client.auth.getSession();
  if (error)
    throw error;

  if (session)
    return session;

  const result = await client.auth.signInAnonymously();
  if (result.error)
    throw result.error;

  if (!result.data.session)
    throw new Error('Enable anonymous sign-ins in Supabase.');

  return result.data.session;
}

export async function ensureSession() {
  // Concurrent AI and alert requests must not create separate anonymous accounts.
  if (!sessionRequest)
    sessionRequest = createAnonymousSession().finally(() => {
      sessionRequest = null;
    });

  return sessionRequest;
}

export async function loadNodes() {
  const db = await getSupabase();
  const { data, error } = await db.from('flow_nodes')
    .select(
      'id,name,area,latitude,longitude,probes,current_level,quality,last_seen,state_version,rssi,firmware,is_public'
    )
    .eq(
      'is_public',
      true
    )
    .order('id');
  if (error)
    throw error;

  return (data || []).map(normalizeNode);
}

export async function loadHistory(id: string, hours = 720) {
  const db = await getSupabase();
  const after = new Date(Date.now() - hours * 3600000).toISOString();
  // Paginate so a 30-day filter isn't silently restricted to the latest 200 events.
  const rows: Observation[] = [];
  let offset = 0;
  while (offset < 10000) {
    const { data, error } = await db.from('flow_events').select('id,node_id,level,quality,probes,recorded_at').eq('node_id', id)
      .gte(
        'recorded_at',
        after
      )
      .order(
        'recorded_at',
        { ascending: false }
      )
      .order(
        'id',
        { ascending: false }
      )
      .range(
        offset,
        offset + 999
      );
    if (error)
      throw error;

    rows.push(...(data || []) as Observation[]);
    if (!data || data.length < 1000)
      break;

    offset += 1000;
  }
  return {
    events: rows.reverse(),
    truncated: rows.length >= 10000
  };
}

export async function loadFollows(): Promise<Record<string, Follow>> {
  const db = await getSupabase();
  const { data: { session } } = await db.auth.getSession();
  if (!session)
    return {};

  const { data, error } = await db.from('flow_follows').select('node_id,min_level').eq('user_id', session.user.id);
  if (error)
    throw error;

  return Object.fromEntries((data || []).map(r => [
    r.node_id,
    { min_level: r.min_level }
  ]));
}

export async function saveFollow(nodeId: string, min: 1 | 2 | 3 | null) {
  const session = await ensureSession(), db = await getSupabase();
  const res = min === null
    ? await db.from('flow_follows').delete().eq('user_id', session.user.id).eq('node_id', nodeId)
    : await db.from('flow_follows')
      .upsert(
        {
          user_id: session.user.id,
          node_id: nodeId,
          min_level: min
        },
        { onConflict: 'user_id,node_id' }
      );
  if (res.error)
    throw res.error;
}

/** Browser mutations call this same Next.js origin. Supabase still handles
 * authenticated reads, sessions and Realtime. No remote Edge Functions are used.
 */
export async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const allowed = ['register-node', 'flow-intelligence', 'manage-push'];
  if (!allowed.includes(name))
    throw new Error('Unknown FLOW API endpoint');

  const session = await ensureSession();
  const response = await fetch(`/api/${name}`, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.error)
    throw new Error(data?.error || `FLOW API request failed (${response.status}).`);

  if (data === null)
    throw new Error('FLOW API returned an empty response.');

  return data as T;
}

export async function login(email: string, password: string) {
  const db = await getSupabase();
  const { data, error } = await db.auth.signInWithPassword({
    email,
    password
  });
  if (error)
    throw error;

  if (!data.user)
    throw new Error('Sign-in failed');

  const admin = await db.from('flow_admins').select('user_id').eq('user_id', data.user.id).maybeSingle();
  if (admin.error || !admin.data) {
    await db.auth.signOut();
    throw new Error('This account is not an authorized FLOW installer.');
  }

  return data.user;
}

export async function currentAdmin() {
  const db = await getSupabase();
  const { data: { session } } = await db.auth.getSession();
  if (!session)
    return null;

  const { data, error } = await db.auth.getUser();
  if (error || !data.user)
    return null;

  const admin = await db.from('flow_admins').select('user_id').eq('user_id', data.user.id).maybeSingle();
  return admin.data ? data.user : null;
}

export const registerNode = (
  action: 'create' | 'update' | 'rotate',
  values: Partial<NodeInput> & {
    id: string;
  }
) => invoke<{
  id: string;
  device_token?: string;
}>('register-node', {
  action,
  ...values
});
