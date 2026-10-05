'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { nextWeatherDayAt, parseNodeWeather, WEATHER_REFRESH_MS, weatherCoordinates, weatherDay, type NodeWeather } from '@/lib/node-weather';
import type { FlowNode } from '@/lib/types';

type Entry = { data: NodeWeather; fetchedAt: number };
type View = { coordinates: string | null; day: string | null; data: NodeWeather | null; loading: boolean; error: boolean };
const empty: View = { coordinates: null, day: null, data: null, loading: false, error: false };

export interface NodeWeatherState {
  data: NodeWeather | null;
  loading: boolean;
  error: boolean;
  retryWeather: () => void;
}

export function useNodeWeather(node: Pick<FlowNode, 'latitude' | 'longitude'> | null | undefined): NodeWeatherState {
  const coordinates = weatherCoordinates(node?.latitude, node?.longitude);
  const cache = useRef(new Map<string, Entry>());
  const retry = useRef<(() => void) | null>(null);
  const [view, setView] = useState<View>(empty);

  useEffect(() => {
    if (!coordinates) {
      setView(empty);
      return;
    }
    const location = coordinates;
    let active = true;
    let busy = false;
    let requestDay: string | null = null;
    let lastAttempt = 0;
    let controller: AbortController | null = null;
    let dayTimer: ReturnType<typeof setTimeout>;
    const initialDay = weatherDay();
    const initial = cache.current.get(`${location}:${initialDay}`);
    setView({ coordinates: location, day: initialDay, data: initial?.data ?? null, loading: false, error: false });

    const refresh = async (force = false) => {
      const now = Date.now();
      const day = weatherDay(now);
      const key = `${location}:${day}`;
      const existing = cache.current.get(key);
      const changedDay = requestDay !== null && requestDay !== day;
      if (!active) return;
      if (changedDay) {
        controller?.abort();
        busy = false;
        lastAttempt = 0;
        setView({ coordinates: location, day, data: existing?.data ?? null, loading: false, error: false });
      }
      if (busy || (!force && (document.visibilityState === 'hidden'
        || now - lastAttempt < 60_000 || (existing && now - existing.fetchedAt < WEATHER_REFRESH_MS)))) return;
      requestDay = day;
      if (!navigator.onLine) {
        setView(current => ({ ...current, day, data: existing?.data ?? null, loading: false, error: true }));
        return;
      }
      busy = true;
      lastAttempt = now;
      controller = new AbortController();
      const requestController = controller;
      const timeout = setTimeout(() => requestController.abort(), 12_000);
      setView(current => ({ ...current, day, data: existing?.data ?? null, loading: true, error: false }));
      try {
        const [latitude, longitude] = location.split(',');
        const response = await fetch(`/api/node-weather?latitude=${latitude}&longitude=${longitude}&day=${day}`, {
          signal: requestController.signal,
        });
        if (!response.ok) throw new Error('Weather forecast unavailable');
        const data = parseNodeWeather(await response.json(), location, day);
        if (!active || requestController !== controller || day !== weatherDay()) return;
        cache.current.delete(key);
        cache.current.set(key, { data, fetchedAt: Date.now() });
        while (cache.current.size > 20) cache.current.delete(cache.current.keys().next().value!);
        setView({ coordinates: location, day, data, loading: false, error: false });
      } catch {
        if (active && requestController === controller)
          setView(current => ({ ...current, loading: false, error: true }));
      } finally {
        clearTimeout(timeout);
        if (requestController === controller) busy = false;
      }
    };
    const scheduleDay = () => {
      dayTimer = setTimeout(() => {
        void refresh();
        scheduleDay();
      }, nextWeatherDayAt() - Date.now());
    };
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const online = () => { void refresh(true); };
    retry.current = online;
    void refresh();
    scheduleDay();
    const timer = setInterval(visible, WEATHER_REFRESH_MS);
    window.addEventListener('focus', visible);
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      controller?.abort();
      retry.current = null;
      clearTimeout(dayTimer);
      clearInterval(timer);
      window.removeEventListener('focus', visible);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [coordinates]);

  const retryWeather = useCallback(() => retry.current?.(), []);
  const matches = view.coordinates === coordinates && view.day === weatherDay();
  return { data: matches ? view.data : null,
    loading: coordinates !== null && (!matches || view.loading),
    error: matches && view.error, retryWeather };
}
