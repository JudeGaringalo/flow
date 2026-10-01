'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode
} from 'react';
import { config } from '@/lib/config';
import { isBasemap } from '@/lib/map-styles';
import { ageText, distance, distanceText, nodeStatus, risingNearbyAlerts, STATUS } from '@/lib/core';
import { getSupabase, loadNodes } from '@/lib/supabase';
import type { Basemap, Connection, FlowNode, Level, ModalKind, StatusKey } from '@/lib/types';

type Toast = { id: number; text: string; error: boolean; alertLevel?: Level };
const basemapKey = `flow-next:basemap:${encodeURIComponent(config.supabaseUrl)}`;
const pushDisabledKey = 'flow-next:push-disabled';
const locationEnabledKey = 'flow-next:location-enabled';
const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function currentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false, maximumAge: 60000, timeout: 15000
    }));
}

function pushApplicationKey(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = atob(padded + '='.repeat((4 - padded.length % 4) % 4));
  return Uint8Array.from(decoded, char => char.charCodeAt(0));
}

async function showNearbyNotification(title: string, body: string, nodeId: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const url = '/#node=' + encodeURIComponent(nodeId);
  const options: NotificationOptions = {
    body, icon: '/assets/flow-icon.png', tag: `flow-nearby-${nodeId}`, data: { url }
  };
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      if (registration?.active) {
        await registration.showNotification(title, options);
        return;
      }
    } catch { }
  }
  try {
    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      location.hash = 'node=' + encodeURIComponent(nodeId);
      notification.close();
    };
  } catch { }
}

function useFlowController() {
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(0);
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StatusKey | 'all'>('all');
  const [expanded, setExpanded] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>('standard');
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [online, setOnline] = useState(true);
  const [connection, setConnection] = useState<Connection>(config.configured ? 'loading' : 'unconfigured');
  const [connectionError, setConnectionError] = useState('');
  const [alertLocation, setAlertLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationChecking, setLocationChecking] = useState(true);
  const [locationError, setLocationError] = useState('');
  const [locationWorking, setLocationWorking] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const [pushStatus, setPushStatus] = useState<'unavailable' | 'working' | 'on' | 'off' | 'error'>('unavailable');
  const [pushError, setPushError] = useState('');
  const [pushEnabled, setPushEnabled] = useState(true);
  const mounted = useRef(true);
  const alertBaseline = useRef<FlowNode[] | null>(null);
  const pushSavedAt = useRef<{ latitude: number; longitude: number } | null>(null);
  const pushInFlight = useRef(false);
  const pushEnabledRef = useRef(true);
  const requestRef = useRef(0);
  const lastReadAt = useRef(0);
  const toastTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const notify = useCallback((message: string, error = false, alertLevel?: Level) => {
    const id = Date.now() + Math.random();
    setToasts(list => [...list.slice(-2), { id, text: message, error, alertLevel }]);
    toastTimers.current.push(setTimeout(() => setToasts(list => list.filter(t => t.id !== id)),
      alertLevel ? 12000 : 6000));
  }, []);

  const requestAlertLocation = useCallback(async () => {
    if (!navigator.geolocation || !window.isSecureContext) {
      setLocationError('Location requires a secure browser connection and location support.');
      return;
    }
    setLocationWorking(true);
    setLocationError('');
    // Request notification permission from the same button press. Some browsers
    // reject a permission request if it follows an awaited location prompt.
    const permission = (async (): Promise<NotificationPermission | 'unsupported'> => {
      if (!('Notification' in window)) return 'unsupported';
      if (Notification.permission !== 'default') return Notification.permission;
      try { return await Notification.requestPermission(); }
      catch { return 'denied'; }
    })();
    try {
      const position = await currentPosition();
      if (!mounted.current) return;
      setAlertLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      try { localStorage.setItem(locationEnabledKey, '1'); } catch { }
    } catch (error) {
      if (!mounted.current) return;
      const blocked = (error as GeolocationPositionError)?.code === 1;
      if (blocked) {
        setAlertLocation(null);
        try { localStorage.removeItem(locationEnabledKey); } catch { }
      }
      setLocationError(blocked
        ? 'Location is blocked. Allow it in your browser settings, then try again.'
        : 'Could not get your location. Check device location settings and try again.');
    } finally {
      const result = await permission;
      if (mounted.current) {
        setNotificationPermission(result);
        setLocationWorking(false);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (!navigator.geolocation || !window.isSecureContext) return;
        let granted = false;
        try { granted = localStorage.getItem(locationEnabledKey) === '1'; } catch { }
        if (navigator.permissions?.query) {
          try {
            const permission = await navigator.permissions.query({ name: 'geolocation' });
            granted = permission.state === 'granted';
            if (permission.state === 'denied') {
              try { localStorage.removeItem(locationEnabledKey); } catch { }
            }
          } catch { /* Use the previous successful choice if permission querying is unavailable. */ }
        }
        if (!cancelled && granted) {
          const position = await currentPosition();
          if (!cancelled) {
            setAlertLocation({
              latitude: position.coords.latitude, longitude: position.coords.longitude
            });
            try { localStorage.setItem(locationEnabledKey, '1'); } catch { }
          }
        }
      } catch (error) {
        if (!cancelled) {
          const blocked = (error as GeolocationPositionError)?.code === 1;
          if (blocked) {
            try { localStorage.removeItem(locationEnabledKey); } catch { }
          }
          setLocationError(blocked
            ? 'Location access changed. Allow it in your browser settings, then try again.'
            : 'Could not get your location. Check device location settings and try again.');
        }
      }
      finally { if (!cancelled) setLocationChecking(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const refreshLive = useCallback(async () => {
    if (!config.configured) {
      setConnection('unconfigured');
      return;
    }
    const request = ++requestRef.current;
    lastReadAt.current = Date.now();
    try {
      const incoming = await loadNodes();
      if (!mounted.current || request !== requestRef.current) return;
      setNodes(incoming);
      setConnection('live');
      setConnectionError('');
    } catch (error) {
      if (!mounted.current || request !== requestRef.current) return;
      setConnection('error');
      setConnectionError(error instanceof Error ? error.message : 'Could not load sensors.');
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    setNow(Date.now());
    setOnline(navigator.onLine);
    setNotificationPermission('Notification' in window ? Notification.permission : 'unsupported');
    try {
      const stored = localStorage.getItem(basemapKey);
      if (isBasemap(stored)) setBasemap(stored);
      if (localStorage.getItem(pushDisabledKey) === '1') {
        pushEnabledRef.current = false;
        setPushEnabled(false);
      }
    } catch { }
    setSelectedId(new URLSearchParams(location.hash.slice(1)).get('node'));
    setReady(true);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const network = () => setOnline(navigator.onLine);
    const hash = () => {
      setSelectedId(new URLSearchParams(location.hash.slice(1)).get('node'));
      setExpanded(false);
    };
    window.addEventListener('online', network);
    window.addEventListener('offline', network);
    window.addEventListener('hashchange', hash);
    return () => {
      mounted.current = false;
      ++requestRef.current;
      clearInterval(timer);
      toastTimers.current.forEach(clearTimeout);
      window.removeEventListener('online', network);
      window.removeEventListener('offline', network);
      window.removeEventListener('hashchange', hash);
    };
  }, []);

  useEffect(() => {
    if (!alertLocation || !navigator.geolocation) {
      alertBaseline.current = null;
      return;
    }
    const watch = navigator.geolocation.watchPosition(
      position => setAlertLocation({
        latitude: position.coords.latitude, longitude: position.coords.longitude
      }),
      error => {
        if (error.code === error.PERMISSION_DENIED) {
          setAlertLocation(null);
          try { localStorage.removeItem(locationEnabledKey); } catch { }
          setLocationError('Location is blocked. Allow it in your browser settings, then try again.');
        }
      },
      { enableHighAccuracy: false, maximumAge: 60000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [alertLocation !== null]);

  useEffect(() => {
    if (!ready || !alertLocation || !pushEnabled || notificationPermission !== 'granted'
      || !vapidPublicKey || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushStatus(pushEnabled ? 'unavailable' : 'off');
      return;
    }
    if (pushInFlight.current || (pushSavedAt.current
      && distance(pushSavedAt.current, alertLocation) < 250)) return;
    pushInFlight.current = true;
    setPushStatus('working');
    const position = alertLocation;
    void (async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        const active = await navigator.serviceWorker.ready;
        let subscription = await active.pushManager.getSubscription();
        const key = pushApplicationKey(vapidPublicKey);
        const existingKey = subscription?.options.applicationServerKey;
        if (subscription && existingKey
          && !key.every((byte, index) => byte === new Uint8Array(existingKey)[index])) {
          await subscription.unsubscribe();
          subscription = null;
        }
        if (!subscription) subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true, applicationServerKey: key
        });
        const response = await fetch('/api/alerts/subscription', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: subscription.toJSON(),
            latitude: position.latitude, longitude: position.longitude })
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(typeof data.error === 'string' ? data.error : 'Could not save push subscription');
        }
        if (!pushEnabledRef.current) {
          await fetch('/api/alerts/subscription', {
            method: 'DELETE', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscription: subscription.toJSON() })
          });
          await subscription.unsubscribe();
          return;
        }
        if (mounted.current) {
          pushSavedAt.current = position;
          setPushStatus('on');
          setPushError('');
        }
      } catch (error) {
        if (mounted.current && pushEnabledRef.current) {
          setPushStatus('error');
          setPushError(error instanceof Error ? error.message : 'Could not enable background alerts');
        }
      } finally {
        pushInFlight.current = false;
      }
    })();
  }, [ready, alertLocation, pushEnabled, notificationPermission]);

  const turnOffBackgroundAlerts = useCallback(async () => {
    pushEnabledRef.current = false;
    setPushEnabled(false);
    setPushStatus('off');
    pushSavedAt.current = null;
    try { localStorage.setItem(pushDisabledKey, '1'); } catch { }
    try {
      if (!('serviceWorker' in navigator)) return;
      const subscription = await (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription();
      if (!subscription) return;
      try {
        await fetch('/api/alerts/subscription', {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: subscription.toJSON() })
        });
      } finally { await subscription.unsubscribe(); }
    } catch { setPushError('Could not remove the saved subscription. Reopen FLOW to retry.'); }
  }, []);

  const turnOnBackgroundAlerts = useCallback(() => {
    pushEnabledRef.current = true;
    try { localStorage.removeItem(pushDisabledKey); } catch { }
    setPushEnabled(true);
    if (notificationPermission !== 'granted') void requestAlertLocation();
  }, [notificationPermission, requestAlertLocation]);

  useEffect(() => {
    if (!alertLocation || connection !== 'live' || !online) return;
    if (alertBaseline.current) {
      for (const alert of risingNearbyAlerts(alertBaseline.current, nodes, alertLocation, Date.now())) {
        const status = STATUS[(['below', 'advisory', 'watch', 'warning'] as const)[alert.level]];
        const message = `${alert.node.name} is ${distanceText(alert.distanceMeters)} away. Level ${alert.level} reached at this sensor; check official warnings.`;
        notify(`${status.label}: ${alert.node.name}`, false, alert.level);
        if (pushStatus !== 'on')
          void showNearbyNotification(`${status.label} near you`, message, alert.node.id);
      }
    }
    alertBaseline.current = nodes;
  }, [nodes, alertLocation, connection, online, notify, pushStatus]);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(basemapKey, basemap); } catch { }
  }, [ready, basemap]);

  useEffect(() => {
    if (!ready || !config.configured) return;
    let cancelled = false;
    let clearChannel: (() => void) | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    void refreshLive();
    void (async () => {
      try {
        const db = await getSupabase();
        if (cancelled) return;
        const channel = db.channel('flow:public')
          .on('broadcast', { event: 'node-changed' }, () => {
            if (debounce) return;
            debounce = setTimeout(() => {
              debounce = undefined;
              void refreshLive();
            }, 200);
          })
          .subscribe(status => {
            if (!cancelled && status === 'SUBSCRIBED') void refreshLive();
          });
        clearChannel = () => { void db.removeChannel(channel); };
      } catch (error) {
        if (!cancelled)
          setConnectionError(error instanceof Error ? error.message : 'Realtime unavailable.');
      }
    })();

    const fallback = setInterval(() => {
      if (navigator.onLine && Date.now() - lastReadAt.current >= 29000)
        void refreshLive();
    }, 30000);
    window.addEventListener('online', refreshLive);
    return () => {
      cancelled = true;
      clearChannel?.();
      if (debounce) clearTimeout(debounce);
      clearInterval(fallback);
      window.removeEventListener('online', refreshLive);
    };
  }, [ready, refreshLive]);

  const selected = nodes.find(node => node.id === selectedId) || null;
  const offline = !online || connection !== 'live';
  const getStatus = useCallback((node: FlowNode) => nodeStatus(node, now, offline), [now, offline]);
  const visibleNodes = useMemo(() => nodes.filter(node => {
    const match = `${node.name} ${node.area} ${node.id}`.toLowerCase().includes(query.toLowerCase());
    return match && (filter === 'all' || getStatus(node).key === filter);
  }), [nodes, query, filter, getStatus]);
  const nearby = useMemo(() => selected ? nodes.filter(node => node.id !== selected.id)
    .map(node => ({ ...node, distance: distance(selected, node) }))
    .filter(node => node.distance <= 3000).sort((a, b) => a.distance - b.distance).slice(0, 3) : [],
  [nodes, selected]);

  function selectNode(id: string) {
    if (!nodes.some(node => node.id === id)) return;
    setSelectedId(id);
    setExpanded(false);
    setModal(null);
    const url = new URL(location.href);
    url.hash = 'node=' + encodeURIComponent(id);
    history.replaceState(null, '', url);
  }
  function closeDetails() {
    setSelectedId(null);
    setExpanded(false);
    const url = new URL(location.href);
    url.hash = '';
    history.replaceState(null, '', url);
  }

  return {
    ready, now, nodes, selectedId, selected, query, setQuery, filter, setFilter,
    expanded, setExpanded, basemap, setBasemap, modal, setModal,
    toasts, notify, online, connection, connectionError, offline,
    alertLocation, locationChecking, locationError, locationWorking,
    notificationPermission, requestAlertLocation,
    pushStatus, pushError, turnOffBackgroundAlerts, turnOnBackgroundAlerts,
    getStatus, visibleNodes, nearby, selectNode, closeDetails, refreshLive,
    age: (node: FlowNode) => ageText(node.last_seen, now)
  };
}

const FlowContext = createContext<ReturnType<typeof useFlowController> | null>(null);

export function FlowProvider({ children }: { children: ReactNode }) {
  const flow = useFlowController();
  return <FlowContext.Provider value={flow}>{children}</FlowContext.Provider>;
}

export function useFlow() {
  const flow = useContext(FlowContext);
  if (!flow) throw new Error('useFlow requires FlowProvider');
  return flow;
}
