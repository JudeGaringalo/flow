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
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { ExpressionSpecification, GeoJSONSource, LayerSpecification, Map as LibreMap, Marker as LibreMarker, Popup as LibrePopup } from 'maplibre-gl';

import { Icon } from './icon';
import { useFlow } from '@/hooks/use-flow';
import { loadBasemap } from '@/lib/map-styles';
import type { MappedEvacuationSite } from '@/lib/evacuation-sites';
import type { Basemap, MapHandle } from '@/lib/types';

interface MarkerHost {
  id: string;
  element: HTMLElement;
}


const PHILIPPINES_BOUNDS: [[number, number], [number, number]] = [
  [112, 4],
  [128, 22],
];

const METRO_MANILA_CENTER: [number, number] = [121.03, 14.595];


const MAP_LIMITS: [[number, number], [number, number]] = [
  [100, -5],
  [142, 31],
];

const HEAT_SOURCE_ID = 'flow-sensor-heat';
const HAZARD_SOURCE_ID = 'flow-noah-hazard';
const HAZARD_LAYER_ID = 'flow-noah-hazard-fill';
const EVAC_SOURCE_ID = 'flow-evacuation-sites';
const EVAC_SITE_ID = 'flow-evacuation-points';
const EVAC_ICON_ID = 'flow-evacuation-icon';
const EVAC_ICON_LAYER_ID = 'flow-evacuation-icons';
const EVAC_FOOTPRINT_SOURCE_ID = 'flow-evacuation-footprint';
const EVAC_FOOTPRINT_FILL_ID = 'flow-evacuation-footprint-fill';
const EVAC_FOOTPRINT_3D_ID = 'flow-evacuation-footprint-3d';
const BUILDINGS_3D_ID = 'flow-buildings-3d';
const CITY_PITCH = 60;
const CITY_BEARING = -17;
const FOCUS_ZOOM = 17;
const HAZARD_BOUNDS = [120.85, 14.32, 121.30, 14.86] as const;
const NOAH_QUERY = 'https://services1.arcgis.com/IwZZTMxZCmAmFYvF/ArcGIS/rest/services/Flood_Control_5_Year/FeatureServer/0/query';

export type HazardState = 'off' | 'loading' | 'ready' | 'empty' | 'zoom' | 'unavailable';

function emptyHazard(): FeatureCollection<Polygon | MultiPolygon> {
  return { type: 'FeatureCollection', features: [] };
}

async function fetchNoahDirectly(box: string, signal: AbortSignal) {
  const params = new URLSearchParams({
    where: '1=1', geometry: box,
    geometryType: 'esriGeometryEnvelope', spatialRel: 'esriSpatialRelIntersects',
    inSR: '4326', outSR: '4326', returnCountOnly: 'true', f: 'json',
  });
  const countResponse = await fetch(`${NOAH_QUERY}?${params}`, { signal });
  if (!countResponse.ok) throw new Error('NOAH count unavailable');
  const countData: unknown = await countResponse.json();
  if (!countData || typeof countData !== 'object' || !('count' in countData) ||
      typeof countData.count !== 'number' || !Number.isSafeInteger(countData.count) ||
      countData.count < 0) throw new Error('Invalid NOAH count');
  if (countData.count > 2000) return { tooMany: true as const };
  if (countData.count === 0) return { tooMany: false as const, data: emptyHazard() };

  params.delete('returnCountOnly');
  params.set('outFields', 'Var');
  params.set('returnGeometry', 'true');
  params.set('resultRecordCount', '2000');
  params.set('maxAllowableOffset', '0.00002');
  params.set('geometryPrecision', '5');
  params.set('f', 'geojson');
  const response = await fetch(`${NOAH_QUERY}?${params}`, { signal });
  if (!response.ok) throw new Error('NOAH geometry unavailable');
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('type' in data) ||
      data.type !== 'FeatureCollection' || !('features' in data) ||
      !Array.isArray(data.features) || data.features.length !== countData.count ||
      'error' in data || ('exceededTransferLimit' in data && data.exceededTransferLimit))
    throw new Error('Incomplete NOAH geometry');
  return { tooMany: false as const, data: data as FeatureCollection<Polygon | MultiPolygon> };
}

function addHazardLayer(instance: LibreMap, data: FeatureCollection<Polygon | MultiPolygon>,
  visible: boolean) {
  if (!instance.getSource(HAZARD_SOURCE_ID)) {
    instance.addSource(HAZARD_SOURCE_ID, { type: 'geojson', data });
  }
  if (!instance.getLayer(HAZARD_LAYER_ID)) {
    const layers = instance.getStyle().layers;
    const beforeId = layers.find(layer =>
      (layer.type === 'fill' || layer.type === 'fill-extrusion') &&
      'source-layer' in layer && layer['source-layer'] === 'building')?.id
      ?? layers.find(layer => layer.type === 'symbol')?.id;
    instance.addLayer({
      id: HAZARD_LAYER_ID,
      type: 'fill',
      source: HAZARD_SOURCE_ID,
      paint: {
        'fill-color': ['match', ['to-number', ['get', 'Var']], 1, '#f3c949',
          2, '#f08350', 3, '#d9434b', 'rgba(0,0,0,0)'],
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 12, .7, 15, .8, 18, .84],
      },
      layout: { visibility: visible ? 'visible' : 'none' },
    }, beforeId);
  }
}

function setObservationLayerVisibility(instance: LibreMap, hazardVisible: boolean) {
  if (instance.getLayer(HAZARD_LAYER_ID))
    instance.setLayoutProperty(HAZARD_LAYER_ID, 'visibility', hazardVisible ? 'visible' : 'none');
  for (const level of [1, 2, 3]) {
    const id = `flow-sensor-heat-${level}`;
    if (instance.getLayer(id))
      instance.setLayoutProperty(id, 'visibility', hazardVisible ? 'none' : 'visible');
  }
}

function heatPalette(red: number, green: number, blue: number): ExpressionSpecification {
  const color = (alpha: number) => `rgba(${red},${green},${blue},${alpha})`;
  return ['interpolate', ['linear'], ['heatmap-density'],
    0, color(0), .04, color(.02), .1, color(.08), .18, color(.19),
    .28, color(.37), .42, color(.56), .65, color(.77), 1, color(.92)];
}

const BLUE = (alpha: number) => `rgba(20,127,200,${alpha})`;
const YELLOW = (alpha: number) => `rgba(255,202,36,${alpha})`;
const RED = (alpha: number) => `rgba(217,47,56,${alpha})`;



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

        'heatmap-intensity': 2.3,
        'heatmap-color': color,
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'],
          10.5, 1, 11, 82, 12, 168, 13, 230, 14, 245],
        'heatmap-opacity': opacity,
      },
    };
    instance.addLayer(layer, beforeId);
  }


  for (const road of roads) instance.moveLayer(road.id, 'flow-sensor-heat-1');

  for (const building of buildings) instance.moveLayer(building.id, beforeId);



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

function evacuationData(sites: MappedEvacuationSite[]) {
  return {
    type: 'FeatureCollection' as const,
    features: sites.map(site => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [site.longitude, site.latitude] },
      properties: { id: site.id },
    })),
  };
}

function emptyFootprint() {
  return { type: 'FeatureCollection' as const, features: [] };
}

function addEvacuationLayers(instance: LibreMap, sites: MappedEvacuationSite[],
  visible: boolean, icon?: HTMLImageElement | null) {
  if (!instance.getSource(EVAC_SOURCE_ID)) {
    instance.addSource(EVAC_SOURCE_ID, {
      type: 'geojson', data: evacuationData(sites),
    });
  }
  const layout = { visibility: visible ? 'visible' as const : 'none' as const };
  if (!instance.getLayer(EVAC_SITE_ID)) instance.addLayer({
    id: EVAC_SITE_ID, type: 'circle', source: EVAC_SOURCE_ID,
    layout: { visibility: 'none' },
    paint: {
      'circle-color': '#075e70', 'circle-radius': 8,
      'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5,
    },
  });
  if (icon?.complete && icon.naturalWidth && !instance.getImage(EVAC_ICON_ID)) {
    instance.addImage(EVAC_ICON_ID, icon, { pixelRatio: 3 });
  }
  if (instance.getImage(EVAC_ICON_ID) && !instance.getLayer(EVAC_ICON_LAYER_ID)) {
    instance.addLayer({
      id: EVAC_ICON_LAYER_ID, type: 'symbol', source: EVAC_SOURCE_ID,
      layout: {
        ...layout, 'icon-image': EVAC_ICON_ID, 'icon-anchor': 'bottom',
        'icon-size': ['interpolate', ['linear'], ['zoom'],
          8, 0.5, 12, 0.62, 14, 0.72, 16, 0.82, 18, 1],
        'icon-allow-overlap': true, 'icon-ignore-placement': true,
      },
    });
  }
  instance.setLayoutProperty(EVAC_SITE_ID, 'visibility',
    instance.getLayer(EVAC_ICON_LAYER_ID) ? 'none' : layout.visibility);
  if (instance.getLayer(EVAC_ICON_LAYER_ID))
    instance.setLayoutProperty(EVAC_ICON_LAYER_ID, 'visibility', layout.visibility);

  if (!instance.getSource(EVAC_FOOTPRINT_SOURCE_ID)) {
    instance.addSource(EVAC_FOOTPRINT_SOURCE_ID, { type: 'geojson', data: emptyFootprint() });
  }
  const beforeId = instance.getStyle().layers.find(layer => layer.type === 'symbol')?.id;
  if (!instance.getLayer(EVAC_FOOTPRINT_FILL_ID)) instance.addLayer({
    id: EVAC_FOOTPRINT_FILL_ID, type: 'fill', source: EVAC_FOOTPRINT_SOURCE_ID,
    minzoom: 13,
    paint: { 'fill-color': '#088b99', 'fill-opacity': 0.78,
      'fill-outline-color': '#e2ffff' },
  }, beforeId);
  if (!instance.getLayer(EVAC_FOOTPRINT_3D_ID)) instance.addLayer({
    id: EVAC_FOOTPRINT_3D_ID, type: 'fill-extrusion', source: EVAC_FOOTPRINT_SOURCE_ID,
    minzoom: 14,
    paint: { 'fill-extrusion-color': '#087b89', 'fill-extrusion-opacity': 0.92,
      'fill-extrusion-height': ['to-number', ['get', 'height'], 0],
      'fill-extrusion-base': ['to-number', ['get', 'base'], 0] },
  }, beforeId);
}


export const MapCanvas = forwardRef<MapHandle, {
  onFlatViewChange: (flat: boolean) => void;
  evacuationSites: MappedEvacuationSite[];
  showEvacuationSites: boolean;
  showHazard: boolean;
  onHazardStateChange: (state: HazardState) => void;
}>(function MapCanvas({ onFlatViewChange, evacuationSites, showEvacuationSites,
  showHazard, onHazardStateChange }, ref) {
  const flow = useFlow();
  const latest = useRef(flow);
  latest.current = flow;
  const flatViewChange = useRef(onFlatViewChange);
  flatViewChange.current = onFlatViewChange;
  const sitesRef = useRef(evacuationSites);
  sitesRef.current = evacuationSites;
  const sitesVisibleRef = useRef(showEvacuationSites);
  sitesVisibleRef.current = showEvacuationSites;
  const hazardVisibleRef = useRef(showHazard);
  hazardVisibleRef.current = showHazard;
  const hazardStateChange = useRef(onHazardStateChange);
  hazardStateChange.current = onHazardStateChange;
  const hazardData = useRef<FeatureCollection<Polygon | MultiPolygon>>(emptyHazard());
  const hazardRequest = useRef<AbortController | null>(null);
  const hazardRequestId = useRef(0);
  const hazardBoundsKey = useRef('');

  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LibreMap | null>(null);
  const library = useRef<typeof import('maplibre-gl') | null>(null);
  const markers = useRef(new Map<string, LibreMarker>());
  const userMarker = useRef<LibreMarker | null>(null);
  const sitePopup = useRef<LibrePopup | null>(null);
  const selectedEvacuationId = useRef<string | null>(null);
  const selectedFootprintKey = useRef('');
  const evacuationIcon = useRef<HTMLImageElement | null>(null);
  const [hosts, setHosts] = useState<MarkerHost[]>([]);
  const [zoomTier, setZoomTier] = useState<'wide' | 'regional' | 'city'>('city');
  const zoomTierRef = useRef<'wide' | 'regional' | 'city'>('city');
  const [engineVersion, setEngineVersion] = useState(0);
  const appliedStyle = useRef<{ basemap: Basemap; retry: number } | null>(null);
  const [mapIssue, setMapIssue] = useState('');
  const [retry, setRetry] = useState(0);
  const lastFocused = useRef<string | null>(null);
  const viewTransitioning = useRef<number | null>(null);
  const nextViewTransition = useRef(0);
  const previousTilt = useRef<{
    center: [number, number]; zoom: number; pitch: number; bearing: number;
  } | null>(null);

  const refreshHazard = useCallback((instance: LibreMap) => {
    if (!hazardVisibleRef.current || !instance.getSource(HAZARD_SOURCE_ID)) return;
    const clear = (key: string) => {
      hazardData.current = emptyHazard();
      const source = instance.getSource(HAZARD_SOURCE_ID) as GeoJSONSource | undefined;
      if (source) void source.setData(hazardData.current);
      hazardBoundsKey.current = key;
      setObservationLayerVisibility(instance, false);
    };
    if (instance.getZoom() < 12.5) {
      if (hazardBoundsKey.current === '#zoom') return;
      hazardRequest.current?.abort();
      ++hazardRequestId.current;
      clear('#zoom');
      hazardStateChange.current('zoom');
      return;
    }
    const bounds = instance.getBounds();
    const box = [
      Math.max(bounds.getWest(), HAZARD_BOUNDS[0]),
      Math.max(bounds.getSouth(), HAZARD_BOUNDS[1]),
      Math.min(bounds.getEast(), HAZARD_BOUNDS[2]),
      Math.min(bounds.getNorth(), HAZARD_BOUNDS[3]),
    ];
    if (box[0] >= box[2] || box[1] >= box[3]) {
      if (hazardBoundsKey.current === '#outside') return;
      hazardRequest.current?.abort();
      ++hazardRequestId.current;
      clear('#outside');
      hazardStateChange.current('empty');
      return;
    }
    const key = box.map(value => value.toFixed(5)).join(',');
    if (key === hazardBoundsKey.current) return;
    hazardRequest.current?.abort();
    const id = ++hazardRequestId.current;
    clear(key);
    hazardStateChange.current('loading');
    const controller = new AbortController();
    hazardRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 18_000);
    void fetch(`/api/flood-hazard?bbox=${encodeURIComponent(key)}`, { signal: controller.signal })
      .then(async response => {
        if (response.status === 422) {
          if (hazardRequestId.current === id) {
            clear(key);
            hazardStateChange.current('zoom');
          }
          return;
        }
        let data: FeatureCollection<Polygon | MultiPolygon>;
        if (response.status === 404) {
          const direct = await fetchNoahDirectly(key, controller.signal);
          if (direct.tooMany) {
            if (hazardRequestId.current === id) {
              clear(key);
              hazardStateChange.current('zoom');
            }
            return;
          }
          data = direct.data;
        } else {
          if (!response.ok) throw new Error('Hazard map unavailable');
          data = await response.json();
        }
        if (data.type !== 'FeatureCollection' || !Array.isArray(data.features))
          throw new Error('Invalid hazard map');
        if (hazardRequestId.current !== id || map.current !== instance) return;
        hazardData.current = data;
        const current = instance.getSource(HAZARD_SOURCE_ID) as GeoJSONSource | undefined;
        if (current) void current.setData(data);
        setObservationLayerVisibility(instance, hazardVisibleRef.current && data.features.length > 0);
        hazardStateChange.current(data.features.length ? 'ready' : 'empty');
      })
      .catch(() => {
        if (hazardRequestId.current !== id) return;
        clear(key);
        hazardStateChange.current('unavailable');
      })
      .finally(() => {
        clearTimeout(timeout);
        if (hazardRequest.current === controller) hazardRequest.current = null;
      });
  }, []);


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

  const refreshSelectedFootprint = useCallback((instance: LibreMap) => {
    const source = instance.getSource(EVAC_FOOTPRINT_SOURCE_ID) as GeoJSONSource | undefined;
    if (!source || !instance.isStyleLoaded()) return;
    const id = selectedEvacuationId.current;
    const site = sitesRef.current.find(item => item.id === id);
    const buildingLayers = instance.getStyle().layers.filter(layer =>
      layer.type === 'fill' && 'source-layer' in layer &&
      layer['source-layer'] === 'building').map(layer => layer.id);
    const point = site && instance.project([site.longitude, site.latitude]);
    const building = point && buildingLayers.length && instance.getZoom() >= 13
      ? instance.queryRenderedFeatures(point, { layers: buildingLayers })
        .find(feature => feature.geometry.type === 'Polygon' ||
          feature.geometry.type === 'MultiPolygon')
      : undefined;
    const key = building && site
      ? `${site.id}:${JSON.stringify(building.geometry)}` : '';
    if (selectedFootprintKey.current === key) return;
    selectedFootprintKey.current = key;
    if (!building || !site) {
      void source.setData(emptyFootprint());
      return;
    }
    void source.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', geometry: building.geometry,
        properties: {
          height: Number(building.properties?.render_height) || 0,
          base: Number(building.properties?.render_min_height) || 0,
        },
      }],
    });
  }, []);

  const focusEvacuation = useCallback((id: string) => {
    const instance = map.current;
    const lib = library.current;
    const site = sitesRef.current.find(item => item.id === id);
    if (!instance || !lib || !site) return;
    for (const layer of [EVAC_SITE_ID, EVAC_ICON_LAYER_ID]) {
      if (instance.getLayer(layer)) instance.setLayoutProperty(layer, 'visibility', 'visible');
    }
    latest.current.closeDetails();
    sitePopup.current?.remove();
    selectedEvacuationId.current = id;
    selectedFootprintKey.current = '';
    const footprint = instance.getSource(EVAC_FOOTPRINT_SOURCE_ID) as GeoJSONSource | undefined;
    if (footprint) void footprint.setData(emptyFootprint());

    const content = document.createElement('div');
    content.className = 'evacuation-popup';
    const heading = document.createElement('strong');
    heading.textContent = site.name;
    const icon = document.createElement('span');
    icon.className = 'evacuation-popup-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 9-7 9 7M5.5 9.5V20h13V9.5M10 20v-7h4v7"/></svg>';
    const location = document.createElement('span');
    location.textContent = site.city;
    const note = document.createElement('p');
    note.textContent = 'Recorded site. Confirm with your LGU that it is open and safe before traveling.';
    const links = document.createElement('div');
    links.className = 'evacuation-popup-links';
    const directions = document.createElement('a');
    directions.href = `https://www.google.com/maps/dir/?api=1&destination=${site.latitude},${site.longitude}`;
    directions.target = '_blank';
    directions.rel = 'noopener noreferrer';
    directions.textContent = 'Directions';
    links.append(directions);
    content.append(icon, heading, location, note, links);

    sitePopup.current = new lib.Popup({ offset: 16, maxWidth: '290px',
      className: 'flow-evacuation-popup' })
      .setLngLat([site.longitude, site.latitude]).setDOMContent(content).addTo(instance);
    sitePopup.current.on('close', () => {
      if (selectedEvacuationId.current !== id) return;
      selectedEvacuationId.current = null;
      selectedFootprintKey.current = '';
      const currentSource = instance.getSource(EVAC_FOOTPRINT_SOURCE_ID) as GeoJSONSource | undefined;
      if (currentSource) void currentSource.setData(emptyFootprint());
    });
    instance.easeTo({ center: [site.longitude, site.latitude],
      zoom: Math.max(15, instance.getZoom()),
      pitch: CITY_PITCH, bearing: CITY_BEARING,
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 320 });
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
    focusEvacuation,
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
  }), [finishViewTransitionIfIdle, focus, focusEvacuation, fit, showPhilippines]);

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

        const [lib, style] = await Promise.all([
          import('maplibre-gl'),
          loadBasemap(initialMode, controller.signal),
        ]);
        if (cancelled || !container.current) return;
        library.current = lib;
        const siteIcon = new Image(96, 120);
        evacuationIcon.current = siteIcon;
        siteIcon.onload = () => {
          if (!cancelled && instance && map.current === instance &&
            instance.getSource(EVAC_SOURCE_ID))
            addEvacuationLayers(instance, sitesRef.current, sitesVisibleRef.current, siteIcon);
        };
        siteIcon.src = '/assets/evacuation-marker.svg';
        const location = latest.current.alertLocation;
        const inPhilippines = location &&
          Number.isFinite(location.longitude) && Number.isFinite(location.latitude) &&
          location.longitude >= PHILIPPINES_BOUNDS[0][0] &&
          location.longitude <= PHILIPPINES_BOUNDS[1][0] &&
          location.latitude >= PHILIPPINES_BOUNDS[0][1] &&
          location.latitude <= PHILIPPINES_BOUNDS[1][1];
        const initialCenter: [number, number] = inPhilippines
          ? [location.longitude, location.latitude] : METRO_MANILA_CENTER;
        instance = new lib.Map({
          container: container.current,
          center: initialCenter,
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
        if (inPhilippines) {
          const element = document.createElement('div');
          element.className = 'user-dot';
          element.title = 'Your location';
          userMarker.current = new lib.Marker({ element })
            .setLngLat(initialCenter)
            .addTo(instance);
        }
        viewTransitioning.current = null;
        flatViewChange.current(instance.getPitch() <= 1);
        appliedStyle.current = { basemap: initialMode, retry };
        instance.on('style.load', () => {
          if (instance) {
            selectedFootprintKey.current = '';
            addHeatLayers(instance, latest.current);
            const hazardReady = hazardVisibleRef.current && hazardData.current.features.length > 0;
            addHazardLayer(instance, hazardData.current, hazardReady);
            setObservationLayerVisibility(instance, hazardReady);
            addEvacuationLayers(instance, sitesRef.current, sitesVisibleRef.current,
              evacuationIcon.current);
            if (hazardVisibleRef.current) refreshHazard(instance);
          }
        });
        instance.on('click', EVAC_SITE_ID, event => {
          const id = event.features?.[0]?.properties?.id;
          if (typeof id === 'string') focusEvacuation(id);
        });
        instance.on('click', EVAC_ICON_LAYER_ID, event => {
          const id = event.features?.[0]?.properties?.id;
          if (typeof id === 'string') focusEvacuation(id);
        });
        for (const layer of [EVAC_SITE_ID, EVAC_ICON_LAYER_ID]) {
          instance.on('mouseenter', layer, () => {
            if (instance) instance.getCanvas().style.cursor = 'pointer';
          });
          instance.on('mouseleave', layer, () => {
            if (instance) instance.getCanvas().style.cursor = '';
          });
        }
        instance.on('moveend', (event) => {
          if (cancelled || !instance) return;
          if (viewTransitioning.current !== null) {
            if ((event as { flowViewTransition?: number }).flowViewTransition !== viewTransitioning.current) return;
            viewTransitioning.current = null;
          }
          flatViewChange.current(instance.getPitch() <= 1);
          if (selectedEvacuationId.current) refreshSelectedFootprint(instance);
          if (hazardVisibleRef.current) refreshHazard(instance);
        });
        instance.on('idle', () => {
          if (!cancelled && instance && selectedEvacuationId.current)
            refreshSelectedFootprint(instance);
          if (!cancelled && instance && hazardVisibleRef.current)
            refreshHazard(instance);
        });
        const updateZoomTier = () => {
          if (!instance) return;
          const zoom = instance.getZoom();
          const tier = zoom < 11 ? 'wide' : zoom < 14.5 ? 'regional' : 'city';
          if (tier !== zoomTierRef.current) {
            zoomTierRef.current = tier;
            setZoomTier(tier);
          }
        };
        instance.on('zoom', updateZoomTier);
        updateZoomTier();
        instance.on('error', () => {
          if (!cancelled) setMapIssue('Some map tiles could not load. Check your connection.');
        });

        const updateCountryZoomLimit = () => {
          if (!instance) return;
          instance.resize();


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
      hazardRequest.current?.abort();
      ++hazardRequestId.current;
      hazardBoundsKey.current = '';
      controller.abort();
      clearTimeout(timeout);
      observer?.disconnect();
      for (const marker of markers.current.values()) marker.remove();
      markers.current.clear();
      userMarker.current?.remove();
      sitePopup.current?.remove();
      if (evacuationIcon.current) evacuationIcon.current.onload = null;
      evacuationIcon.current = null;
      selectedEvacuationId.current = null;
      selectedFootprintKey.current = '';
      instance?.remove();
      map.current = null;
      appliedStyle.current = null;
      previousTilt.current = null;
      viewTransitioning.current = null;
    };
  }, [flow.ready, retry, focusEvacuation, refreshSelectedFootprint, refreshHazard]);

  useEffect(() => {
    const instance = map.current;
    const lib = library.current;
    const location = flow.alertLocation;
    if (!engineVersion || !instance || !lib || !location) return;
    const { latitude, longitude } = location;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        longitude < PHILIPPINES_BOUNDS[0][0] || longitude > PHILIPPINES_BOUNDS[1][0] ||
        latitude < PHILIPPINES_BOUNDS[0][1] || latitude > PHILIPPINES_BOUNDS[1][1]) {
      userMarker.current?.remove();
      userMarker.current = null;
      return;
    }
    if (userMarker.current) {
      userMarker.current.setLngLat([longitude, latitude]);
    } else {
      const element = document.createElement('div');
      element.className = 'user-dot';
      element.title = 'Your location';
      userMarker.current = new lib.Marker({ element })
        .setLngLat([longitude, latitude])
        .addTo(instance);
    }
  }, [engineVersion, flow.alertLocation]);

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

          instance.setStyle(style, { diff: true });
          appliedStyle.current = { basemap: flow.basemap, retry };


          const currentStyle = instance.getStyle();
          if (currentStyle?.name === style.name && currentStyle.layers?.length) {
            addHeatLayers(instance, latest.current);
            const hazardReady = hazardVisibleRef.current && hazardData.current.features.length > 0;
            addHazardLayer(instance, hazardData.current, hazardReady);
            setObservationLayerVisibility(instance, hazardReady);
            addEvacuationLayers(instance, sitesRef.current, sitesVisibleRef.current,
              evacuationIcon.current);
            if (hazardVisibleRef.current) refreshHazard(instance);
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
  }, [engineVersion, flow.basemap, retry, refreshHazard]);

  useEffect(() => {
    const instance = map.current;
    if (!engineVersion || !instance) return;
    setObservationLayerVisibility(instance, showHazard && hazardData.current.features.length > 0);
    if (showHazard) refreshHazard(instance);
    else {
      hazardRequest.current?.abort();
      ++hazardRequestId.current;
      hazardBoundsKey.current = '';
      hazardStateChange.current('off');
    }
  }, [engineVersion, showHazard, refreshHazard]);

  useEffect(() => {
    const instance = map.current;
    if (!engineVersion || !instance) return;
    const source = instance.getSource(HEAT_SOURCE_ID) as GeoJSONSource | undefined;
    if (source) void source.setData(heatData(flow));
  }, [engineVersion, flow.visibleNodes, flow.getStatus]);

  useEffect(() => {
    const instance = map.current;
    if (!engineVersion || !instance) return;
    const source = instance.getSource(EVAC_SOURCE_ID) as GeoJSONSource | undefined;
    if (!source) return;
    void source.setData(evacuationData(evacuationSites));
    for (const id of [EVAC_ICON_LAYER_ID]) {
      if (instance.getLayer(id)) instance.setLayoutProperty(id, 'visibility',
        showEvacuationSites ? 'visible' : 'none');
    }
    if (instance.getLayer(EVAC_SITE_ID)) instance.setLayoutProperty(EVAC_SITE_ID,
      'visibility', instance.getLayer(EVAC_ICON_LAYER_ID) ? 'none'
        : showEvacuationSites ? 'visible' : 'none');
    if (!showEvacuationSites) sitePopup.current?.remove();
  }, [engineVersion, evacuationSites, showEvacuationSites]);

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
            data-zoom-tier={zoomTier}
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
            <span className="pin-ring"><Icon name="sensor" /></span>
          </button>,
          element,
          id,
        );
      })}
    </>
  );
});
