/** Public build-time configuration. Private service credentials do not belong here. */
const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const supabaseKey = (
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || ''
).trim();

export const config = {
  mode: 'live' as const,
  mapMode: 'geographic' as const,
  configured: Boolean(supabaseUrl && supabaseKey),
  supabaseUrl,
  supabaseKey,
  staleAfterSeconds: 120,
};
