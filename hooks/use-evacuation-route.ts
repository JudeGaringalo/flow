'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchEvacuationRoute, routingLocation, type EvacuationRoute, type RouteOrigin,
  type TravelMode, type RouteDestination } from '@/lib/evacuation-routing';

export interface EvacuationRouteState {
  site: RouteDestination | null;
  mode: TravelMode;
  status: 'idle' | 'locating' | 'loading' | 'ready' | 'error';
  data: EvacuationRoute | null;
  error: string;
}
const initial: EvacuationRouteState = {
  site: null, mode: 'walking', status: 'idle', data: null, error: '',
};

function currentLocation(signal: AbortSignal): Promise<RouteOrigin> {
  signal.throwIfAborted();
  if (!navigator.geolocation || !window.isSecureContext)
    return Promise.reject(new Error('Location requires HTTPS and a browser with location support.'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => {
      settled = true;
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    navigator.geolocation.getCurrentPosition(position => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      const { latitude, longitude, accuracy } = position.coords;
      if (!Number.isFinite(accuracy) || accuracy < 0) {
        reject(new Error('Could not read your current location. Check location services and retry.'));
        return;
      }
      resolve({ latitude, longitude, accuracy });
    }, error => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      reject(new Error(error.code === 1
        ? 'Allow location access in your browser settings, then retry directions.'
        : 'Could not get your current location. Check location services and retry.'));
    }, { enableHighAccuracy: true, maximumAge: 10_000, timeout: 12_000 });
  });
}

export function useEvacuationRoute(knownLocation: RouteOrigin | null = null) {
  const [state, setState] = useState<EvacuationRouteState>(initial);
  const controller = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const location = useRef(knownLocation);
  location.current = knownLocation;

  const clear = useCallback(() => {
    requestId.current++;
    controller.current?.abort();
    controller.current = null;
    setState(initial);
  }, []);

  const start = useCallback(async (site: RouteDestination, mode: TravelMode = 'walking',
    options: { freshLocation?: boolean } = {}) => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const id = ++requestId.current;
    const reported = location.current;
    const knownOrigin = !options.freshLocation && reported && routingLocation(reported.latitude, reported.longitude)
      ? { ...reported } : null;
    setState({ site, mode, status: knownOrigin ? 'loading' : 'locating', data: null, error: '' });
    try {
      const origin = knownOrigin ?? await currentLocation(request.signal);
      if (request.signal.aborted || requestId.current !== id) return;
      setState({ site, mode, status: 'loading', data: null, error: '' });
      const data = await fetchEvacuationRoute(origin, site, mode, request.signal);
      if (!request.signal.aborted && requestId.current === id)
        setState({ site, mode, status: 'ready', data, error: '' });
    } catch (error) {
      if (!request.signal.aborted && requestId.current === id)
        setState({ site, mode, status: 'error', data: null,
          error: error instanceof Error ? error.message : 'Directions are temporarily unavailable. Retry your route.' });
    } finally {
      if (controller.current === request) controller.current = null;
    }
  }, []);

  useEffect(() => () => {
    requestId.current++;
    controller.current?.abort();
  }, []);

  return { ...state, start, clear };
}
