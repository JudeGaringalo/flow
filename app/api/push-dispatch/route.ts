import { ApiError, equalSecret, failure, json } from '@/lib/server/runtime';
import { dispatchPushJobs, pushConfigured } from '@/lib/server/push';

export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';

export const maxDuration = 60;

/** Called by Supabase Cron over HTTPS, not by the public browser. */
export async function POST(req: Request) {
  try {
    const secret = process.env.PUSH_WORKER_SECRET || '';
    if (secret.length < 32 || !equalSecret(req.headers.get('x-worker-secret') || '', secret))
      throw new ApiError(401, 'Unauthorized');

    if (!pushConfigured())
      throw new ApiError(503, 'Web Push is not configured');

    return json(await dispatchPushJobs(8));
  }
  catch (error) {
    return failure(error);
  }
}
