'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import type { User } from '@supabase/supabase-js';
import { config } from '@/lib/config';
import { isBasemap } from '@/lib/map-styles';
import { ageText, distance, nodeStatus, shouldAlert } from '@/lib/core';
import * as api from '@/lib/supabase';
import type {
  Activity,
  Basemap,
  Connection,
  FlowNode,
  Follow,
  ModalKind,
  NodeInput,
  Observation,
  StatusKey,
  Theme
} from '@/lib/types';

type Toast = {
  id: number;
  text: string;
  error: boolean;
};

// Versioned and project-scoped: old demo bookmarks/activity cannot bleed into live state.
const storageKey = `flow-next:live-only:v1:${encodeURIComponent(config.supabaseUrl)}:`;

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(storageKey + key);
    return raw ? JSON.parse(raw) : fallback;
  }
  catch {
    return fallback;
  }
}

function writeStore(key: string, value: unknown) {
  try {
    localStorage.setItem(storageKey + key, JSON.stringify(value));
  }
  catch { /* Storage may be restricted. */ }
}

function useFlowController() {
  const [ready, setReady] = useState(false), [now, setNow] = useState(0);
  // Never seed observations or restore them from localStorage. Load only from Supabase.
  const [nodes, setNodes] = useState<FlowNode[]>([]),
    [histories, setHistories] = useState<Record<string, Observation[]>>({});
  const [historyError, setHistoryError] = useState(''),
    [historyTruncated, setHistoryTruncated] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null),
    [tab, setTab] = useState<'overview' | 'history' | 'device'>('overview');
  const [range, setRange] = useState(24),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState<StatusKey | 'all' | 'online'>('all');
  const [view, setView] = useState<'all' | 'saved'>('all'),
    [listOpen, setListOpen] = useState(false);
  const [expanded, setExpanded] = useState(false),
    [theme, setTheme] = useState<Theme>('light'),
    [basemap, setBasemap] = useState<Basemap>('standard');
  const [saved, setSaved] = useState<string[]>([]),
    [follows, setFollows] = useState<Record<string, Follow>>({});
  const [activity, setActivity] = useState<Activity[]>([]),
    [toasts, setToasts] = useState<Toast[]>([]);
  const [modal, setModal] = useState<ModalKind | null>(null),
    [editing, setEditing] = useState<NodeInput | null>(null);
  const [picking, setPicking] = useState<NodeInput | null>(null),
    [newToken, setNewToken] = useState<{
      id: string;
      token: string;
    } | null>(null);
  const [online, setOnline] = useState(true),
    [connection, setConnection] = useState<Connection>(config.configured ? 'loading' : 'unconfigured');
  const [connectionError, setConnectionError] = useState('');
  const [admin, setAdmin] = useState<User | null>(null);
  const toastTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const nodesRef = useRef(nodes),
    followsRef = useRef(follows),
    requestRef = useRef(0),
    mounted = useRef(true);
  nodesRef.current = nodes;
  followsRef.current = follows;
  const notify = useCallback(
    (text: string, error = false) => {
      const id = Date.now() + Math.random();
      setToasts(t => [
        ...t.slice(-2),
        {
          id,
          text,
          error
        }
      ]);
      toastTimers.current.push(setTimeout(() => setToasts(t => t.filter(a => a.id !== id)), 6000));
    },
    []
  );
  const recordActivity = useCallback(
    (node: FlowNode, old?: FlowNode) => {
      const preference = followsRef.current[node.id];
      if (!preference || !shouldAlert(old, node, preference.min_level))
        return;

      const status = nodeStatus(node, Date.now());
      setActivity(
        items => [
          {
            id: `${node.id}:${node.state_version}`,
            node_id: node.id,
            name: node.name,
            text: `${status.label} · Level ${status.level} reached`,
            at: node.last_seen!,
            read: false
          },
          ...items
        ].slice(
          0,
          100
        )
      );
      notify(`${node.name}: ${status.label}`);
    },
    [notify]
  );
  const refreshLive = useCallback(
    async () => {
      if (!config.configured) {
        setConnection('unconfigured');
        setConnectionError('');
        return;
      }

      const request = ++requestRef.current;
      try {
        const incoming = await api.loadNodes();
        if (!mounted.current || request !== requestRef.current)
          return;

        const old = new Map(nodesRef.current.map(n => [n.id, n]));
        for (const node of incoming) {
          const before = old.get(node.id);
          if (before && before.state_version !== node.state_version)
            recordActivity(node, before);
        }

        nodesRef.current = incoming;
        setNodes(incoming);
        setConnection('live');
        setConnectionError('');
      }
      catch (e) {
        if (request === requestRef.current && mounted.current) {
          setConnection('error');
          setConnectionError(e instanceof Error ? e.message : 'Could not refresh sensor observations.');
          // Real observations already loaded this session remain visible only as unavailable.
          // There is deliberately no fallback to sample or stored observations.
        }
      }
    },
    [recordActivity]
  );

  useEffect(
    () => {
      mounted.current = true;
      setNow(Date.now());
      setOnline(navigator.onLine);
      setTheme(readStore<Theme>('theme', 'light'));
      const storedBasemap = readStore<unknown>('basemap', 'standard');
      setBasemap(isBasemap(storedBasemap) ? storedBasemap : 'standard');
      setSaved(readStore<string[]>('saved', []));
      // Do not import previous-version activity, example summaries or cached nodes.
      try {
        const obsolete = Object.keys(localStorage)
          .filter(
            k => k.startsWith('flow-next:demo:') || k.startsWith('flow-v2:demo:')
              || k === 'flow-next:public-cache'
          );
        obsolete.forEach(k => localStorage.removeItem(k));
      }
      catch { /* Private browsing may restrict storage. */ }

      const deep = new URLSearchParams(location.hash.slice(1)).get('node');
      if (deep)
        setSelectedId(deep);

      setReady(true);
      const clockTimer = setInterval(() => setNow(Date.now()), 1000);
      const connectionChanged = () => setOnline(navigator.onLine);
      const hashChanged = () => {
        setSelectedId(new URLSearchParams(location.hash.slice(1)).get('node'));
        setTab('overview');
        setExpanded(false);
      };
      window.addEventListener('online', connectionChanged);
      window.addEventListener('offline', connectionChanged);
      window.addEventListener('hashchange', hashChanged);
      return () => {
        mounted.current = false;
        ++requestRef.current;
        clearInterval(clockTimer);
        toastTimers.current.forEach(clearTimeout);
        window.removeEventListener('online', connectionChanged);
        window.removeEventListener('offline', connectionChanged);
        window.removeEventListener('hashchange', hashChanged);
      };
    },
    []
  );

  useEffect(
    () => {
      if (!ready)
        return;

      document.body.classList.toggle('light', theme === 'light');
      document.documentElement.style.colorScheme = theme;
      document.querySelector('meta[name="theme-color"]')
        ?.setAttribute(
          'content',
          theme === 'light' ? '#ffffff' : '#101d2c'
        );
      writeStore('theme', theme);
    },
    [ready, theme]
  );

  useEffect(() => {
    if (ready)
      writeStore('saved', saved);
  }, [ready, saved]);

  useEffect(() => {
    if (ready)
      writeStore('basemap', basemap);
  }, [ready, basemap]);

  useEffect(
    () => {
      if (!ready || !config.configured)
        return;

      let cancelled = false,
        dispose: undefined | (() => void),
        refreshTimer: ReturnType<typeof setTimeout> | undefined;
      void refreshLive();
      void (async () => {
        try {
          const db = await api.getSupabase();
          if (cancelled)
            return;

          const channel = db.channel('flow:public')
            .on('broadcast', { event: 'node-changed' }, () => {
              if (refreshTimer)
                return;

              refreshTimer = setTimeout(() => {
                refreshTimer = undefined;
                void refreshLive();
              }, 200);
            })
            .subscribe(
              s => {
                if (cancelled)
                  return;

                if (s === 'SUBSCRIBED')
                  void refreshLive();
              }
            );
          const { data: { subscription } } = db.auth.onAuthStateChange(
            () => {
              setTimeout(
                () => {
                  if (cancelled)
                    return;

                  void api.loadFollows().then(v => {
                    if (!cancelled)
                      setFollows(v);
                  }).catch(() => { });
                  void api.currentAdmin().then(v => {
                    if (!cancelled)
                      setAdmin(v);
                  }).catch(() => { });
                },
                0
              );
            }
          );
          dispose = () => {
            void db.removeChannel(channel);
            subscription.unsubscribe();
          };
          const [remote, installer] = await Promise.all([api.loadFollows(), api.currentAdmin()]);
          if (!cancelled) {
            setFollows(remote);
            setAdmin(installer);
          }
        }
        catch (e) {
          if (!cancelled)
            setConnectionError(e instanceof Error ? e.message : 'Supabase is not configured.');
        }
      })();
      // This re-fetches actual rows. It never rewrites a node timestamp in the browser.
      const fallback = setInterval(() => {
        if (navigator.onLine)
          void refreshLive();
      }, 30000);
      window.addEventListener('online', refreshLive);
      return () => {
        cancelled = true;
        dispose?.();
        if (refreshTimer)
          clearTimeout(refreshTimer);

        clearInterval(fallback);
        window.removeEventListener('online', refreshLive);
      };
    },
    [ready, refreshLive]
  );
  const selected = nodes.find(n => n.id === selectedId) || null;

  useEffect(
    () => {
      if (!selected || !config.configured || connection !== 'live')
        return;

      let cancelled = false;
      setHistoryError('');
      setHistoryTruncated(false);
      void api.loadHistory(selected.id)
        .then(
          ({ events, truncated }) => {
            if (!cancelled) {
              setHistories(h => ({
                ...h,
                [selected.id]: events
              }));
              setHistoryTruncated(truncated);
            }
          }
        )
        .catch(
          e => {
            if (!cancelled)
              setHistoryError(e.message || 'History could not be loaded.');
          }
        );
      return () => {
        cancelled = true;
      };
    },
    [selected?.id, selected?.state_version, connection]
  );
  const offline = !online || connection !== 'live';
  const getStatus = useCallback((node: FlowNode) => nodeStatus(node, now, offline), [now, offline]);
  const visibleNodes = useMemo(
    () => nodes.filter(
      n => {
        const s = getStatus(n);
        return (view !== 'saved' || saved.includes(n.id))
          && (!query || `${n.name} ${n.area} ${n.id}`.toLowerCase().includes(query.toLowerCase()))
          && (filter === 'all' || (filter === 'online' ? s.level !== null : s.key === filter));
      }
    ),
    [nodes, getStatus, view, saved, query, filter]
  );
  const nearby = useMemo(
    () => selected
      ? nodes.filter(n => n.id !== selected.id).map(n => ({
        ...n,
        distance: distance(selected, n)
      }))
        .filter(n => n.distance <= 3000)
        .sort((a, b) => a.distance - b.distance)
        .slice(
          0,
          3
        )
      : [],
    [nodes, selected]
  );

  function selectNode(id: string) {
    if (!nodesRef.current.some(n => n.id === id))
      return;

    setSelectedId(id);
    setTab('overview');
    setExpanded(false);
    setListOpen(false);
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

  function toggleSaved(id: string) {
    setSaved(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  }

  async function follow(id: string, min: 1 | 2 | 3 | null) {
    await api.saveFollow(id, min);
    setFollows(
      f => {
        const next = { ...f };
        if (min === null)
          delete next[id];
        else
          next[id] = { min_level: min };

        return next;
      }
    );
    if (min !== null)
      setSaved(s => s.includes(id) ? s : [...s, id]);

    notify(
      min === null
        ? 'Location alerts stopped.'
        : 'Preference saved. Enable browser push for background notifications.'
    );
  }

  async function saveNode(values: NodeInput, editingId?: string) {
    const result = await api.registerNode(editingId ? 'update' : 'create', values);
    await refreshLive();
    if (result.device_token) {
      setNewToken({
        id: values.id,
        token: result.device_token
      });
      setModal('token');
    }
    else {
      notify('Node updated.');
      setModal('admin');
    }
  }

  async function rotateToken(id: string) {
    const result = await api.registerNode('rotate', { id });
    if (result.device_token) {
      setNewToken({
        id,
        token: result.device_token
      });
      setModal('token');
    }
  }

  return {
    ready,
    now,
    nodes,
    histories,
    historyError,
    historyTruncated,
    selectedId,
    selected,
    tab,
    setTab,
    range,
    setRange,
    query,
    setQuery,
    filter,
    setFilter,
    view,
    setView,
    listOpen,
    setListOpen,
    expanded,
    setExpanded,
    theme,
    setTheme,
    basemap,
    setBasemap,
    saved,
    toggleSaved,
    follows,
    follow,
    activity,
    setActivity,
    toasts,
    notify,
    modal,
    setModal,
    editing,
    setEditing,
    picking,
    setPicking,
    newToken,
    setNewToken,
    online,
    connection,
    connectionError,
    offline,
    admin,
    setAdmin,
    getStatus,
    visibleNodes,
    nearby,
    selectNode,
    closeDetails,
    refreshLive,
    saveNode,
    rotateToken,
    age: (n: FlowNode) => ageText(n.last_seen, now)
  };
}

const FlowContext = createContext<ReturnType<typeof useFlowController> | null>(null);

export function FlowProvider({ children }: {
  children: ReactNode;
}) {
  const flow = useFlowController();

  return (
    <FlowContext.Provider value={flow}>{children}</FlowContext.Provider>
  );
}

export function useFlow() {
  const flow = useContext(FlowContext);
  if (!flow)
    throw new Error('useFlow requires FlowProvider');

  return flow;
}
