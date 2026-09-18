const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();

const supabaseKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '').trim();

export const config = {
  mode: 'live' as const,
  mapMode: 'geographic' as const,
  configured: Boolean(supabaseUrl && supabaseKey),
  supabaseUrl,
  supabaseKey,
  vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '',
  mapStyleLight: process.env.NEXT_PUBLIC_FLOW_MAP_STYLE_LIGHT
    || 'https://tiles.openfreemap.org/styles/positron',
  mapStyleDark: process.env.NEXT_PUBLIC_FLOW_MAP_STYLE_DARK || 'https://tiles.openfreemap.org/styles/dark',
  staleAfterSeconds: 120,
};
