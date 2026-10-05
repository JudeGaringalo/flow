'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyzeIntelligence, intelligenceStateKey, sensorSummary, timingPresentation,
  type IntelligenceResponse, type IntelligenceSpan } from '@/lib/flow-intelligence';
import type { FlowNode } from '@/lib/types';

type View = { key: string; data: IntelligenceResponse | null; loading: boolean; error: boolean };

export function useFlowIntelligence(node: FlowNode | null, spans: IntelligenceSpan[], offline: boolean) {
  const analysis = useMemo(() => node ? analyzeIntelligence(node, spans, Date.now(), offline) : null,
    [node, spans, offline]);
  const key = node && analysis ? intelligenceStateKey(node, analysis.status) : '';
  const nodeId = node?.id ?? '';
  const valid = analysis?.level !== null && analysis !== null;
  const cache = useRef(new Map<string, { data: IntelligenceResponse; expires: number }>());
  const [view, setView] = useState<View>({ key: '', data: null, loading: false, error: false });
  const retryRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!nodeId || !valid) return;
    let active = true;
    let busy = false;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cached = cache.current.get(key);
    setView({ key, data: cached?.data ?? null, loading: false, error: false });

    const refresh = async (force = false) => {
      if (!active || busy || !navigator.onLine) return;
      const previous = cache.current.get(key);
      if (!force && previous && previous.expires > Date.now()) {
        if (previous.data.retryAfterSeconds !== null && !timer) {
          timer = setTimeout(() => {
            timer = null;
            if (document.visibilityState === 'visible') void refresh(true);
          }, previous.expires - Date.now());
        }
        return;
      }
      if (timer) clearTimeout(timer);
      busy = true;
      controller = new AbortController();
      const request = controller;
      const timeout = setTimeout(() => request.abort(), 40_000);
      setView(current => ({ key, data: current.key === key ? current.data : null, loading: true, error: false }));
      let retryAfter = 60;
      try {
        const response = await fetch(`/api/flow-intelligence?node_id=${encodeURIComponent(nodeId)}`, {
          cache: 'no-store', signal: request.signal,
        });
        if (!response.ok) throw new Error('Summary unavailable');
        const data = await response.json() as IntelligenceResponse;
        if (!active) return;
        if (data.nodeId !== nodeId || data.stateKey !== key) {
          retryAfter = 3;
          throw new Error('Observation changed');
        }
        if (typeof data.summary !== 'string' || data.summary.length > 650
          || !['gemini', 'sensor'].includes(data.source) || !Number.isFinite(data.generatedAt))
          throw new Error('Invalid summary');
        cache.current.delete(key);
        cache.current.set(key, { data, expires: Date.now() + (data.source === 'gemini' ? 3_600_000 : 60_000) });
        while (cache.current.size > 32) cache.current.delete(cache.current.keys().next().value!);
        setView({ key, data, loading: false, error: false });
        retryAfter = data.retryAfterSeconds === null ? 0 : Math.max(30, Math.min(300, data.retryAfterSeconds || 60));
      } catch {
        if (active) setView({ key, data: null, loading: false, error: true });
      } finally {
        clearTimeout(timeout);
        busy = false;
        if (active && retryAfter > 0) timer = setTimeout(() => {
          timer = null;
          if (document.visibilityState === 'visible') void refresh(true);
        }, retryAfter * 1000);
      }
    };
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const online = () => { void refresh(true); };
    retryRef.current = () => { void refresh(true); };
    void refresh();
    window.addEventListener('online', online);
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      active = false;
      controller?.abort();
      if (timer) clearTimeout(timer);
      retryRef.current = null;
      window.removeEventListener('online', online);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [key, nodeId, valid]);

  const retry = useCallback(() => retryRef.current?.(), []);
  const data = valid && view.key === key ? view.data : null;
  const loading = valid && view.key === key && view.loading;
  const error = valid && view.key === key && view.error;
  const basis = !valid ? 'Waiting for a recent, valid observation.'
    : loading ? 'Updating the AI summary for this observation…'
      : data?.source === 'gemini' ? 'AI summary · Updates when the sensor status changes. Conditions away from this point may differ.'
        : data?.availability === 'not-configured' ? 'Sensor summary · AI summaries are not available yet.'
          : data?.availability === 'busy' ? 'Sensor summary · AI is busy; retrying shortly.'
            : error || data?.availability === 'temporarily-unavailable' ? 'Sensor summary · AI is temporarily unavailable.'
              : 'Sensor summary · Preparing FLOW Intelligence.';
  return {
    summary: data?.summary ?? sensorSummary(analysis?.status ?? 'unavailable'),
    basis, loading, retry, canRetry: valid && !loading && (error || (!!data && data.source !== 'gemini')),
    critical: analysis ? timingPresentation(analysis.critical, 3, Date.now()) : null,
    recede: analysis ? timingPresentation(analysis.recede, 0, Date.now()) : null,
  };
}
