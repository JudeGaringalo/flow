import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from './config';
import { normalizeNode } from './core';

let pending: Promise<SupabaseClient> | undefined;

export function getSupabase(): Promise<SupabaseClient> {
  if (!config.supabaseUrl || !config.supabaseKey)
    throw new Error('Set your Supabase URL and publishable key, then rebuild the app.');

  if (!pending)
    pending = import('@supabase/supabase-js')
      .then(({ createClient }) => createClient(config.supabaseUrl, config.supabaseKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        }
      }))
      .catch(error => {
        pending = undefined;
        throw error;
      });

  return pending;
}

export async function loadNodes() {
  const db = await getSupabase();
  const { data, error } = await db.from('flow_nodes')
    .select('id,name,area,latitude,longitude,probes,current_level,quality,last_seen,state_version,rssi,firmware')
    .order('id');
  if (error)
    throw error;

  return (data || []).map(normalizeNode);
}
