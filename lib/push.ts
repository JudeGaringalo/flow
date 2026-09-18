import { config } from './config';
import { ensureSession, invoke } from './supabase';

export async function worker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext)
    throw new Error('Notifications require HTTPS (or localhost) and a supported browser.');

  await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return Promise.race(
    [
      navigator.serviceWorker.ready,
      new Promise<never>(
        (_, reject) => setTimeout(
          () => reject(new Error('Service worker did not become ready. Reload the page and try again.')),
          12000
        )
      )
    ]
  );
}

function applicationKey(value: string): ArrayBuffer {
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++)
    bytes[i] = raw.charCodeAt(i);

  return bytes.buffer;
}

export async function enablePush(_nodeId?: string) {
  if (!('Notification' in window))
    throw new Error(
      'Notifications are not supported here. On iPhone/iPad, open the installed Home Screen app.'
    );

  // Permission must be requested directly from the user's click, before async network work.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted')
    throw new Error('Notification permission was not granted. You can still use the live map.');

  const reg = await worker();
  if (!config.vapidPublicKey)
    throw new Error('Set NEXT_PUBLIC_VAPID_PUBLIC_KEY and redeploy before enabling live push.');

  if (!('PushManager' in window))
    throw new Error('This browser does not support Web Push.');

  await ensureSession();
  let sub = await reg.pushManager.getSubscription();
  if (!sub)
    sub = await reg.pushManager.subscribe(
      {
        userVisibleOnly: true,
        applicationServerKey: applicationKey(config.vapidPublicKey)
      }
    );

  await invoke('manage-push', {
    action: 'subscribe',
    subscription: sub.toJSON()
  });
  return 'Browser push enabled for your saved alert preferences. Delivery depends on your browser, OS and network.';
}

export async function disablePush() {
  const reg = await worker(), sub = await reg.pushManager.getSubscription();
  if (!sub)
    return;

  await ensureSession();
  await invoke('manage-push', {
    action: 'unsubscribe',
    endpoint: sub.endpoint
  });
  await sub.unsubscribe();
}
