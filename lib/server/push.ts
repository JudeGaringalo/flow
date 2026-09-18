import 'server-only';
import webpush from 'web-push';
import { getServerDb, condition, fresh, type EvidenceNode } from './runtime';
import { allowedPushEndpoint } from './validation';

interface PushJob {
  id: string;
  event_id: string;
  subscription_id: string;
  attempts: number;
}

interface PushEvent {
  id: string;
  node_id: string;
  level: number | null;
  source_version: number;
  recorded_at: string;
}

interface Subscription {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

function vapid() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  return publicKey && privateKey && subject
    ? {
      publicKey,
      privateKey,
      subject
    }
    : null;
}

export const pushConfigured = () => vapid() !== null;

/** One bounded batch. PostgreSQL owns the durable queue and leases. */
export async function dispatchPushJobs(limit = 8) {
  const keys = vapid();
  if (!keys)
    return {
      configured: false,
      claimed: 0,
      sent: 0,
      skipped: 0,
      retried: 0
    };

  const db = getServerDb();
  const { data, error } = await db.rpc('flow_claim_push_jobs', { p_limit: Math.min(8, Math.max(1, limit)) });
  if (error)
    throw error;

  const jobs = (data || []) as PushJob[];
  let sent = 0, skipped = 0, retried = 0;
  // All jobs start concurrently, with a bounded maximum of eight requests and a
  // shared wall-clock deadline; work cannot leave an unbounded loop on Vercel.
  const deadline = AbortSignal.timeout(22000);
  await Promise.all(
    jobs.map(
      async (job) => {
        const finish = async (values: Record<string, unknown>) => {
          const result = await db.from('flow_push_jobs').update({
            leased_until: null,
            ...values
          })
            .eq('id', job.id)
            .eq(
              'state',
              'running'
            )
            .eq(
              'attempts',
              job.attempts
            )

            .abortSignal(AbortSignal.timeout(5000));
          if (result.error)
            throw result.error;
        };
        try {
          const [ev, subscription] = await Promise.all(
            [
              db.from('flow_events').select('*').eq('id', job.event_id).maybeSingle().abortSignal(deadline),
              db.from('flow_push_subscriptions').select('*').eq('id', job.subscription_id).maybeSingle()
                .abortSignal(deadline),
            ]
          );
          if (ev.error || subscription.error)
            throw new Error('Push evidence unavailable');

          const event = ev.data as PushEvent | null,
            sub = subscription.data as Subscription | null;
          if (!event || !sub) {
            await finish({
              state: 'skipped',
              last_error: 'Event or subscription removed'
            });
            skipped++;
            return;
          }

          if (!allowedPushEndpoint(sub.endpoint)) {
            await finish({
              state: 'skipped',
              last_error: 'Unapproved push host'
            });
            skipped++;
            return;
          }

          const [nr, fr] = await Promise.all(
            [
              db.from('flow_nodes').select('*').eq('id', event.node_id).maybeSingle().abortSignal(deadline),
              db.from('flow_follows').select('min_level').eq('user_id', sub.user_id)
                .eq(
                  'node_id',
                  event.node_id
                )
                .maybeSingle()
                .abortSignal(deadline),
            ]
          );
          if (nr.error || fr.error)
            throw new Error('Push context unavailable');

          const node = nr.data as EvidenceNode | null;
          const eventTime = Date.parse(event.recorded_at);
          if (!node || !fr.data || !node.is_public || !fresh(node) || event.level === null
            || event.level < fr.data.min_level
            ||
            node.state_version !== event.source_version
            || !Number.isFinite(eventTime)
            || Date.now() - eventTime > 180000
            || eventTime > Date.now() + 30000) {
            await finish({
              state: 'skipped',
              last_error: 'No longer current or followed'
            });
            skipped++;
            return;
          }

          const time = new Date(eventTime).toLocaleTimeString('en-PH', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            timeZone: 'Asia/Manila'
          });
          const payload = {
            title: `F.L.O.W. · ${condition(node)}`,
            body: `${node.name}: Level ${event.level} reported at ${time} Philippine time. Open the map for the latest observation.`,
            node_id: node.id,
            recorded_at: event.recorded_at,
          };
          // web-push performs standard Web Push encryption and VAPID signing. Native
          // Node fetch provides an absolute timeout and rejects redirects.
          const request = webpush.generateRequestDetails(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth_key
              }
            },
            JSON.stringify(payload),
            {
              vapidDetails: keys,
              TTL: 120,
              urgency: 'high',
              contentEncoding: 'aes128gcm'
            }
          );
          const headers = Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, String(value)]));
          const response = await fetch(request.endpoint, {
            method: request.method,
            headers,
            body: request.body ? new Uint8Array(request.body).buffer : undefined,
            redirect: 'error',
            signal: AbortSignal.any([deadline, AbortSignal.timeout(8000)]),
          });
          // Do not retain unused response streams while processing a batch.
          await response.body?.cancel();
          if (response.status === 404 || response.status === 410) {
            const deletion = await db.from('flow_push_subscriptions').delete().eq('id', sub.id).abortSignal(deadline);
            if (deletion.error)
              throw deletion.error;

            skipped++;
            return;
          }

          if (!response.ok)
            throw new Error('Push provider rejected request');

          await finish({
            state: 'sent',
            last_error: null
          });
          sent++;
        }
        catch {
          retried++;
          try {
            await finish(
              {
                state: job.attempts >= 5 ? 'failed' : 'pending',
                next_attempt_at: new Date(Date.now() + Math.min(120000, 10000 * 2 ** job.attempts)).toISOString(),
                last_error: 'Delivery attempt failed; inspect server/provider configuration.'
              }
            );
          }
          catch {
            console.error('FLOW queue update failed; job lease allows later retry.');
          }
        }
      }
    )
  );
  return {
    configured: true,
    claimed: jobs.length,
    sent,
    skipped,
    retried
  };
}
