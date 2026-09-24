'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode
} from 'react';
import { config } from '@/lib/config';
import { isBasemap } from '@/lib/map-styles';
import { ageText, distance, nodeStatus } from '@/lib/core';
import { getSupabase, loadNodes } from '@/lib/supabase';
import type { Basemap, Connection, FlowNode, ModalKind, StatusKey } from '@/lib/types';

type Toast = { id: number; text: string; error: boolean };
const basemapKey = `flow-next:basemap:${encodeURIComponent(config.supabaseUrl)}`;

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
  const mounted = useRef(true);
  const requestRef = useRef(0);
  const toastTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const notify = useCallback((message: string, error = false) => {
    const id = Date.now() + Math.random();
    setToasts(list => [...list.slice(-2), { id, text: message, error }]);
    toastTimers.current.push(setTimeout(() => setToasts(list => list.filter(t => t.id !== id)), 6000));
  }, []);

  const refreshLive = useCallback(async () => {
    if (!config.configured) {
      setConnection('unconfigured');
      return;
    }
    const request = ++requestRef.current;
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
    try {
      const stored = localStorage.getItem(basemapKey);
      if (isBasemap(stored)) setBasemap(stored);
    } catch { /* Storage is optional. */ }
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
    if (!ready) return;
    try { localStorage.setItem(basemapKey, basemap); } catch { /* Storage is optional. */ }
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
    // A missed broadcast never leaves an open map permanently out of date.
    const fallback = setInterval(() => {
      if (navigator.onLine) void refreshLive();
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
