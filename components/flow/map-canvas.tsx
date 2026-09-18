'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import type { Map as LibreMap, Marker as LibreMarker } from 'maplibre-gl';

import { useFlow } from '@/hooks/use-flow';
import { loadBasemap } from '@/lib/map-styles';
import type { MapHandle } from '@/lib/types';

interface MarkerHost {
  id: string;
  element: HTMLElement;
}

const INITIAL_CENTER: [number, number] = [121.034, 14.58];

/** MapLibre draws geography. React renders only registered FLOW monitoring points. */
export const MapCanvas = forwardRef<MapHandle>(function MapCanvas(_, ref) {
  const flow = useFlow();
  const latest = useRef(flow);
  latest.current = flow;

  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LibreMap | null>(null);
  const library = useRef<typeof import('maplibre-gl') | null>(null);
  const markers = useRef(new Map<string, LibreMarker>());
  const userMarker = useRef<LibreMarker | null>(null);
  const [hosts, setHosts] = useState<MarkerHost[]>([]);
  const [engineReady, setEngineReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mapIssue, setMapIssue] = useState('');
  const [retry, setRetry] = useState(0);
  const lastFocused = useRef<string | null>(null);

  /** Offset the selected point into the portion not covered by the detail sheet. */
  const focus = useCallback((id: string) => {
    const instance = map.current;
    const el = container.current;
    const node = latest.current.nodes.find((item) => item.id === id);
    if (!instance || !el || !node) return;

    const sheet = document.getElementById('details');
    const mobile = window.innerWidth <= 760;
    const rect = el.getBoundingClientRect();
    const sheetRect = sheet?.getBoundingClientRect();
    const availableHeight = mobile && sheetRect
      ? Math.max(120, sheetRect.top - rect.top)
      : rect.height;
    const coveredWidth = !mobile && sheetRect ? sheetRect.width + 40 : 0;

    instance.easeTo({
      center: [node.longitude, node.latitude],
      zoom: Math.max(14, instance.getZoom()),
      offset: [
        -coveredWidth / 2,
        mobile ? (availableHeight - rect.height) / 2 + 22 : 0,
      ],
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 320,
    });
  }, []);

  const fit = useCallback(() => {
    const instance = map.current;
    const lib = library.current;
    if (!instance || !lib) return;
    const nodes = latest.current.visibleNodes.filter((node) =>
      Number.isFinite(node.latitude) && Number.isFinite(node.longitude),
    );
    if (!nodes.length) return;

    const bounds = new lib.LngLatBounds();
    for (const node of nodes) bounds.extend([node.longitude, node.latitude]);
    const h = container.current?.clientHeight ?? 640;
    const mobile = window.innerWidth <= 760;
    instance.fitBounds(bounds, {
      padding: {
        top: 100,
        bottom: latest.current.selectedId && mobile ? h * 0.64 : 80,
        left: 45,
        right: latest.current.selectedId && !mobile ? 465 : 45,
      },
      maxZoom: 14.5,
      duration: 320,
    });
  }, []);

  useImperativeHandle(ref, () => ({
    focus,
    fit,
    zoomBy(delta) {
      map.current?.zoomTo((map.current?.getZoom() ?? 14) + delta, { duration: 200 });
    },
    locate(latitude, longitude, accuracy) {
      const instance = map.current;
      const lib = library.current;
      if (!instance || !lib) return;
      userMarker.current?.remove();
      const element = document.createElement('div');
      element.className = 'user-dot';
      element.title = `Your location (reported accuracy ±${Math.round(accuracy)} m)`;
      userMarker.current = new lib.Marker({ element })
        .setLngLat([longitude, latitude])
        .addTo(instance);
      instance.easeTo({ center: [longitude, latitude], zoom: 15, duration: 320 });
    },
  }), [focus, fit]);

  useEffect(() => {
    let cancelled = false;
    let instance: LibreMap | null = null;
    let observer: ResizeObserver | null = null;

    async function initialize() {
      try {
        const lib = await import('maplibre-gl');
        if (cancelled || !container.current) return;
        library.current = lib;
        instance = new lib.Map({
          container: container.current,
          center: INITIAL_CENTER,
          zoom: 14,
          minZoom: 3,
          maxZoom: 19,
          attributionControl: false,
          style: {
            version: 8,
            sources: {},
            layers: [{
              id: 'loading-background',
              type: 'background',
              paint: { 'background-color': '#edf2f3' },
            }],
          },
        });
        map.current = instance;
        setEngineReady(true);

        instance.on('click', (event) => {
          const current = latest.current;
          if (!current.picking) return;
          current.setEditing({
            ...current.picking,
            latitude: Number(event.lngLat.lat.toFixed(6)),
            longitude: Number(event.lngLat.lng.toFixed(6)),
          });
          current.setPicking(null);
          current.setModal('node-form');
        });
        instance.on('error', () => {
          if (!cancelled) setMapIssue('Some map tiles could not load. Check your connection.');
        });

        observer = new ResizeObserver(() => instance?.resize());
        observer.observe(container.current);
      } catch {
        if (!cancelled) {
          setMapIssue('The geographic map could not start in this browser.');
          setLoading(false);
        }
      }
    }

    void initialize();
    return () => {
      cancelled = true;
      observer?.disconnect();
      for (const marker of markers.current.values()) marker.remove();
      markers.current.clear();
      userMarker.current?.remove();
      instance?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    if (!engineReady || !map.current) return;
    const instance = map.current;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let cancelled = false;
    setLoading(true);
    setMapIssue('');

    const styleLoaded = () => {
      if (!cancelled) setLoading(false);
    };
    instance.on('style.load', styleLoaded);
    void loadBasemap(flow.basemap, controller.signal)
      .then((style) => {
        if (!cancelled) instance.setStyle(style, { diff: false });
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
          setMapIssue('Map style unavailable. Your sensor readings have not been replaced.');
        }
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeout);
      instance.off('style.load', styleLoaded);
    };
  }, [engineReady, flow.basemap, retry]);

  useEffect(() => {
    const instance = map.current;
    const lib = library.current;
    if (!engineReady || !instance || !lib) return;
    const active = new Set(flow.visibleNodes.map((node) => node.id));
    const nextHosts: MarkerHost[] = [];

    for (const [id, marker] of markers.current) {
      if (!active.has(id)) {
        marker.remove();
        markers.current.delete(id);
      }
    }
    for (const node of flow.visibleNodes) {
      if (!Number.isFinite(node.latitude) || !Number.isFinite(node.longitude)) continue;
      let marker = markers.current.get(node.id);
      if (!marker) {
        marker = new lib.Marker({ element: document.createElement('div') })
          .setLngLat([node.longitude, node.latitude])
          .addTo(instance);
        markers.current.set(node.id, marker);
      }
      marker.setLngLat([node.longitude, node.latitude]);
      nextHosts.push({ id: node.id, element: marker.getElement() });
    }
    setHosts(nextHosts);
  }, [engineReady, flow.visibleNodes]);

  useEffect(() => {
    if (!engineReady || !flow.selectedId) {
      lastFocused.current = null;
      return;
    }
    // Do not reset the camera on every heartbeat or freshness tick.
    const key = `${flow.selectedId}:${flow.expanded}`;
    if (lastFocused.current === key) return;
    lastFocused.current = key;
    const frame = requestAnimationFrame(() => focus(flow.selectedId!));
    return () => cancelAnimationFrame(frame);
  }, [engineReady, flow.selectedId, flow.expanded, focus]);

  return (
    <>
      <div ref={container} id="map" aria-label="Geographic monitoring map" />
      {loading && !mapIssue && (
        <div className="map-loading" role="status">
          <span className="map-loading-dot" />
          Loading map
        </div>
      )}
      {mapIssue && (
        <div className="map-provider-notice" role="status">
          <span>{mapIssue}</span>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button>
        </div>
      )}
      {hosts.map(({ id, element }) => {
        const node = flow.nodes.find((item) => item.id === id);
        if (!node) return null;
        const status = flow.getStatus(node);
        return createPortal(
          <button
            type="button"
            className={`map-node${flow.selectedId === id ? ' selected' : ''}`}
            style={{ '--status-color': status.color } as CSSProperties}
            data-unavailable={status.level === null}
            aria-label={`${node.name}: ${status.label}. Open details.`}
            aria-pressed={flow.selectedId === id}
            onClick={(event) => {
              event.stopPropagation();
              if (!flow.picking) flow.selectNode(id);
            }}
          >
            <span className="marker-label">{node.name}</span>
            <span className="pin-ring" />
          </button>,
          element,
          id,
        );
      })}
    </>
  );
});

