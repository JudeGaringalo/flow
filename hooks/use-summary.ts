'use client';

import { useEffect, useState } from 'react';
import { useFlow } from './use-flow';
import { config } from '@/lib/config';
import { ensureSession, invoke } from '@/lib/supabase';
import type { Summary } from '@/lib/types';

const cache = new Map<string, Summary>();

export function useSummary() {
  const f = useFlow(), n = f.selected;
  const [resolvedSignature, setResolvedSignature] = useState('');
  const [result, setResult] = useState<Summary | null>(null),
    [loading, setLoading] = useState(false),
    [retry, setRetry] = useState(0);
  const status = n ? f.getStatus(n) : null;
  const signature = n
    ? [
      config.supabaseUrl,
      n.id,
      n.state_version,
      status?.key,
      f.offline,
      f.nearby.map(a => `${a.id}:${a.state_version}:${f.getStatus(a).key}`).join(',')
    ].join('|')
    : '';
  const minute = Math.floor(f.now / 60000);
  const eventCount = n ? (f.histories[n.id] || []).length : 0;

  useEffect(
    () => {
      let cancelled = false;
      if (!n || status?.level === null) {
        setResult(null);
        setLoading(false);
        return;
      }

      const found = cache.get(signature);
      if (found && found.expires > Date.now()) {
        setResult(found);
        setResolvedSignature(signature);
        setLoading(false);
        return;
      }

      setLoading(true);
      setResult(null);
      void (async () => {
        let value: Summary;
        try {
          await ensureSession();
          const data = await invoke<{
            summary: string;
            provider: 'gemini' | 'fallback';
            source_version: number;
            expires_at?: string;
          }>('flow-intelligence', { node_id: n.id });
          if (data.source_version !== n.state_version)
            throw new Error('Observation changed while generating summary.');

          value = {
            text: data.summary,
            provider: data.provider,
            version: n.state_version,
            expires: data.expires_at ? Date.parse(data.expires_at) : Date.now() + 60000
          };
        }
        catch {
          value = {
            text: 'The AI summary is unavailable. Refer to the measured status and recorded sensor history. No forecast is being made.',
            provider: 'fallback',
            version: n.state_version,
            expires: Date.now() + 30000
          };
        }

        if (cancelled)
          return;

        cache.set(signature, value);
        setResult(value);
        setResolvedSignature(signature);
        setLoading(false);
      })();
      return () => {
        cancelled = true;
      };
    },
    [signature, minute, eventCount, retry]
  );
  const valid = resolvedSignature === signature && result && n && result.version === n.state_version
    && result.expires > f.now
    ? result
    : null;
  return {
    result: valid,
    loading,
    refresh() {
      cache.delete(signature);
      setRetry(v => v + 1);
    }
  };
}
