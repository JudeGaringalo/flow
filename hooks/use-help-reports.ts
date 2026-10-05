'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import { config } from '@/lib/config';
import { HELP_REPORT_FIELDS, parseHelpReport, type HelpDraft, type HelpReport } from '@/lib/help-reports';

const TOKEN_KEY = 'flow.help-report.token.v1';

async function identity(create: boolean): Promise<{ token: string; id: string } | null> {
  let token = localStorage.getItem(TOKEN_KEY);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    if (!create) return null;
    token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(TOKEN_KEY, token);
    if (localStorage.getItem(TOKEN_KEY) !== token) throw new Error('Browser storage is unavailable.');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return { token, id: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') };
}

type Change = { id: string; report: HelpReport | null };

export function useHelpReports(enabled: boolean) {
  const [reports, setReports] = useState<HelpReport[]>([]);
  const [ownId, setOwnId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const [notice, setNotice] = useState('');
  const [readAttempt, setReadAttempt] = useState(0);
  const rows = useRef(new Map<string, HelpReport>());
  const lock = useRef(false);
  const refreshRef = useRef<() => void>(() => {});
  const changedDuringRead = useRef<Change[] | null>(null);

  const commit = useCallback(() => {
    const now = Date.now();
    for (const [id, report] of rows.current) {
      if (Date.parse(report.expires_at) <= now) rows.current.delete(id);
    }
    setReports([...rows.current.values()].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)));
  }, []);

  const apply = useCallback((change: Change) => {
    changedDuringRead.current?.push(change);
    if (change.report) rows.current.set(change.id, change.report);
    else rows.current.delete(change.id);
    commit();
  }, [commit]);

  useEffect(() => {
    const readIdentity = () => {
      void identity(false).then(value => setOwnId(value?.id ?? null)).catch(() => setOwnId(null));
    };
    readIdentity();
    const storage = (event: StorageEvent) => { if (!event.key || event.key === TOKEN_KEY) readIdentity(); };
    window.addEventListener('storage', storage);
    return () => window.removeEventListener('storage', storage);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    setLive(false);
    if (!config.configured) {
      setLoading(false);
      setError('Help reports are unavailable until FLOW is connected.');
      return;
    }
    let cancelled = false;
    let db: SupabaseClient | null = null;
    let channel: RealtimeChannel | null = null;
    let connected = false;
    let reading = false;
    let reread = false;
    let lastRead = 0;
    let controller: AbortController | null = null;

    async function sync() {
      if (cancelled) return;
      if (!navigator.onLine) {
        setLoading(false);
        setLive(false);
        setError('You are offline. Reconnect to see current help requests.');
        return;
      }
      if (!db || document.hidden) return;
      if (reading) { reread = true; return; }
      reading = true;
      changedDuringRead.current = [];
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 15000);
      const next = new Map<string, HelpReport>();
      try {
        let after = '';
        const now = new Date().toISOString();
        for (;;) {
          let query = db.from('flow_help_reports').select(HELP_REPORT_FIELDS)
            .gt('expires_at', now).order('id').limit(500);
          if (after) query = query.gt('id', after);
          const { data, error: readError } = await query.abortSignal(controller.signal);
          if (readError) throw readError;
          if (cancelled) return;
          for (const value of data || []) {
            const report = parseHelpReport(value);
            if (report) next.set(report.id, report);
          }
          if (!data || data.length < 500) break;
          const cursor = data[data.length - 1]?.id;
          if (typeof cursor !== 'string' || cursor <= after) throw new Error('Invalid report page');
          after = cursor;
        }
        for (const change of changedDuringRead.current || []) {
          if (change.report) next.set(change.id, change.report);
          else next.delete(change.id);
        }
        rows.current = next;
        commit();
        setError('');
        lastRead = Date.now();
      } catch {
        if (!cancelled) setError('Help reports could not refresh. Check your connection and retry.');
      } finally {
        clearTimeout(timeout);
        if (!cancelled) {
          changedDuringRead.current = null;
          reading = false;
          setLoading(false);
          if (reread) { reread = false; void sync(); }
        }
      }
    }

    refreshRef.current = () => {
      if (!db) setReadAttempt(value => value + 1);
      else void sync();
    };
    void getSupabase().then(client => {
      if (cancelled) return;
      db = client;
      channel = db.channel('flow-public-help-reports')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'flow_help_reports' }, payload => {
          if (cancelled) return;
          if (payload.eventType === 'DELETE') {
            if (typeof payload.old.id === 'string') apply({ id: payload.old.id, report: null });
          } else {
            const report = parseHelpReport(payload.new);
            if (report) apply({ id: report.id, report });
          }
        })
        .subscribe(status => {
          if (cancelled) return;
          connected = status === 'SUBSCRIBED';
          setLive(connected);
          if (connected) void sync();
        });
      void sync();
    }).catch(() => {
      if (!cancelled) {
        setLoading(false);
        setError('Help reports are unavailable. Check your connection and retry.');
      }
    });

    const resume = () => { commit(); refreshRef.current(); };
    const offline = () => {
      connected = false;
      setLive(false);
      setLoading(false);
      setError('You are offline. Reconnect to see current help requests.');
    };
    const timer = setInterval(() => {
      commit();
      if ((!connected || Date.now() - lastRead > 300000) && !document.hidden && navigator.onLine)
        refreshRef.current();
    }, 30000);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('offline', offline);
    return () => {
      cancelled = true;
      controller?.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', offline);
      refreshRef.current = () => {};
      changedDuringRead.current = null;
      if (channel && db) void db.removeChannel(channel);
    };
  }, [enabled, readAttempt, apply, commit]);

  async function mutate(method: 'POST' | 'DELETE', draft?: HelpDraft): Promise<boolean> {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setMutationError('');
    setNotice('');
    try {
      if (!navigator.onLine) throw new Error('You are offline. Reconnect before publishing or removing a request.');
      let owner;
      try { owner = await identity(method === 'POST'); }
      catch { throw new Error('Allow browser storage so you can manage and remove your request later.'); }
      if (!owner) throw new Error('Open the browser you used to publish this request to remove it.');
      setOwnId(owner.id);
      const response = await fetch('/api/help-reports', {
        method, cache: 'no-store', signal: AbortSignal.timeout(20000),
        headers: { 'Content-Type': 'application/json', 'x-flow-report-token': owner.token },
        ...(draft ? { body: JSON.stringify(draft) } : {}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Your request could not be saved. Try again.');
      if (method === 'POST') {
        const report = parseHelpReport(data.report);
        if (!report || report.id !== owner.id) throw new Error('Could not confirm your report. Refresh before trying again.');
        apply({ id: report.id, report });
        setNotice('Your help request is now visible on the map.');
      } else {
        apply({ id: owner.id, report: null });
        setNotice('Your help request has been removed from the map.');
      }
      return true;
    } catch (cause) {
      const message = cause instanceof Error && cause.name !== 'TimeoutError'
        ? cause.message : 'Could not confirm the update. Check your connection, then retry.';
      setMutationError(message);
      refreshRef.current();
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return {
    reports, ownId, own: reports.find(report => report.id === ownId) ?? null,
    loading, live, error, busy, mutationError, notice,
    refresh: () => refreshRef.current(),
    publish: (draft: HelpDraft) => mutate('POST', draft),
    resolve: () => mutate('DELETE'),
  };
}

export type HelpReportsState = ReturnType<typeof useHelpReports>;
