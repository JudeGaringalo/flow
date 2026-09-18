import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Shared Node.js-only API helpers. Never import from a client component. */
export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

let client: SupabaseClient | undefined;

export function getServerDb(): SupabaseClient {
  if (client)
    return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (process.env.SUPABASE_SECRET_KEY || process.env.FLOW_SERVER_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!url || !key)
    throw new ApiError(
      503,
      'Backend not configured. Set the Supabase URL and private SUPABASE_SECRET_KEY on the server.'
    );

  // Lazy initialization: a build/empty-map page never needs real credentials.
  client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
    global: {
      fetch: (input, init) => fetch(input, {
        ...init,
        cache: 'no-store',
        signal: init?.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(15000),
      })
    },
  });
  return client;
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

export function failure(error: unknown): Response {
  if (error instanceof ApiError)
    return json({ error: error.message }, error.status);

  // Do not return raw SQL/auth/provider errors or secrets to a public caller.
  console.error('FLOW API operation failed', error instanceof Error ? error.name : 'BackendError');
  return json(
    {
      error: 'The server could not complete this request. Check the server configuration and logs.'
    },
    500
  );
}

export function checkOrigin(req: Request): void {
  const origin = req.headers.get('origin');
  // Hardware and authenticated server callers have no browser Origin header.
  if (!origin)
    return;

  const expected = process.env.SITE_ORIGIN?.trim() || new URL(req.url).origin;
  if (origin !== expected)
    throw new ApiError(403, 'Origin not allowed');
}

export function bearerToken(req: Request): string {
  const match = /^Bearer ([^\s]+)$/.exec(req.headers.get('authorization') || '');
  if (!match || match[1].length > 8192)
    throw new ApiError(401, 'Unauthorized');

  return match[1];
}

export async function requireUser(req: Request) {
  const token = bearerToken(req);
  const { data, error } = await getServerDb().auth.getUser(token);
  if (error || !data.user)
    throw new ApiError(401, 'Unauthorized');

  return data.user;
}

export async function requireAdmin(req: Request) {
  const user = await requireUser(req);
  const { data, error } = await getServerDb().from('flow_admins').select('user_id').eq('user_id', user.id).maybeSingle();
  if (error)
    throw error;

  if (!data)
    throw new ApiError(403, 'An approved FLOW installer account is required.');

  return user;
}

/** Cap actual bytes, not only the client-supplied Content-Length header. */
export async function readJson(req: Request, max = 8192): Promise<Record<string, unknown>> {
  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new ApiError(415, 'Content-Type must be application/json');
  }

  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > max)
    throw new ApiError(413, 'Request too large');

  if (!req.body)
    throw new ApiError(400, 'A JSON object is required');

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (; ;) {
      const { done, value } = await reader.read();
      if (done)
        break;

      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new ApiError(413, 'Request too large');
      }

      chunks.push(value);
    }
  }
  finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  }
  catch {
    throw new ApiError(400, 'Invalid JSON');
  }

  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new ApiError(400, 'A JSON object is required');

  return body as Record<string, unknown>;
}

export const hashToken = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

export const newDeviceToken = () => randomBytes(32).toString('hex');

export function equalSecret(actual: string, expected: string): boolean {
  if (!actual || !expected || actual.length > 4096)
    return false;

  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function takeLimit(bucket: string, limit: number, seconds = 60): Promise<boolean> {
  const { data, error } = await getServerDb().rpc('flow_take_limit', {
    p_bucket: bucket,
    p_limit: limit,
    p_seconds: seconds
  });
  if (error)
    throw error;

  return data === true;
}

export const validId = (id: unknown): id is string => typeof id === 'string' && /^[A-Z0-9-]{3,40}$/.test(id);

export interface EvidenceNode {
  id: string;
  name: string;
  current_level: number | null;
  quality: string;
  last_seen: string | null;
  state_version: number;
  is_public?: boolean;
}

export function condition(node: EvidenceNode, now = Date.now()): string {
  const time = node.last_seen ? Date.parse(node.last_seen) : NaN;
  if (!Number.isFinite(time) || now - time > 120000 || time - now > 30000)
    return 'Data unavailable';

  if (node.quality !== 'valid')
    return 'Check sensor';

  if (node.current_level === null || !Number.isInteger(node.current_level))
    return 'Data unavailable';

  return ['Below first threshold', 'Flood Advisory', 'Flood Watch', 'Flood Warning'][node.current_level]
    || 'Data unavailable';
}

export const fresh = (node: EvidenceNode) => !['Data unavailable', 'Check sensor'].includes(condition(node));
