import 'server-only';

import webpush from 'web-push';

import {
  condition,
  fresh,
  getServerDb,
  type EvidenceNode,
} from './runtime';

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

interface PushSubscription {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

interface FollowPreference {
  min_level: number;
}

function vapid() {
  const publicKey =
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();

  const privateKey =
    process.env.VAPID_PRIVATE_KEY?.trim();

  const subject =
    process.env.VAPID_SUBJECT?.trim();

  if (!publicKey || !privateKey || !subject) {
    return null;
  }

  return {
    publicKey,
    privateKey,
    subject,
  };
}

export const pushConfigured = () => vapid() !== null;

/**
 * Processes one bounded batch of queued Web Push notifications.
 *
 * PostgreSQL owns the durable queue and job leases.
 */
export async function dispatchPushJobs(limit = 8) {
  const keys = vapid();

  if (!keys) {
    return {
      configured: false,
      claimed: 0,
      sent: 0,
      skipped: 0,
      retried: 0,
    };
  }

  const db = getServerDb();

  const { data, error } = await db.rpc(
    'flow_claim_push_jobs',
    {
      p_limit: Math.min(
        8,
        Math.max(1, limit),
      ),
    },
  );

  if (error) {
    throw error;
  }

  const jobs = (data ?? []) as PushJob[];

  let sent = 0;
  let skipped = 0;
  let retried = 0;

  /**
   * A maximum of eight jobs run concurrently.
   * Each external push-provider request also receives
   * its own timeout further below.
   */
  await Promise.all(
    jobs.map(async (job) => {
      /**
       * Update the durable queue entry after an attempt.
       */
      const finish = async (
        values: Record<string, unknown>,
      ) => {
        const result = await db
          .from('flow_push_jobs')
          .update({
            leased_until: null,
            ...values,
          })
          .eq('id', job.id)
          .eq('state', 'running')
          .eq('attempts', job.attempts);

        if (result.error) {
          throw result.error;
        }
      };

      try {
        /**
         * Load the event and the browser/device push
         * subscription associated with this queue job.
         */
        const [
          eventResult,
          subscriptionResult,
        ] = await Promise.all([
          db
            .from('flow_events')
            .select('*')
            .eq('id', job.event_id)
            .maybeSingle(),

          db
            .from(
              'flow_push_subscriptions',
            )
            .select('*')
            .eq(
              'id',
              job.subscription_id,
            )
            .maybeSingle(),
        ]);

        if (
          eventResult.error ||
          subscriptionResult.error
        ) {
          throw new Error(
            'Push evidence unavailable',
          );
        }

        const event =
          eventResult.data as PushEvent | null;

        const pushSubscription =
          subscriptionResult.data as
            | PushSubscription
            | null;

        /**
         * The event or target browser may have been
         * removed after the queue job was created.
         */
        if (
          !event ||
          !pushSubscription
        ) {
          await finish({
            state: 'skipped',
            last_error:
              'Event or push subscription removed',
          });

          skipped++;
          return;
        }

        /**
         * Only send to approved Web Push provider hosts.
         */
        if (
          !allowedPushEndpoint(
            pushSubscription.endpoint,
          )
        ) {
          await finish({
            state: 'skipped',
            last_error:
              'Unapproved push host',
          });

          skipped++;
          return;
        }

        /**
         * Load the current FLOW node and the user's
         * alert threshold for that node.
         */
        const [
          nodeResult,
          followResult,
        ] = await Promise.all([
          db
            .from('flow_nodes')
            .select('*')
            .eq(
              'id',
              event.node_id,
            )
            .maybeSingle(),

          db
            .from('flow_follows')
            .select('min_level')
            .eq(
              'user_id',
              pushSubscription.user_id,
            )
            .eq(
              'node_id',
              event.node_id,
            )
            .maybeSingle(),
        ]);

        if (
          nodeResult.error ||
          followResult.error
        ) {
          throw new Error(
            'Push context unavailable',
          );
        }

        const node =
          nodeResult.data as EvidenceNode | null;

        const follow =
          followResult.data as
            | FollowPreference
            | null;

        const eventTime = Date.parse(
          event.recorded_at,
        );

        /**
         * Skip notifications that are no longer relevant.
         *
         * This prevents stale, superseded, private,
         * unfollowed, or invalid readings from producing
         * notifications.
         */
        if (
          !node ||
          !follow ||
          !node.is_public ||
          !fresh(node) ||
          event.level === null ||
          event.level < follow.min_level ||
          node.state_version !==
            event.source_version ||
          !Number.isFinite(eventTime) ||
          Date.now() - eventTime >
            180_000 ||
          eventTime >
            Date.now() + 30_000
        ) {
          await finish({
            state: 'skipped',
            last_error:
              'No longer current or followed',
          });

          skipped++;
          return;
        }

        /**
         * Format observation time in Philippine time.
         */
        const time = new Date(
          eventTime,
        ).toLocaleTimeString('en-PH', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
          timeZone: 'Asia/Manila',
        });

        /**
         * Notification payload received by the
         * FLOW service worker.
         */
        const payload = {
          title: `F.L.O.W. · ${condition(
            node,
          )}`,

          body:
            `${node.name}: Level ${event.level} ` +
            `reported at ${time} Philippine time. ` +
            'Open the map for the latest observation.',

          node_id: node.id,
          recorded_at: event.recorded_at,
        };

        /**
         * web-push handles encryption and VAPID signing.
         */
        const request =
          webpush.generateRequestDetails(
            {
              endpoint:
                pushSubscription.endpoint,

              keys: {
                p256dh:
                  pushSubscription.p256dh,

                auth:
                  pushSubscription.auth_key,
              },
            },

            JSON.stringify(payload),

            {
              vapidDetails: keys,
              TTL: 120,
              urgency: 'high',
              contentEncoding:
                'aes128gcm',
            },
          );

        const headers =
          Object.fromEntries(
            Object.entries(
              request.headers,
            ).map(
              ([key, value]) => [
                key,
                String(value),
              ],
            ),
          );

        /**
         * The external push request is given a strict
         * timeout so a provider cannot hold a Vercel
         * function open indefinitely.
         */
        const response = await fetch(
          request.endpoint,
          {
            method: request.method,
            headers,

            body: request.body
              ? new Uint8Array(
                  request.body,
                ).buffer
              : undefined,

            redirect: 'error',

            signal:
              AbortSignal.timeout(
                8_000,
              ),
          },
        );

        /**
         * We do not need the push provider's response body.
         */
        await response.body?.cancel();

        /**
         * 404 / 410 means the browser subscription
         * no longer exists.
         */
        if (
          response.status === 404 ||
          response.status === 410
        ) {
          const deletion = await db
            .from(
              'flow_push_subscriptions',
            )
            .delete()
            .eq(
              'id',
              pushSubscription.id,
            );

          if (deletion.error) {
            throw deletion.error;
          }

          await finish({
            state: 'skipped',
            last_error:
              'Push subscription expired',
          });

          skipped++;
          return;
        }

        if (!response.ok) {
          throw new Error(
            'Push provider rejected request',
          );
        }

        /**
         * Delivery completed successfully.
         */
        await finish({
          state: 'sent',
          last_error: null,
        });

        sent++;
      } catch (error) {
        retried++;

        console.error(
          'FLOW push delivery failed:',
          error,
        );

        try {
          const reachedRetryLimit =
            job.attempts >= 5;

          const retryDelay =
            Math.min(
              120_000,
              10_000 *
                2 ** job.attempts,
            );

          await finish({
            state: reachedRetryLimit
              ? 'failed'
              : 'pending',

            next_attempt_at:
              new Date(
                Date.now() +
                  retryDelay,
              ).toISOString(),

            last_error:
              'Delivery attempt failed; inspect server/provider configuration.',
          });
        } catch (queueError) {
          console.error(
            'FLOW queue update failed; job lease allows later retry.',
            queueError,
          );
        }
      }
    }),
  );

  return {
    configured: true,
    claimed: jobs.length,
    sent,
    skipped,
    retried,
  };
}