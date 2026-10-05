'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { levelFromProbes } from '@/lib/core';
import type { FlowNode, Level } from '@/lib/types';

export interface ObservationSpan {
  start: number;
  end: number;
  level: Level | null;
}

export const OBSERVATION_GAP_MS = 120_000;
const RETENTION_MS = 31 * 86_400_000;
const REFETCH_MS = 60_000;
const emptySpans: ObservationSpan[] = [];
type Entry = { spans: ObservationSpan[]; fetchedAt: number; recorded: boolean };
type View = Entry & { nodeId: string | null; loading: boolean; error: boolean };
const emptyView: View = { nodeId: null, spans: emptySpans, fetchedAt: 0,
  recorded: false, loading: false, error: false };

function isLevel(value: unknown): value is Level | null {
  return value === null || (Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 3);
}

export function parseRecordedHistory(value: unknown, nodeId: string) {
  if (!value || typeof value !== 'object') throw new Error('Invalid recorded history');
  const data = value as { node_id?: unknown; generated_at?: unknown; spans?: unknown };
  if (data.node_id !== nodeId || typeof data.generated_at !== 'number'
    || !Number.isFinite(data.generated_at) || !Array.isArray(data.spans))
    throw new Error('Invalid recorded history');

  const spans: ObservationSpan[] = [];
  for (const row of data.spans) {
    if (!Array.isArray(row) || row.length !== 3
      || typeof row[0] !== 'number' || typeof row[1] !== 'number'
      || !Number.isFinite(row[0]) || !Number.isFinite(row[1])
      || row[0] < data.generated_at - RETENTION_MS || row[1] < row[0]
      || row[1] > data.generated_at + 1 || !isLevel(row[2])
      || (spans.length > 0 && row[0] <= spans[spans.length - 1].end))
      throw new Error('Invalid recorded history');
    spans.push({ start: row[0], end: row[1], level: row[2] });
  }
  return { spans, generatedAt: data.generated_at };
}

export function appendObservation(spans: ObservationSpan[], node: FlowNode, now: number) {
  const at = node.last_seen ? Date.parse(node.last_seen) : NaN;
  if (!Number.isFinite(at) || at < now - RETENTION_MS || at > now + 30_000) return spans;
  const derived = node.quality === 'valid' ? levelFromProbes(node.probes) : null;
  const level = derived === node.current_level ? derived : null;
  const last = spans.at(-1);
  if (last && at <= last.end) return spans;
  const retained = spans.filter(span => span.end >= now - RETENTION_MS)
    .map(span => span.start < now - RETENTION_MS ? { ...span, start: now - RETENTION_MS } : span);
  return last && last.level === level && at - last.end <= OBSERVATION_GAP_MS
    ? [...retained.slice(0, -1), { ...retained[retained.length - 1], end: at }]
    : [...retained, { start: at, end: at, level }];
}

export function mergeRecordedHistory(recorded: ObservationSpan[], observed: ObservationSpan[], generatedAt: number) {
  const result = [...recorded];
  for (const span of observed) {
    if (span.end <= generatedAt) continue;
    const last = result.at(-1);
    if (last && span.end <= last.end) continue;
    const start = span.start > generatedAt ? span.start : span.end;
    if (last && span.level === last.level && start - last.end <= OBSERVATION_GAP_MS) {
      result[result.length - 1] = { ...last, end: span.end };
    } else result.push({ start, end: span.end, level: span.level });
  }
  return result;
}

export function observationTrend(spans: ObservationSpan[], now: number) {
  const latest = spans.at(-1);
  const previous = spans.at(-2);
  if (!latest || latest.level === null || now - latest.end > OBSERVATION_GAP_MS)
    return { label: 'Unconfirmed', delta: null };
  if (!previous || previous.level === null || latest.start - previous.end > OBSERVATION_GAP_MS)
    return latest.end > latest.start ? { label: 'Steady', delta: 0 }
      : { label: 'First reading', delta: null };
  const delta = latest.level - previous.level;
  if (now - latest.start > 15 * 60_000 || !delta) return { label: 'Steady', delta: 0 };
  return { label: delta > 0 ? 'Rising' : 'Falling', delta };
}

export function useObservationHistory(nodes: FlowNode[], selectedId: string | null) {
  const cache = useRef(new Map<string, Entry>());
  const [view, setView] = useState<View>(emptyView);
  const retry = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!selectedId) return;
    const node = nodes.find(node => node.id === selectedId);
    if (!node) return;
    const previous = cache.current.get(selectedId)
      ?? { spans: emptySpans, fetchedAt: 0, recorded: false };
    const spans = appendObservation(previous.spans, node, Date.now());
    if (spans === previous.spans) return;
    const entry = { ...previous, spans };
    cache.current.delete(selectedId);
    cache.current.set(selectedId, entry);
    while (cache.current.size > 6) cache.current.delete(cache.current.keys().next().value!);
    setView(current => ({ ...entry, nodeId: selectedId,
      loading: current.nodeId === selectedId && current.loading,
      error: current.nodeId === selectedId && current.error }));
  }, [nodes, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setView(emptyView);
      return;
    }
    const nodeId = selectedId;
    let active = true;
    let busy = false;
    let lastAttempt = 0;
    let controller: AbortController | null = null;
    const initial = cache.current.get(nodeId)
      ?? { spans: emptySpans, fetchedAt: 0, recorded: false };
    setView({ ...initial, nodeId, loading: false, error: false });

    const refresh = async (force = false) => {
      const now = Date.now();
      const existing = cache.current.get(nodeId);
      if (!active || busy || (!force && (now - lastAttempt < REFETCH_MS
        || (existing?.recorded && now - existing.fetchedAt < REFETCH_MS)))) return;
      busy = true;
      lastAttempt = now;
      controller = new AbortController();
      const requestController = controller;
      const timeout = setTimeout(() => requestController.abort(), 20_000);
      setView(current => ({ ...current, nodeId, loading: true, error: false }));
      try {
        const response = await fetch(`/api/node-history?node_id=${encodeURIComponent(nodeId)}`, {
          cache: 'no-store', signal: requestController.signal,
        });
        if (!response.ok) throw new Error('Recorded history unavailable');
        const data = parseRecordedHistory(await response.json(), nodeId);
        if (!active) return;
        const observed = cache.current.get(nodeId)?.spans ?? emptySpans;
        const entry = { spans: mergeRecordedHistory(data.spans, observed, data.generatedAt),
          fetchedAt: Date.now(), recorded: true };
        cache.current.delete(nodeId);
        cache.current.set(nodeId, entry);
        while (cache.current.size > 6) cache.current.delete(cache.current.keys().next().value!);
        setView({ ...entry, nodeId, loading: false, error: false });
      } catch {
        if (active) setView(current => ({ ...current, loading: false, error: true }));
      } finally { clearTimeout(timeout); busy = false; }
    };
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const online = () => { void refresh(true); };
    retry.current = () => { void refresh(true); };
    void refresh();
    window.addEventListener('focus', visible);
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      controller?.abort();
      retry.current = null;
      window.removeEventListener('focus', visible);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [selectedId]);

  const retryHistory = useCallback(() => retry.current?.(), []);
  return { spans: view.nodeId === selectedId ? view.spans : emptySpans,
    recorded: view.nodeId === selectedId && view.recorded,
    loading: view.nodeId === selectedId && view.loading,
    error: view.nodeId === selectedId && view.error, retryHistory };
}
