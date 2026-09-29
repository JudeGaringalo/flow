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
import type { ExpressionSpecification, GeoJSONSource, LayerSpecification, Map as LibreMap, Marker as LibreMarker } from 'maplibre-gl';

import { useFlow } from '@/hooks/use-flow';
import { loadBasemap } from '@/lib/map-styles';
import type { Basemap, MapHandle } from '@/lib/types';

interface MarkerHost {
  id: string;
  element: HTMLElement;
}

// The farthest zoom-out view, including the western and southern islands.
const PHILIPPINES_BOUNDS: [[number, number], [number, number]] = [
  [112, 4],
  [128, 22],
];
// Start near the middle of NCR at a city-level zoom.
const METRO_MANILA_CENTER: [number, number] = [121.03, 14.595];
// Give wide screens room to show the full archipelago; the camera center is
// constrained to PHILIPPINES_BOUNDS below.
const MAP_LIMITS: [[number, number], [number, number]] = [
  [100, -5],
  [142, 31],
];

const HEAT_SOURCE_ID = 'flow-sensor-heat';
const BUILDINGS_3D_ID = 'flow-buildings-3d';
const CITY_PITCH = 60;
const CITY_BEARING = -17;
const FOCUS_ZOOM = 17;

function heatPalette(red: number, green: number, blue: number): ExpressionSpecification {
  const color = (alpha: number) => `rgba(${red},${green},${blue},${alpha})`;
  return ['interpolate', ['linear'], ['heatmap-density'],
    0, color(0), .04, color(.02), .1, color(.08), .18, color(.19),
    .28, color(.37), .42, color(.56), .65, color(.77), 1, color(.92)];
}

const BLUE = (alpha: number) => `rgba(20,127,200,${alpha})`;
const YELLOW = (alpha: number) => `rgba(255,202,36,${alpha})`;
const RED = (alpha: number) => `rgba(217,47,56,${alpha})`;

// Spread each color change over a broad density range. Muted transition stops
// avoid green and violet while the outer blue fades gradually into the map.
const WATCH_HEAT: ExpressionSpecification = ['interpolate', ['linear'], ['heatmap-density'],
  0, BLUE(0), .04, BLUE(.02), .1, BLUE(.08), .18, BLUE(.19),
  .28, BLUE(.37), .33, BLUE(.45),
  .41, 'rgba(155,159,169,0.55)', .49, 'rgba(194,183,170,0.61)',
  .58, YELLOW(.76), .7, YELLOW(.86), 1, YELLOW(.96)];

const WARNING_HEAT: ExpressionSpecification = ['interpolate', ['linear'], ['heatmap-density'],
  0, BLUE(0), .04, BLUE(.02), .1, BLUE(.08), .18, BLUE(.19),
  .28, BLUE(.37), .33, BLUE(.45),
  .41, 'rgba(155,159,169,0.55)', .49, 'rgba(194,183,170,0.61)',
  .58, YELLOW(.76), .67, YELLOW(.82),
  .74, 'rgba(219,150,143,0.8)', .84, RED(.92), 1, RED(.96)];

function heatData(flow: ReturnType<typeof useFlow>) {
  return {
    type: 'FeatureCollection' as const,
    features: flow.visibleNodes.flatMap((node) => {
      const level = flow.getStatus(node).level;
      if (!level || !Number.isFinite(node.latitude) || !Number.isFinite(node.longitude)) return [];
      return [{
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [node.longitude, node.latitude] },
        properties: { level },
      }];
    }),
  };
}

// Render the spread above streets, with building footprints and labels on top.
function addHeatLayers(instance: LibreMap, flow: ReturnType<typeof useFlow>) {
  if (!instance.getSource(HEAT_SOURCE_ID)) {
    instance.addSource(HEAT_SOURCE_ID, { type: 'geojson', data: heatData(flow) });
  }

  const layers = instance.getStyle().layers;
  const beforeId = layers.find((layer) => layer.type === 'symbol')?.id;
  const roads = layers.filter((layer) => layer.type === 'line' &&
    'source-layer' in layer && layer['source-layer'] === 'transportation');
  const buildings = layers.filter((layer) => layer.type === 'fill' &&
    'source-layer' in layer && layer['source-layer'] === 'building');
  const buildingExtrusions = layers.filter((layer) => layer.type === 'fill-extrusion' &&
    layer.id !== BUILDINGS_3D_ID && 'source-layer' in layer &&
    layer['source-layer'] === 'building');
  const satellite = flow.basemap === 'satellite';
  const palettes: [number, ExpressionSpecification][] = [
    [1, heatPalette(20, 127, 200)],
    [2, WATCH_HEAT],
    [3, WARNING_HEAT],
  ];

  for (const [level, color] of palettes) {
    const id = `flow-sensor-heat-${level}`;
    const opacity: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'],
      10.5, 0, 11.5, satellite ? 0.75 : 0.85,
      12.5, satellite ? 0.85 : 0.95];
    if (instance.getLayer(id)) {
      instance.setPaintProperty(id, 'heatmap-opacity', opacity);
      instance.moveLayer(id, beforeId);
      continue;
    }
    const layer: LayerSpecification = {
      id,
      type: 'heatmap',
      source: HEAT_SOURCE_ID,
      filter: ['==', ['get', 'level'], level],
      paint: {
        'heatmap-weight': 1,
        // Let one isolated point reach the center color of its status palette.
        'heatmap-intensity': 2.3,
        'heatmap-color': color,
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'],
          10.5, 1, 11, 82, 12, 168, 13, 230, 14, 245],
        'heatmap-opacity': opacity,
      },
    };
    instance.addLayer(layer, beforeId);
  }

  // Some styles interleave road lines and text; move every street below the heat.
  for (const road of roads) instance.moveLayer(road.id, 'flow-sensor-heat-1');
  // Roof footprints remain visible, and labels stay above the color.
  for (const building of buildings) instance.moveLayer(building.id, beforeId);

  // Liberty already supplies 3D buildings. Recolor that layer instead of
  // drawing another extrusion under the original gray one.
  const color: ExpressionSpecification = ['interpolate', ['linear'],
    ['to-number', ['get', 'render_height'], 0],
    0, '#aeb2bb', 8, '#9aa4b6', 16, '#7895c8',
    30, '#547bc7', 70, '#3562b8'];
  const opacity = satellite ? 0.86 : 0.96;
  if (buildingExtrusions.length) {
    if (instance.getLayer(BUILDINGS_3D_ID)) instance.removeLayer(BUILDINGS_3D_ID);
    for (const extrusion of buildingExtrusions) {
      instance.setPaintProperty(extrusion.id, 'fill-extrusion-color', color);
      instance.setPaintProperty(extrusion.id, 'fill-extrusion-opacity', opacity);
      instance.moveLayer(extrusion.id, beforeId);
    }
  } else {
    const building = buildings.find((layer) => 'source' in layer && typeof layer.source === 'string');
    if (building && 'source' in building && typeof building.source === 'string') {
      if (instance.getLayer(BUILDINGS_3D_ID)) {
        instance.setPaintProperty(BUILDINGS_3D_ID, 'fill-extrusion-color', color);
        instance.setPaintProperty(BUILDINGS_3D_ID, 'fill-extrusion-opacity', opacity);
        instance.moveLayer(BUILDINGS_3D_ID, beforeId);
      } else {
        instance.addLayer({
          id: BUILDINGS_3D_ID,
          type: 'fill-extrusion',
          source: building.source,
          'source-layer': 'building',
          minzoom: 14,
          filter: ['!=', ['get', 'hide_3d'], true],
          paint: {
            'fill-extrusion-color': color,
            'fill-extrusion-opacity': opacity,
            'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'],
              14, 0, 15, ['to-number', ['get', 'render_height'], 0]],
            'fill-extrusion-base': ['to-number', ['get', 'render_min_height'], 0],
          },
        }, beforeId);
      }
    }
  }
}

/** MapLibre draws geography. React renders only registered FLOW monitoring points. */
export const MapCanvas = forwardRef<MapHandle, {
  onFlatViewChange: (flat: boolean) => void;
}>(function MapCanvas({ onFlatViewChange }, ref) {
  const flow = useFlow();
  const latest = useRef(flow);
  latest.current = flow;
  const flatViewChange = useRef(onFlatViewChange);
  flatViewChange.current = onFlatViewChange;

  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LibreMap | null>(null);
  const library = useRef<typeof import('maplibre-gl') | null>(null);
  const markers = useRef(new Map<string, LibreMarker>());
  const userMarker = useRef<LibreMarker | null>(null);
  const [hosts, setHosts] = useState<MarkerHost[]>([]);
  const [engineVersion, setEngineVersion] = useState(0);
  const appliedStyle = useRef<{ basemap: Basemap; retry: number } | null>(null);
  const [mapIssue, setMapIssue] = useState('');
  const [retry, setRetry] = useState(0);
  const lastFocused = useRef<string | null>(null);
  const initialNodeCentered = useRef(false);
  const viewTransitioning = useRef<number | null>(null);
  const nextViewTransition = useRef(0);
  const previousTilt = useRef<{
    center: [number, number]; zoom: number; pitch: number; bearing: number;
  } | null>(null);

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
      zoom: Math.max(FOCUS_ZOOM, instance.getZoom()),
      pitch: CITY_PITCH,
      bearing: CITY_BEARING,
      offset: [
        -coveredWidth / 2,
        mobile ? (availableHeight - rect.height) / 2 + 22 : 0,
      ],
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 320,
    });
  }, []);

  const rememberTiltedView = useCallback((instance: LibreMap) => {
    if (instance.getPitch() <= 1) return;
    const center = instance.getCenter();
    previousTilt.current = {
      center: [center.lng, center.lat],
      zoom: instance.getZoom(),
      pitch: instance.getPitch(),
      bearing: instance.getBearing(),
    };
  }, []);

  const finishViewTransitionIfIdle = useCallback((instance: LibreMap, transitionId: number) => {
    if (viewTransitioning.current !== transitionId || instance.isMoving()) return;
    viewTransitioning.current = null;
    flatViewChange.current(instance.getPitch() <= 1);
  }, []);

  const showPhilippines = useCallback((transitionId?: number) => {
    const instance = map.current;
    if (!instance) return;
    rememberTiltedView(instance);
    instance.fitBounds(PHILIPPINES_BOUNDS, {
      padding: 32,
      maxZoom: 6,
      pitch: 0,
      bearing: 0,
      duration: 320,
    }, transitionId === undefined ? undefined : { flowViewTransition: transitionId });
    if (transitionId !== undefined) finishViewTransitionIfIdle(instance, transitionId);
  }, [finishViewTransitionIfIdle, rememberTiltedView]);

  const fit = useCallback(() => {
    const instance = map.current;
    const lib = library.current;
    if (!instance || !lib || viewTransitioning.current !== null) return;
    const transitionId = ++nextViewTransition.current;
    viewTransitioning.current = transitionId;
    rememberTiltedView(instance);
    const nodes = latest.current.visibleNodes.filter((node) =>
      Number.isFinite(node.latitude) && Number.isFinite(node.longitude),
    );
    if (!nodes.length) {
      showPhilippines(transitionId);
      return;
    }
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
      pitch: 0,
      bearing: 0,
      duration: 320,
    }, { flowViewTransition: transitionId });
    finishViewTransitionIfIdle(instance, transitionId);
  }, [finishViewTransitionIfIdle, rememberTiltedView, showPhilippines]);

  useImperativeHandle(ref, () => ({
    focus,
    fit,
    showPhilippines,
    restoreTilt() {
      const instance = map.current;
      if (!instance || viewTransitioning.current !== null) return;
      const transitionId = ++nextViewTransition.current;
      viewTransitioning.current = transitionId;
      instance.easeTo({
        ...(previousTilt.current ?? {
          center: METRO_MANILA_CENTER,
          zoom: 15,
          pitch: CITY_PITCH,
          bearing: CITY_BEARING,
        }),
        duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 320,
      }, { flowViewTransition: transitionId });
      finishViewTransitionIfIdle(instance, transitionId);
    },
    zoomBy(delta) {
      map.current?.zoomTo((map.current?.getZoom() ?? 14) + delta, { duration: 200 });
    },
    locate(latitude, longitude, accuracy) {
      const instance = map.current;
      const lib = library.current;
      if (!instance || !lib ||
          longitude < PHILIPPINES_BOUNDS[0][0] || longitude > PHILIPPINES_BOUNDS[1][0] ||
          latitude < PHILIPPINES_BOUNDS[0][1] || latitude > PHILIPPINES_BOUNDS[1][1]) return false;
      userMarker.current?.remove();
      const element = document.createElement('div');
      element.className = 'user-dot';
      element.title = `Your location (reported accuracy ±${Math.round(accuracy)} m)`;
      userMarker.current = new lib.Marker({ element })
        .setLngLat([longitude, latitude])
        .addTo(instance);
      instance.easeTo({ center: [longitude, latitude], zoom: 15,
        pitch: CITY_PITCH, bearing: CITY_BEARING, duration: 320 });
      return true;
    },
  }), [finishViewTransitionIfIdle, focus, fit, showPhilippines]);

  useEffect(() => {
    if (!flow.ready) return;
    let cancelled = false;
    let instance: LibreMap | null = null;
    let observer: ResizeObserver | null = null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const initialMode = latest.current.basemap;

    setMapIssue('');
    setHosts([]);

    async function initialize() {
      try {
        // Download the map engine and the provider style at the same time.
        const [lib, style] = await Promise.all([
          import('maplibre-gl'),
          loadBasemap(initialMode, controller.signal),
        ]);
        if (cancelled || !container.current) return;
        library.current = lib;
        instance = new lib.Map({
          container: container.current,
          center: METRO_MANILA_CENTER,
          zoom: 15,
          pitch: CITY_PITCH,
          bearing: CITY_BEARING,
          canvasContextAttributes: { antialias: true },
          maxBounds: MAP_LIMITS,
          renderWorldCopies: false,
          transformCameraUpdate: ({ center }) => {
            const longitude = Math.min(PHILIPPINES_BOUNDS[1][0],
              Math.max(PHILIPPINES_BOUNDS[0][0], center.lng));
            const latitude = Math.min(PHILIPPINES_BOUNDS[1][1],
              Math.max(PHILIPPINES_BOUNDS[0][1], center.lat));
            return longitude === center.lng && latitude === center.lat
              ? {}
              : { center: new lib.LngLat(longitude, latitude) };
          },
          minZoom: 3,
          maxZoom: 19,
          maxPitch: 60,
          attributionControl: false,
          style,
        });
        map.current = instance;
        viewTransitioning.current = null;
        flatViewChange.current(instance.getPitch() <= 1);
        appliedStyle.current = { basemap: initialMode, retry };
        instance.on('style.load', () => {
          if (instance) addHeatLayers(instance, latest.current);
        });
        instance.on('moveend', (event) => {
          if (cancelled || !instance) return;
          if (viewTransitioning.current !== null) {
            if ((event as { flowViewTransition?: number }).flowViewTransition !== viewTransitioning.current) return;
            viewTransitioning.current = null;
          }
          flatViewChange.current(instance.getPitch() <= 1);
        });
        instance.on('error', () => {
          if (!cancelled) setMapIssue('Some map tiles could not load. Check your connection.');
        });

        const updateCountryZoomLimit = () => {
          if (!instance) return;
          instance.resize();
          // Recalculate for the viewport so the country is the farthest zoom-out
          // on both narrow phones and wide desktop screens.
          const countryView = instance.cameraForBounds(PHILIPPINES_BOUNDS, { padding: 32 });
          if (countryView) instance.setMinZoom(countryView.zoom);
        };
        observer = new ResizeObserver(updateCountryZoomLimit);
        observer.observe(container.current);
        updateCountryZoomLimit();
        setEngineVersion((version) => version + 1);
      } catch {
        if (!cancelled) {
          setMapIssue('The map could not start. Check your connection and try again.');
        }
      }
    }

    void initialize();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeout);
      observer?.disconnect();
      for (const marker of markers.current.values()) marker.remove();
      markers.current.clear();
      userMarker.current?.remove();
      instance?.remove();
      map.current = null;
      appliedStyle.current = null;
      initialNodeCentered.current = false;
      previousTilt.current = null;
      viewTransitioning.current = null;
    };
  }, [flow.ready, retry]);

  // Once the first sensor arrives, keep the close opening view on that sensor.
  useEffect(() => {
    const instance = map.current;
    if (!engineVersion || !instance || initialNodeCentered.current || !flow.nodes.length) return;
    const node = flow.nodes.filter((item) =>
      Number.isFinite(item.latitude) && Number.isFinite(item.longitude) &&
      item.longitude >= PHILIPPINES_BOUNDS[0][0] &&
      item.longitude <= PHILIPPINES_BOUNDS[1][0] &&
      item.latitude >= PHILIPPINES_BOUNDS[0][1] &&
      item.latitude <= PHILIPPINES_BOUNDS[1][1])
      .sort((a, b) =>
        (a.longitude - METRO_MANILA_CENTER[0]) ** 2 +
        (a.latitude - METRO_MANILA_CENTER[1]) ** 2 -
        (b.longitude - METRO_MANILA_CENTER[0]) ** 2 -
        (b.latitude - METRO_MANILA_CENTER[1]) ** 2)[0];
    if (!node) return;
    initialNodeCentered.current = true;
    if (!flow.selectedId) instance.easeTo({ center: [node.longitude, node.latitude], duration: 320 });
  }, [engineVersion, flow.nodes, flow.selectedId]);

  useEffect(() => {
    if (!engineVersion || !map.current) return;
    if (appliedStyle.current?.basemap === flow.basemap &&
        appliedStyle.current.retry === retry) return;
    const instance = map.current;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let cancelled = false;
    setMapIssue('');

    void loadBasemap(flow.basemap, controller.signal)
      .then((style) => {
        if (!cancelled) {
          // Keep the shared vector source and its already loaded tiles when possible.
          instance.setStyle(style, { diff: true });
          appliedStyle.current = { basemap: flow.basemap, retry };
          // Diffed styles do not emit style.load. Apply FLOW layers now when
          // the new style is ready; a full rebuild still uses the listener.
          const currentStyle = instance.getStyle();
          if (currentStyle?.name === style.name && currentStyle.layers?.length) {
            addHeatLayers(instance, latest.current);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMapIssue('Map style unavailable. Your sensor readings have not been replaced.');
        }
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [engineVersion, flow.basemap, retry]);

  useEffect(() => {
    const instance = map.current;
    if (!engineVersion || !instance) return;
    const source = instance.getSource(HEAT_SOURCE_ID) as GeoJSONSource | undefined;
    if (source) void source.setData(heatData(flow));
  }, [engineVersion, flow.visibleNodes, flow.getStatus]);

  useEffect(() => {
    const instance = map.current;
    const lib = library.current;
    if (!engineVersion || !instance || !lib) return;
    const active = new Set(flow.visibleNodes.map((node) => node.id));
    const nextHosts: MarkerHost[] = [];
    let hostsChanged = false;

    for (const [id, marker] of markers.current) {
      if (!active.has(id)) {
        marker.remove();
        markers.current.delete(id);
        hostsChanged = true;
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
        hostsChanged = true;
      } else {
        const position = marker.getLngLat();
        if (position.lng !== node.longitude || position.lat !== node.latitude)
          marker.setLngLat([node.longitude, node.latitude]);
      }
      nextHosts.push({ id: node.id, element: marker.getElement() });
    }
    if (hostsChanged) setHosts(nextHosts);
  }, [engineVersion, flow.visibleNodes]);

  useEffect(() => {
    if (!engineVersion || !flow.selectedId) {
      lastFocused.current = null;
      return;
    }
    // Do not reset the camera on every heartbeat or freshness tick.
    const key = `${flow.selectedId}:${flow.expanded}`;
    if (lastFocused.current === key) return;
    lastFocused.current = key;
    const frame = requestAnimationFrame(() => focus(flow.selectedId!));
    return () => cancelAnimationFrame(frame);
  }, [engineVersion, flow.selectedId, flow.expanded, focus]);

  return (
    <>
      <div ref={container} id="map" aria-label="Geographic monitoring map" />
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
            data-level={status.level ?? 'unavailable'}
            data-unavailable={status.level === null}
            aria-label={`${node.name}: ${status.label} at this sensor. Open details.`}
            aria-pressed={flow.selectedId === id}
            title={`${status.label} at this sensor. Shading does not show flood extent.`}
            onClick={(event) => {
              event.stopPropagation();
              flow.selectNode(id);
              focus(id);
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
