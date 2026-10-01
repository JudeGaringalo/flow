import 'server-only';
import webpush from 'web-push';
import { distance, distanceText, STATUS } from '@/lib/core';
import { getServerDb } from './runtime';
import type { Level } from '@/lib/types';

type Rising = {
  id: string; name: string; latitude: number; longitude: number; level: Level;
};
type Subscriber = {
  endpoint: string; p256dh: string; auth_key: string; latitude: number; longitude: number;
};

export async function dispatchNearbyAlerts(nodeId: string, messageId: string) {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return;
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    const db = getServerDb();
    const claim = await db.rpc('flow_claim_rising_alert', {
      p_node_id: nodeId, p_message_id: messageId
    });
    if (claim.error) throw claim.error;
    const reading = claim.data as Rising | null;
    if (!reading || ![1, 2, 3].includes(reading.level)) return;
    if (!Number.isFinite(reading.latitude) || !Number.isFinite(reading.longitude)) return;

    const latRange = 3000 / 111000 + .002;
    const lonRange = 3000 / (111000 * Math.max(.05, Math.cos(reading.latitude * Math.PI / 180))) + .002;
    const recipients: Subscriber[] = [];
    for (let offset = 0; ; offset += 200) {
      const { data, error } = await db.from('flow_push_subscriptions')
        .select('endpoint,p256dh,auth_key,latitude,longitude')
        .gte('latitude', reading.latitude - latRange).lte('latitude', reading.latitude + latRange)
        .gte('longitude', reading.longitude - lonRange).lte('longitude', reading.longitude + lonRange)
        .order('endpoint').range(offset, offset + 199);
      if (error) throw error;
      const rows = (data || []) as Subscriber[];
      recipients.push(...rows.filter(row => distance(reading, row) <= 3000));
      if (rows.length < 200) break;
    }

    const status = STATUS[(['below', 'advisory', 'watch', 'warning'] as const)[reading.level]];
    for (let offset = 0; offset < recipients.length; offset += 8) {
      await Promise.all(recipients.slice(offset, offset + 8).map(async subscriber => {
        const body = {
          title: status.label + ' near your saved area',
          body: `${reading.name} is ${distanceText(distance(reading, subscriber))} away. Level ${reading.level} reached at this sensor; check official warnings.`,
          nodeId: reading.id,
          level: reading.level
        };
        try {
          await webpush.sendNotification({
            endpoint: subscriber.endpoint,
            keys: { p256dh: subscriber.p256dh, auth: subscriber.auth_key }
          }, JSON.stringify(body), { TTL: 120, urgency: 'high' });
        } catch (error) {
          const code = (error as { statusCode?: number })?.statusCode;
          if (code === 404 || code === 410) {
            await db.from('flow_push_subscriptions').delete()
              .eq('endpoint', subscriber.endpoint).eq('p256dh', subscriber.p256dh);
          } else {
            console.error('FLOW push delivery failed', code || 'network');
          }
        }
      }));
    }
  } catch (error) {
    console.error('FLOW push dispatch failed', error instanceof Error ? error.name : 'BackendError');
  }
}
