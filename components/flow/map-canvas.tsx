'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { FilterSpecification, GeoJSONSource, GeoJSONSourceSpecification, LayerSpecification, Map as LibreMap, Marker as LibreMarker, Popup as LibrePopup, StyleSpecification, VectorSourceSpecification } from 'maplibre-gl';

import { Icon } from './icon';
import { useFlow } from '@/hooks/use-flow';
import { useEvacuationRoute, type EvacuationRouteState } from '@/hooks/use-evacuation-route';
import { evacuationRouteData, routingLocation, type EvacuationRoute } from '@/lib/evacuation-routing';
import { BUILDING_FILL_COLOR, BUILDING_OUTLINE_COLOR, SATELLITE_OCEAN_COLOR, loadBasemap } from '@/lib/map-styles';
import { loadHazardTile, type HazardScenario } from '@/lib/hazard-tiles';
import type { MappedEvacuationSite } from '@/lib/evacuation-sites';
import hazardBundle from '@/lib/hazard-bundle.json';
import hazardOverview from '@/lib/hazard-overview.json';
import hazard100 from '@/lib/hazard-100.json';
import neighboringCountries from '@/lib/neighboring-countries.json';
import type { Basemap, MapHandle } from '@/lib/types';
import type { HelpReport } from '@/lib/help-reports';
import { ReportDetails } from './help-report-panel';

interface MarkerHost {
  id: string;
  element: HTMLElement;
}


const PHILIPPINES_BOUNDS: [[number, number], [number, number]] = [
  [112, 4],
  [128, 22],
];
const PHILIPPINES_OVERVIEW_BOUNDS: [[number, number], [number, number]] = [
  [115.8, 4.4],
  [127.2, 21.4],
];

const overviewPadding = (width: number) => width < 600 ? 10 : 32;

const METRO_MANILA_CENTER: [number, number] = [121.03, 14.595];


const MAP_LIMITS: [[number, number], [number, number]] = [
  [100, -5],
  [142, 31],
];

const [[countryWest, countrySouth], [countryEast, countryNorth]] = PHILIPPINES_BOUNDS;
const outsideCountry = [
  [-180, -85, countryWest, 85],
  [countryEast, -85, 180, 85],
  [countryWest, -85, countryEast, countrySouth],
  [countryWest, countryNorth, countryEast, 85],
].map(([west, south, east, north]) => ({
  type: 'Feature' as const,
  properties: {},
  geometry: {
    type: 'Polygon' as const,
    coordinates: [[[west, south], [east, south], [east, north],
      [west, north], [west, south]]],
  },
}));
const COUNTRY_MASK_DATA = {
  type: 'FeatureCollection',
  features: [...neighboringCountries.features, ...outsideCountry, {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [111.5, 3.8], [118.9, 3.8], [118.9, 6.9],
        [117, 7.4], [116.6, 8], [111.5, 8], [111.5, 3.8],
      ]],
    },
  }],
} as GeoJSONSourceSpecification['data'];
const PHILIPPINE_PLACE_AREA = {
  type: 'Polygon' as const,
  coordinates: [[
    [111.5, 8], [116.6, 8], [117, 7.4], [118.9, 6.9],
    [118.9, 3.8], [128.5, 3.8], [128.5, 22.5],
    [111.5, 22.5], [111.5, 8],
  ]],
};

const HAZARD_SOURCE_ID = 'flow-noah-hazard';
const HAZARD_LAYER_ID = 'flow-noah-hazard-fill';
const HAZARD_BUILDING_MASK_ID = 'flow-noah-building-mask';
const NEIGHBORS_SOURCE_ID = 'flow-neighboring-countries';
const NEIGHBORS_MASK_ID = 'flow-neighboring-countries-mask';
const EVAC_SOURCE_ID = 'flow-evacuation-sites';
const EVAC_SITE_ID = 'flow-evacuation-points';
const EVAC_ICON_ID = 'flow-evacuation-icon';
const EVAC_ICON_LAYER_ID = 'flow-evacuation-icons';
const BUILDINGS_3D_ID = 'flow-buildings-3d';
const BUILDINGS_3D_MIN_ZOOM = 12;
const ROUTE_SOURCE_ID = 'flow-evacuation-route';
const ROUTE_HALO_ID = 'flow-evacuation-route-halo';
const ROUTE_LINE_ID = 'flow-evacuation-route-line';
const ROUTE_POINTS_ID = 'flow-evacuation-route-points';
const CITY_PITCH = 60;
const CITY_BEARING = -17;
const FOCUS_ZOOM = 17;
const WIDE_VIEW_ZOOM = 11.5;
const FULL_TILT_ZOOM = 13.5;
type CameraView = {
  center: [number, number]; zoom: number; pitch: number; bearing: number;
};

function cameraView(instance: LibreMap): CameraView {
  const center = instance.getCenter();
  return {
    center: [center.lng, center.lat],
    zoom: instance.getZoom(),
    pitch: instance.getPitch(),
    bearing: instance.getBearing(),
  };
}

function returnViewAt(instance: LibreMap, center: [number, number]): CameraView {
  const view = cameraView(instance);
  return {
    ...view,
    center,
    zoom: Math.min(FULL_TILT_ZOOM, Math.max(WIDE_VIEW_ZOOM, view.zoom)),
  };
}

export type { HazardScenario } from '@/lib/hazard-tiles';
let hazardProtocolRegistered = false;

export type HazardState = 'off' | 'loading' | 'ready' | 'empty' | 'zoom' | 'unavailable';

async function prepareHazardProtocol(lib: typeof import('maplibre-gl')) {
  if (hazardProtocolRegistered) return;
  lib.addProtocol('flowhazard', async (params, abortController) => {
    const match = /^flowhazard:\/\/noah\/(5yr|100yr)\/(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(params.url);
    if (!match) throw new Error('Invalid FLOW hazard tile URL');
    const scenario = match[1] as HazardScenario;
    const [z, x, y] = match.slice(2).map(Number);
    const data = await loadHazardTile(scenario, z, x, y, abortController.signal);
    return { data: data.buffer as ArrayBuffer, cacheControl: 'public, max-age=86400' };
  });
  hazardProtocolRegistered = true;
}

function addNeighborMask(instance: LibreMap, satellite: boolean) {
  if (!instance.getSource(NEIGHBORS_SOURCE_ID)) {
    instance.addSource(NEIGHBORS_SOURCE_ID, {
      type: 'geojson', data: COUNTRY_MASK_DATA,
    });
  }
  if (!instance.getLayer(NEIGHBORS_MASK_ID)) instance.addLayer({
    id: NEIGHBORS_MASK_ID,
    type: 'fill',
    source: NEIGHBORS_SOURCE_ID,
    paint: { 'fill-color': satellite ? SATELLITE_OCEAN_COLOR : '#b7e5ed', 'fill-opacity': 1 },
  });
  else instance.setPaintProperty(NEIGHBORS_MASK_ID, 'fill-color',
    satellite ? SATELLITE_OCEAN_COLOR : '#b7e5ed');
}

function hazardSource(scenario: HazardScenario): VectorSourceSpecification {
  const bounds = scenario === '100yr' ? hazard100.dataBounds : hazardOverview.dataBounds;
  return {
    type: 'vector',
    tiles: [`flowhazard://noah/${scenario}/{z}/{x}/{y}.pbf`],
    bounds: bounds as [number, number, number, number],
    minzoom: 0,
    maxzoom: 14,
  };
}

function hazardLayer(visible: boolean, scenario: HazardScenario): LayerSpecification {
  return {
    id: HAZARD_LAYER_ID,
    type: 'fill',
    source: HAZARD_SOURCE_ID,
    'source-layer': `flood_${scenario}`,
    paint: {
      'fill-color': ['match', ['to-number', ['get', 'Var']], 1, '#f3c949',
        2, '#f08350', 3, '#d9434b', 'rgba(0,0,0,0)'],
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 12, .7, 15, .8, 18, .84],
    },
    layout: { visibility: visible ? 'visible' : 'none' },
  };
}

function hazardBeforeId(layers: LayerSpecification[]) {
  return layers.find(layer =>
    layer.id === HAZARD_BUILDING_MASK_ID || layer.id === BUILDINGS_3D_ID ||
    ('source-layer' in layer &&
      ((layer.type === 'fill' || layer.type === 'fill-extrusion') &&
        layer['source-layer'] === 'building' ||
       layer.type === 'line' && layer['source-layer'] === 'transportation')))?.id
    ?? layers.find(layer => layer.type === 'symbol')?.id;
}

function restoreHazardOrder(instance: LibreMap) {
  if (!instance.getLayer(HAZARD_LAYER_ID)) return;
  const layers = instance.getStyle().layers;
  const beforeId = hazardBeforeId(layers);
  if (!beforeId) return;
  const hazardIndex = layers.findIndex(layer => layer.id === HAZARD_LAYER_ID);
  const beforeIndex = layers.findIndex(layer => layer.id === beforeId);
  if (hazardIndex !== beforeIndex - 1) instance.moveLayer(HAZARD_LAYER_ID, beforeId);
}

function preserveFlowLayers(previous: StyleSpecification | undefined,
  next: StyleSpecification): StyleSpecification {
  if (!previous) return next;
  const runtimeIds = new Set([
    HAZARD_BUILDING_MASK_ID, BUILDINGS_3D_ID, EVAC_SITE_ID, EVAC_ICON_LAYER_ID,
    ROUTE_HALO_ID, ROUTE_LINE_ID, ROUTE_POINTS_ID,
  ]);
  const layersById = new Map(next.layers.map(layer => [layer.id, layer]));
  const visibility = next.layers.find(layer => layer.id === HAZARD_LAYER_ID)
    ?.layout?.visibility ?? 'none';
  for (const original of previous.layers) {
    if (!runtimeIds.has(original.id) && !(original.type === 'fill-extrusion' &&
        'source-layer' in original && original['source-layer'] === 'building')) continue;
    const layer = structuredClone(original);
    if (layer.id === HAZARD_BUILDING_MASK_ID && layer.type === 'fill') {
      layer.layout = { ...layer.layout, visibility };
      layer.paint = { ...layer.paint, 'fill-opacity': 1,
        'fill-color': BUILDING_FILL_COLOR,
        'fill-outline-color': BUILDING_OUTLINE_COLOR };
    }
    if (layer.type === 'fill-extrusion' && 'source-layer' in layer &&
        layer['source-layer'] === 'building') {
      layer.paint = { ...layer.paint,
        'fill-extrusion-color': BUILDING_FILL_COLOR,
        'fill-extrusion-opacity': 1 };
    }
    layersById.set(layer.id, layer);
  }
  const layers: LayerSpecification[] = [];
  for (const layer of previous.layers) {
    const replacement = layersById.get(layer.id);
    if (!replacement) continue;
    layers.push(replacement);
    layersById.delete(layer.id);
  }
  for (const layer of layersById.values()) {
    let beforeId: string | undefined;
    if (layer.type === 'background' || layer.type === 'raster') beforeId = layers[0]?.id;
    else if (layer.id === HAZARD_LAYER_ID) beforeId = hazardBeforeId(layers);
    else if (layer.type === 'symbol' || layer.id === EVAC_SITE_ID)
      beforeId = layers.find(item => item.id === NEIGHBORS_MASK_ID)?.id;
    else if (layer.id !== NEIGHBORS_MASK_ID) {
      const anchorId = layers.find(item => item.id === HAZARD_LAYER_ID)?.id
        ?? hazardBeforeId(layers);
      const anchorIndex = layers.findIndex(item => item.id === anchorId);
      const nextIndex = next.layers.findIndex(item => item.id === layer.id);
      beforeId = next.layers.slice(nextIndex + 1).find(item => {
        const index = layers.findIndex(existing => existing.id === item.id);
        return index >= 0 && index < anchorIndex;
      })?.id ?? anchorId;
    }
    const index = beforeId ? layers.findIndex(item => item.id === beforeId) : layers.length;
    layers.splice(index, 0, layer);
  }
  const sources = { ...next.sources };
  for (const layer of layers) {
    if ('source' in layer && typeof layer.source === 'string' &&
        !sources[layer.source] && previous.sources[layer.source])
      sources[layer.source] = previous.sources[layer.source];
  }
  return { ...next, sources, layers };
}

function withLocalHazard(style: StyleSpecification, visible: boolean,
  satellite: boolean, scenario: HazardScenario): StyleSpecification {
  const layers = style.layers.map(layer => {
    if (layer.type !== 'symbol' || !('source-layer' in layer)) return layer;
    let restriction: FilterSpecification | undefined;
    if (layer['source-layer'] === 'place') {
      restriction = ['within', PHILIPPINE_PLACE_AREA];
    } else if (layer['source-layer'] === 'water_name') {
      restriction = ['!', ['match', ['get', 'class'], ['sea', 'ocean'], true, false]];
    }
    return restriction ? {
      ...layer,
      filter: ['all', ...(layer.filter ? [layer.filter] : []), restriction] as FilterSpecification,
    } : layer;
  });
  const sources: StyleSpecification['sources'] = {
    ...style.sources,
    [NEIGHBORS_SOURCE_ID]: { type: 'geojson' as const, data: COUNTRY_MASK_DATA },
  };
  if (hazardProtocolRegistered) {
    const beforeId = hazardBeforeId(layers);
    const beforeIndex = beforeId ? layers.findIndex(layer => layer.id === beforeId) : layers.length;
    layers.splice(beforeIndex, 0, hazardLayer(visible, scenario));
    sources[HAZARD_SOURCE_ID] = hazardSource(scenario);
  }
  layers.push({
    id: NEIGHBORS_MASK_ID,
    type: 'fill',
    source: NEIGHBORS_SOURCE_ID,
    paint: { 'fill-color': satellite ? SATELLITE_OCEAN_COLOR : '#b7e5ed', 'fill-opacity': 1 },
  });
  return {
    ...style,
    sources,
    layers,
  };
}

function addHazardLayer(instance: LibreMap, visible: boolean, scenario: HazardScenario) {
  if (!instance.getSource(HAZARD_SOURCE_ID))
    instance.addSource(HAZARD_SOURCE_ID, hazardSource(scenario));
  if (!instance.getLayer(HAZARD_LAYER_ID))
    instance.addLayer(hazardLayer(visible, scenario), hazardBeforeId(instance.getStyle().layers));
  restoreHazardOrder(instance);
}

function setObservationLayerVisibility(instance: LibreMap, hazardVisible: boolean) {
  if (instance.getLayer(HAZARD_LAYER_ID)) {
    const visibility = hazardVisible ? 'visible' : 'none';
    if (instance.getLayoutProperty(HAZARD_LAYER_ID, 'visibility') !== visibility)
      instance.setLayoutProperty(HAZARD_LAYER_ID, 'visibility', visibility);
  }
  if (instance.getLayer(HAZARD_BUILDING_MASK_ID)) {
    const visibility = hazardVisible ? 'visible' : 'none';
    if (instance.getLayoutProperty(HAZARD_BUILDING_MASK_ID, 'visibility') !== visibility)
      instance.setLayoutProperty(HAZARD_BUILDING_MASK_ID, 'visibility', visibility);
  }
}

function addBuildingLayers(instance: LibreMap) {
  const layers = instance.getStyle().layers;
  const beforeId = layers.find((layer) => layer.type === 'symbol')?.id;
  const buildings = layers.filter((layer) => layer.type === 'fill' &&
    'source-layer' in layer && layer['source-layer'] === 'building');
  const buildingExtrusions = layers.filter((layer) => layer.type === 'fill-extrusion' &&
    layer.id !== BUILDINGS_3D_ID && 'source-layer' in layer &&
    layer['source-layer'] === 'building');
  for (const building of buildings) {
    instance.setPaintProperty(building.id, 'fill-color', BUILDING_FILL_COLOR);
    instance.setPaintProperty(building.id, 'fill-outline-color', BUILDING_OUTLINE_COLOR);
    instance.setPaintProperty(building.id, 'fill-opacity', 1);
    instance.moveLayer(building.id, beforeId);
  }

  const buildingSource = [...buildings, ...buildingExtrusions].find((layer) =>
    'source' in layer && typeof layer.source === 'string');
  if (buildingSource && 'source' in buildingSource && typeof buildingSource.source === 'string') {
    if (!instance.getLayer(HAZARD_BUILDING_MASK_ID)) instance.addLayer({
      id: HAZARD_BUILDING_MASK_ID,
      type: 'fill',
      source: buildingSource.source,
      'source-layer': 'building',
      minzoom: 12,
      layout: { visibility: 'none' },
      paint: {
        'fill-color': BUILDING_FILL_COLOR,
        'fill-outline-color': BUILDING_OUTLINE_COLOR,
        'fill-opacity': 1,
      },
    }, beforeId);
    else {
      instance.setPaintProperty(HAZARD_BUILDING_MASK_ID, 'fill-color',
        BUILDING_FILL_COLOR);
      instance.setPaintProperty(HAZARD_BUILDING_MASK_ID, 'fill-outline-color',
        BUILDING_OUTLINE_COLOR);
      instance.moveLayer(HAZARD_BUILDING_MASK_ID, beforeId);
    }
  }


  const opacity = 1;
  if (buildingExtrusions.length) {
    if (instance.getLayer(BUILDINGS_3D_ID)) instance.removeLayer(BUILDINGS_3D_ID);
    for (const extrusion of buildingExtrusions) {
      instance.setLayerZoomRange(extrusion.id, BUILDINGS_3D_MIN_ZOOM, 24);
      instance.setPaintProperty(extrusion.id, 'fill-extrusion-color', BUILDING_FILL_COLOR);
      instance.setPaintProperty(extrusion.id, 'fill-extrusion-opacity', opacity);
      instance.setPaintProperty(extrusion.id, 'fill-extrusion-height',
        ['to-number', ['get', 'render_height'], 0]);
      instance.moveLayer(extrusion.id, beforeId);
    }
  } else {
    const building = buildings.find((layer) => 'source' in layer && typeof layer.source === 'string');
    if (building && 'source' in building && typeof building.source === 'string') {
      if (instance.getLayer(BUILDINGS_3D_ID)) {
        instance.setPaintProperty(BUILDINGS_3D_ID, 'fill-extrusion-color', BUILDING_FILL_COLOR);
        instance.setPaintProperty(BUILDINGS_3D_ID, 'fill-extrusion-opacity', opacity);
        instance.moveLayer(BUILDINGS_3D_ID, beforeId);
      } else {
        instance.addLayer({
          id: BUILDINGS_3D_ID,
          type: 'fill-extrusion',
          source: building.source,
          'source-layer': 'building',
          minzoom: BUILDINGS_3D_MIN_ZOOM,
          filter: ['!=', ['get', 'hide_3d'], true],
          paint: {
            'fill-extrusion-color': BUILDING_FILL_COLOR,
            'fill-extrusion-opacity': opacity,
            'fill-extrusion-height': ['to-number', ['get', 'render_height'], 0],
            'fill-extrusion-base': ['to-number', ['get', 'render_min_height'], 0],
          },
        }, beforeId);
      }
    }
  }
  restoreHazardOrder(instance);
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

  restoreHazardOrder(instance);
}


function addEvacuationRouteLayers(instance: LibreMap, route: EvacuationRoute | null) {
  const ids = [ROUTE_HALO_ID, ROUTE_LINE_ID, ROUTE_POINTS_ID];
  if (!route) {
    for (const id of [...ids].reverse()) if (instance.getLayer(id)) instance.removeLayer(id);
    if (instance.getSource(ROUTE_SOURCE_ID)) instance.removeSource(ROUTE_SOURCE_ID);
    return;
  }
  const source = instance.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined;
  const data = evacuationRouteData(route);
  if (source) void source.setData(data);
  else instance.addSource(ROUTE_SOURCE_ID, { type: 'geojson', data,
    attribution: 'Routing: <a href="https://routing.openstreetmap.de/about.html">OSRM/FOSSGIS</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  });
  const beforeId = instance.getStyle().layers.find(layer => layer.type === 'symbol')?.id;
  const routeLayers: LayerSpecification[] = [
    { id: ROUTE_HALO_ID, type: 'line', source: ROUTE_SOURCE_ID,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-opacity': .95,
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6, 14, 8, 18, 10] } },
    { id: ROUTE_LINE_ID, type: 'line', source: ROUTE_SOURCE_ID,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#0875ce',
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 4, 18, 6] } },
    { id: ROUTE_POINTS_ID, type: 'circle', source: ROUTE_SOURCE_ID,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 6, 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff',
        'circle-color': ['case', ['==', ['get', 'kind'], 'destination'],
          ['case', ['==', ['get', 'destinationKind'], 'help-report'], '#b32335', '#075e70'], '#0875ce'] } },
  ];
  for (const layer of routeLayers) {
    if (!instance.getLayer(layer.id)) instance.addLayer(layer, beforeId);
    else instance.moveLayer(layer.id, beforeId);
  }
}

function updateDirectionsButton(button: HTMLButtonElement | null,
  state: EvacuationRouteState, siteId: string | null) {
  if (!button) return;
  const status = state.site?.id === siteId ? state.status : 'idle';
  const busy = status === 'locating' || status === 'loading';
  button.disabled = busy;
  button.setAttribute('aria-busy', String(busy));
  button.textContent = status === 'locating' ? 'Finding location…'
    : status === 'loading' ? 'Finding route…' : 'Get Directions';
}

export const MapCanvas = forwardRef<MapHandle, {
  onFlatViewChange: (flat: boolean) => void;
  helpReports: HelpReport[];
  ownReportId: string | null;
  helpReportsLive: boolean;
  evacuationSites: MappedEvacuationSite[];
  showEvacuationSites: boolean;
  showHazard: boolean;
  hazardScenario: HazardScenario;
  onHazardStateChange: (state: HazardState) => void;
}>(function MapCanvas({ onFlatViewChange, helpReports, ownReportId, helpReportsLive, evacuationSites, showEvacuationSites,
  showHazard, hazardScenario, onHazardStateChange }, ref) {
  const flow = useFlow();
  const helpReportsRef = useRef(helpReports);
  helpReportsRef.current = helpReports;
  const evacuationRoute = useEvacuationRoute(flow.alertLocation);
  const routeData = useRef(evacuationRoute.data);
  routeData.current = evacuationRoute.data;
  const routeState = useRef(evacuationRoute);
  routeState.current = evacuationRoute;
  const directionsButton = useRef<HTMLButtonElement | null>(null);
  const beginDirections = useRef<(site: MappedEvacuationSite) => void>(() => {});
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
  const hazardScenarioRef = useRef(hazardScenario);
  hazardScenarioRef.current = hazardScenario;
  const appliedHazardScenario = useRef<HazardScenario | null>(null);
  const hazardStateChange = useRef(onHazardStateChange);
  hazardStateChange.current = onHazardStateChange;
  const hazardArchiveReady = useRef(false);
  const hazardArchiveFailed = useRef(false);
  const hazardHadDataInView = useRef(false);

  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LibreMap | null>(null);
  const library = useRef<typeof import('maplibre-gl') | null>(null);
  const markers = useRef(new Map<string, LibreMarker>());
  const helpMarkers = useRef(new Map<string, LibreMarker>());
  const helpPopup = useRef<LibrePopup | null>(null);
  const selectedHelpId = useRef<string | null>(null);
  const helpReturnView = useRef<CameraView | null>(null);
  const [helpHosts, setHelpHosts] = useState<MarkerHost[]>([]);
  const [helpPopupHost, setHelpPopupHost] = useState<MarkerHost | null>(null);
  const userMarker = useRef<LibreMarker | null>(null);
  const sitePopup = useRef<LibrePopup | null>(null);
  const selectedEvacuationId = useRef<string | null>(null);
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
  const nodeReturnView = useRef<CameraView | null>(null);
  const evacuationReturnView = useRef<CameraView | null>(null);
  const restorePitchAfterZoomOut = useRef(false);

  const refreshHazard = useCallback((instance: LibreMap) => {
    if (!hazardVisibleRef.current || !instance.getSource(HAZARD_SOURCE_ID)) return;
    if (!hazardArchiveReady.current || !instance.isSourceLoaded(HAZARD_SOURCE_ID)) {
      if (hazardArchiveFailed.current) {
        setObservationLayerVisibility(instance, true);
        hazardStateChange.current('unavailable');
      } else if (!hazardHadDataInView.current) {
        setObservationLayerVisibility(instance, true);
        hazardStateChange.current('loading');
      }
      return;
    }
    const features = instance.queryRenderedFeatures({ layers: [HAZARD_LAYER_ID] });
    if (features.length) {
      hazardArchiveFailed.current = false;
      hazardHadDataInView.current = true;
      setObservationLayerVisibility(instance, true);
      hazardStateChange.current('ready');
      return;
    }
    hazardHadDataInView.current = false;
    setObservationLayerVisibility(instance, true);
    hazardStateChange.current(hazardArchiveFailed.current ? 'unavailable' : 'empty');
  }, []);

  const dismissEvacuation = useCallback(() => {
    selectedEvacuationId.current = null;
    evacuationReturnView.current = null;
    sitePopup.current?.remove();
    sitePopup.current = null;
    directionsButton.current = null;
  }, []);

  const dismissHelp = useCallback(() => {
    const popup = helpPopup.current;
    helpPopup.current = null;
    selectedHelpId.current = null;
    helpReturnView.current = null;
    popup?.remove();
    setHelpPopupHost(null);
  }, []);

  const focusHelpReport = useCallback((id: string) => {
    const instance = map.current;
    const lib = library.current;
    const report = helpReportsRef.current.find(item => item.id === id);
    if (!instance || !lib || !report || Date.parse(report.expires_at) <= Date.now()) return;
    dismissHelp();
    dismissEvacuation();
    nodeReturnView.current = null;
    latest.current.closeDetails();
    restorePitchAfterZoomOut.current = false;
    viewTransitioning.current = null;
    const target: [number, number] = [report.longitude, report.latitude];
    helpReturnView.current = returnViewAt(instance, target);
    const element = document.createElement('div');
    const popup = new lib.Popup({ offset: 30, maxWidth: '290px', closeOnClick: true,
      className: 'flow-help-popup', focusAfterOpen: false })
      .setLngLat(target).setDOMContent(element).addTo(instance);
    helpPopup.current = popup;
    selectedHelpId.current = id;
    setHelpPopupHost({ id, element });
    popup.on('close', () => {
      if (helpPopup.current !== popup) return;
      helpPopup.current = null;
      selectedHelpId.current = null;
      setHelpPopupHost(null);
      const view = helpReturnView.current;
      helpReturnView.current = null;
      if (view) instance.easeTo({ ...view,
        duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250 });
      helpMarkers.current.get(id)?.getElement().querySelector('button')?.focus({ preventScroll: true });
    });
    instance.easeTo({ center: target, zoom: Math.max(15, instance.getZoom()),
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 320 });
  }, [dismissHelp, dismissEvacuation]);

  beginDirections.current = site => {
    nodeReturnView.current = null;
    latest.current.closeDetails();
    void evacuationRoute.start(site, 'walking');
  };

  const fitEvacuationRoute = useCallback(() => {
    const instance = map.current;
    const lib = library.current;
    const element = container.current;
    const route = routeData.current;
    if (!instance || !lib || !element || !route) return;
    const bounds = new lib.LngLatBounds();
    for (const position of route.geometry.coordinates) bounds.extend([position[0], position[1]]);
    bounds.extend([route.origin.longitude, route.origin.latitude]);
    bounds.extend([route.destination.longitude, route.destination.latitude]);
    const rect = element.getBoundingClientRect();
    const searchRect = element.parentElement?.querySelector('.search-dock')?.getBoundingClientRect();
    const mobile = window.innerWidth <= 760;
    const padding = {
      top: Math.min((searchRect?.bottom ?? rect.top + 140) - rect.top + 24, rect.height * .35),
      left: mobile ? 24 : 40,
      right: mobile ? 70 : 80,
      bottom: mobile ? 80 : 70,
    };
    const camera = instance.cameraForBounds(bounds, { padding, maxZoom: 16, bearing: 0 });
    if (!camera) return;
    restorePitchAfterZoomOut.current = false;
    viewTransitioning.current = null;
    instance.easeTo({ ...camera, pitch: 0,
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 400 });
  }, []);

  const focus = useCallback((id: string) => {
    const instance = map.current;
    const el = container.current;
    const node = latest.current.nodes.find((item) => item.id === id);
    if (!instance || !el || !node) return;
    dismissHelp();
    const target: [number, number] = [node.longitude, node.latitude];
    if (!nodeReturnView.current) nodeReturnView.current = returnViewAt(instance, target);
    else nodeReturnView.current.center = target;
    if (selectedEvacuationId.current) dismissEvacuation();
    restorePitchAfterZoomOut.current = false;

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
  }, [dismissEvacuation, dismissHelp]);

  const focusEvacuation = useCallback((id: string) => {
    const instance = map.current;
    const lib = library.current;
    const site = sitesRef.current.find(item => item.id === id);
    if (!instance || !lib || !site) return;
    dismissHelp();
    const target: [number, number] = [site.longitude, site.latitude];
    if (!evacuationReturnView.current) evacuationReturnView.current = returnViewAt(instance, target);
    else evacuationReturnView.current.center = target;
    nodeReturnView.current = null;
    restorePitchAfterZoomOut.current = false;
    for (const layer of [EVAC_SITE_ID, EVAC_ICON_LAYER_ID]) {
      if (instance.getLayer(layer)) instance.setLayoutProperty(layer, 'visibility', 'visible');
    }
    latest.current.closeDetails();
    selectedEvacuationId.current = null;
    sitePopup.current?.remove();
    selectedEvacuationId.current = id;

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
    const directions = document.createElement('button');
    directions.type = 'button';
    directions.className = 'primary-btn';
    directions.setAttribute('aria-live', 'polite');
    directionsButton.current = directions;
    updateDirectionsButton(directions, routeState.current, id);
    directions.addEventListener('click', event => {
      event.stopPropagation();
      if (directions.disabled) return;
      directions.disabled = true;
      directions.setAttribute('aria-busy', 'true');
      directions.textContent = 'Finding route…';
      beginDirections.current(site);
    });
    const googleMaps = document.createElement('a');
    googleMaps.className = 'evacuation-google-directions';
    googleMaps.textContent = 'Open in Google Maps';
    googleMaps.target = '_blank';
    googleMaps.rel = 'noopener noreferrer';
    const updateGoogleMapsLink = () => {
      const params = new URLSearchParams({
        api: '1', destination: `${site.latitude},${site.longitude}`, travelmode: 'walking',
      });
      const origin = latest.current.alertLocation;
      if (origin && routingLocation(origin.latitude, origin.longitude))
        params.set('origin', `${origin.latitude},${origin.longitude}`);
      googleMaps.href = `https://www.google.com/maps/dir/?${params}`;
    };
    updateGoogleMapsLink();
    googleMaps.addEventListener('click', event => {
      event.stopPropagation();
      updateGoogleMapsLink();
    });
    links.append(directions, googleMaps);
    content.append(icon, heading, location, note, links);

    sitePopup.current = new lib.Popup({ offset: 16, maxWidth: '290px', closeOnClick: false,
      className: 'flow-evacuation-popup' })
      .setLngLat([site.longitude, site.latitude]).setDOMContent(content).addTo(instance);
    sitePopup.current.on('close', () => {
      if (selectedEvacuationId.current !== id) return;
      selectedEvacuationId.current = null;
      sitePopup.current = null;
      directionsButton.current = null;
      const returnView = evacuationReturnView.current;
      evacuationReturnView.current = null;
      if (returnView) instance.easeTo({ ...returnView,
        duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 320 });
    });
    instance.easeTo({ center: [site.longitude, site.latitude],
      zoom: Math.max(15, instance.getZoom()),
      pitch: CITY_PITCH, bearing: CITY_BEARING,
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 320 });
  }, [dismissHelp]);

  const finishViewTransitionIfIdle = useCallback((instance: LibreMap, transitionId: number) => {
    if (viewTransitioning.current !== transitionId || instance.isMoving()) return;
    viewTransitioning.current = null;
    flatViewChange.current(instance.getPitch() <= 1);
  }, []);

  const showPhilippines = useCallback((transitionId?: number) => {
    const instance = map.current;
    if (!instance) return;
    dismissHelp();
    nodeReturnView.current = null;
    dismissEvacuation();
    restorePitchAfterZoomOut.current = false;
    instance.fitBounds(PHILIPPINES_OVERVIEW_BOUNDS, {
      padding: overviewPadding(instance.getContainer().clientWidth),
      pitch: 0,
      bearing: 0,
      duration: 320,
    }, transitionId === undefined ? undefined : { flowViewTransition: transitionId });
    if (transitionId !== undefined) finishViewTransitionIfIdle(instance, transitionId);
  }, [dismissEvacuation, dismissHelp, finishViewTransitionIfIdle]);

  const fit = useCallback(() => {
    const instance = map.current;
    const lib = library.current;
    if (!instance || !lib || viewTransitioning.current !== null) return;
    dismissHelp();
    dismissEvacuation();
    restorePitchAfterZoomOut.current = false;
    const transitionId = ++nextViewTransition.current;
    viewTransitioning.current = transitionId;
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
  }, [dismissEvacuation, dismissHelp, finishViewTransitionIfIdle, showPhilippines]);

  const wideView = useCallback(() => {
    const instance = map.current;
    if (!instance || viewTransitioning.current !== null) return;
    dismissHelp();
    dismissEvacuation();
    restorePitchAfterZoomOut.current = false;
    const transitionId = ++nextViewTransition.current;
    viewTransitioning.current = transitionId;
    instance.easeTo({
      center: cameraView(instance).center,
      zoom: Math.max(instance.getMinZoom(), Math.min(instance.getZoom() - 2.5, WIDE_VIEW_ZOOM)),
      pitch: 0,
      bearing: 0,
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 320,
    }, { flowViewTransition: transitionId });
    finishViewTransitionIfIdle(instance, transitionId);
  }, [dismissEvacuation, dismissHelp, finishViewTransitionIfIdle]);

  useImperativeHandle(ref, () => ({
    focus,
    focusEvacuation,
    focusHelpReport,
    fit,
    wideView,
    showPhilippines,
    restoreTilt() {
      const instance = map.current;
      if (!instance || viewTransitioning.current !== null) return;
      restorePitchAfterZoomOut.current = false;
      const transitionId = ++nextViewTransition.current;
      viewTransitioning.current = transitionId;
      instance.easeTo({
        center: cameraView(instance).center,
        zoom: Math.max(instance.getZoom(), FULL_TILT_ZOOM),
        pitch: CITY_PITCH,
        bearing: CITY_BEARING,
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
      restorePitchAfterZoomOut.current = false;
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
  }), [finishViewTransitionIfIdle, focus, focusEvacuation, focusHelpReport, fit, showPhilippines, wideView]);

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
    setHelpHosts([]);

    async function initialize() {
      try {

        const [lib, baseStyle] = await Promise.all([
          import('maplibre-gl'),
          loadBasemap(initialMode, controller.signal),
        ]);
        if (cancelled || !container.current) return;
        if (hazardVisibleRef.current) {
          try {
            await prepareHazardProtocol(lib);
          } catch {
            hazardArchiveFailed.current = true;
          }
        }
        if (cancelled || !container.current) return;
        const style = withLocalHazard(baseStyle, hazardVisibleRef.current,
          initialMode === 'satellite', hazardScenarioRef.current);
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
        let overviewZoom = 3;
        let overviewCenter = new lib.LngLat(120, 13);
        instance = new lib.Map({
          container: container.current,
          center: initialCenter,
          zoom: 15,
          pitch: CITY_PITCH,
          bearing: CITY_BEARING,
          canvasContextAttributes: { antialias: true },
          maxTileCacheZoomLevels: window.innerWidth <= 760 ? 5 : 8,
          cancelPendingTileRequestsWhileZooming: false,
          maxBounds: MAP_LIMITS,
          renderWorldCopies: false,
          transformCameraUpdate: ({ center, zoom, pitch }) => {
            if (zoom <= overviewZoom + 0.01) {
              return { center: overviewCenter, pitch: 0, bearing: 0 };
            }
            const pitchLimit = CITY_PITCH * Math.max(0, Math.min(1,
              (zoom - WIDE_VIEW_ZOOM) / (FULL_TILT_ZOOM - WIDE_VIEW_ZOOM)));
            if (pitch > pitchLimit + 0.01 && pitchLimit < CITY_PITCH) {
              restorePitchAfterZoomOut.current = true;
            }
            const constrainedPitch = restorePitchAfterZoomOut.current
              ? pitchLimit : Math.min(pitch, pitchLimit);
            if (restorePitchAfterZoomOut.current && zoom >= FULL_TILT_ZOOM)
              restorePitchAfterZoomOut.current = false;
            const longitude = Math.min(PHILIPPINES_BOUNDS[1][0],
              Math.max(PHILIPPINES_BOUNDS[0][0], center.lng));
            const latitude = Math.min(PHILIPPINES_BOUNDS[1][1],
              Math.max(PHILIPPINES_BOUNDS[0][1], center.lat));
            return {
              ...(longitude === center.lng && latitude === center.lat
                ? {} : { center: new lib.LngLat(longitude, latitude) }),
              ...(Math.abs(pitch - constrainedPitch) > 0.01
                ? { pitch: constrainedPitch } : {}),
            };
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
            addBuildingLayers(instance);
            if (hazardVisibleRef.current && hazardProtocolRegistered)
              addHazardLayer(instance, true, hazardScenarioRef.current);
            setObservationLayerVisibility(instance, hazardVisibleRef.current);
            addEvacuationLayers(instance, sitesRef.current, sitesVisibleRef.current,
              evacuationIcon.current);
            addEvacuationRouteLayers(instance, routeData.current);
            addNeighborMask(instance, latest.current.basemap === 'satellite');
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
        instance.on('click', event => {
          if (!selectedEvacuationId.current || !sitePopup.current) return;
          const layers = [EVAC_SITE_ID, EVAC_ICON_LAYER_ID].filter(id => instance?.getLayer(id));
          if (layers.length && instance?.queryRenderedFeatures(event.point, { layers }).length) return;
          sitePopup.current.remove();
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
        });
        instance.on('idle', () => {
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
        const updateRipplePitch = () => {
          container.current?.style.setProperty('--sensor-ripple-pitch',
            `${instance?.getPitch() ?? 0}deg`);
        };
        instance.on('pitch', updateRipplePitch);
        updateRipplePitch();
        instance.on('pitchend', event => {
          if (event.originalEvent) restorePitchAfterZoomOut.current = false;
        });
        updateZoomTier();
        instance.on('error', event => {
          if ((event as typeof event & { sourceId?: string }).sourceId === HAZARD_SOURCE_ID ||
              event.error?.message?.includes('pmtiles')) {
            if (process.env.NODE_ENV !== 'production')
              console.error('FLOW hazard source error:', event.error);
            hazardArchiveFailed.current = true;
            if (instance && hazardVisibleRef.current) refreshHazard(instance);
            return;
          }
          if (!cancelled) setMapIssue('Some map tiles could not load. Check your connection.');
        });

        let previousCountryZoom: number | null = null;
        const updateCountryZoomLimit = () => {
          if (!instance) return;
          const wasAtOverview = previousCountryZoom !== null &&
            instance.getZoom() <= previousCountryZoom + 0.02;
          instance.resize();
          const countryView = instance.cameraForBounds(PHILIPPINES_OVERVIEW_BOUNDS, {
            padding: overviewPadding(instance.getContainer().clientWidth),
          });
          if (!countryView?.center || typeof countryView.zoom !== 'number') return;
          overviewCenter = lib.LngLat.convert(countryView.center);
          overviewZoom = countryView.zoom;
          instance.setMinZoom(countryView.zoom);
          previousCountryZoom = countryView.zoom;
          if (wasAtOverview) instance.jumpTo({
            center: overviewCenter, zoom: overviewZoom, pitch: 0, bearing: 0,
          });
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
      for (const marker of helpMarkers.current.values()) marker.remove();
      helpMarkers.current.clear();
      dismissHelp();
      userMarker.current?.remove();
      selectedEvacuationId.current = null;
      sitePopup.current?.remove();
      sitePopup.current = null;
      directionsButton.current = null;
      if (evacuationIcon.current) evacuationIcon.current.onload = null;
      evacuationIcon.current = null;
      instance?.remove();
      map.current = null;
      appliedStyle.current = null;
      nodeReturnView.current = null;
      evacuationReturnView.current = null;
      viewTransitioning.current = null;
      restorePitchAfterZoomOut.current = false;
    };
  }, [flow.ready, retry, focusEvacuation, dismissHelp, refreshHazard]);

  useEffect(() => {
    const destination = evacuationRoute.site;
    if (destination?.kind !== 'help-report') return;
    const report = helpReports.find(item => `help:${item.id}` === destination.id);
    if (!report || Date.parse(report.expires_at) <= Date.now()
        || report.latitude !== destination.latitude || report.longitude !== destination.longitude) {
      routeData.current = null;
      evacuationRoute.clear();
      latest.current.notify(report
        ? 'This help request changed. Open it again for updated directions.'
        : 'This help request is no longer active. Its route has been cleared.');
    }
  }, [helpReports, evacuationRoute.site, evacuationRoute.data, evacuationRoute.clear]);

  useEffect(() => {
    updateDirectionsButton(directionsButton.current, evacuationRoute,
      selectedEvacuationId.current);
    if (evacuationRoute.status === 'error' && evacuationRoute.error) {
      latest.current.notify(evacuationRoute.error, true);
    }
  }, [evacuationRoute.status, evacuationRoute.error, evacuationRoute.site?.id]);

  useEffect(() => {
    const instance = map.current;
    if (!engineVersion || !instance) return;
    const apply = () => {
      if (map.current !== instance) return;
      addEvacuationRouteLayers(instance, routeData.current);
      const destination = routeData.current?.destination;
      if (destination?.kind === 'help-report' && routeData.current) {
        const origin = routeData.current.origin;
        userMarker.current?.setLngLat([origin.longitude, origin.latitude]);
      }
      const sameSelection = destination?.kind === 'help-report'
        ? !selectedEvacuationId.current && (!selectedHelpId.current || `help:${selectedHelpId.current}` === destination.id)
        : !selectedHelpId.current && (!selectedEvacuationId.current || selectedEvacuationId.current === destination?.id);
      if (destination && sameSelection && !latest.current.selectedId) {
        dismissEvacuation();
        dismissHelp();
        fitEvacuationRoute();
        if (destination.kind === 'help-report') {
          instance.getCanvas().focus({ preventScroll: true });
          latest.current.notify('Walking route shown on the map.');
        }
      }
    };
    if (instance.getStyle()) apply();
    else instance.once('style.load', apply);
    return () => { instance.off('style.load', apply); };
  }, [engineVersion, evacuationRoute.data, dismissEvacuation, dismissHelp, fitEvacuationRoute]);

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

          instance.setStyle(withLocalHazard(style, hazardVisibleRef.current,
            flow.basemap === 'satellite', hazardScenarioRef.current),
          { diff: true, transformStyle: preserveFlowLayers });
          appliedStyle.current = { basemap: flow.basemap, retry };


          const currentStyle = instance.getStyle();
          if (currentStyle?.name === style.name && currentStyle.layers?.length) {
            addBuildingLayers(instance);
            if (hazardVisibleRef.current && hazardProtocolRegistered)
              addHazardLayer(instance, true, hazardScenarioRef.current);
            setObservationLayerVisibility(instance, hazardVisibleRef.current);
            addEvacuationLayers(instance, sitesRef.current, sitesVisibleRef.current,
              evacuationIcon.current);
            addEvacuationRouteLayers(instance, routeData.current);
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
    const lib = library.current;
    if (!engineVersion || !instance || !lib) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (showHazard) {
      hazardArchiveFailed.current = false;
      hazardStateChange.current('loading');
      if (appliedHazardScenario.current !== hazardScenario) {
        hazardHadDataInView.current = false;
        if (instance.getLayer(HAZARD_LAYER_ID)) instance.removeLayer(HAZARD_LAYER_ID);
        if (instance.getSource(HAZARD_SOURCE_ID)) instance.removeSource(HAZARD_SOURCE_ID);
        appliedHazardScenario.current = hazardScenario;
      }
      if (instance.getLayer(HAZARD_LAYER_ID))
        setObservationLayerVisibility(instance, true);
      void prepareHazardProtocol(lib).then(() => {
        if (cancelled || map.current !== instance || !hazardVisibleRef.current) return;
        hazardArchiveReady.current = true;
        if (instance.getStyle()?.layers?.length) {
          addHazardLayer(instance, true, hazardScenario);
          setObservationLayerVisibility(instance, true);
          refreshHazard(instance);
        }
      }).catch(() => {
        if (cancelled || map.current !== instance || !hazardVisibleRef.current) return;
        hazardArchiveFailed.current = true;
        refreshHazard(instance);
      });
      timeout = setTimeout(() => {
        if (map.current !== instance || !hazardVisibleRef.current ||
            (hazardArchiveReady.current && instance.isSourceLoaded(HAZARD_SOURCE_ID))) return;
        hazardArchiveFailed.current = true;
        refreshHazard(instance);
      }, 20_000);
    } else {
      setObservationLayerVisibility(instance, false);
      hazardStateChange.current('off');
    }
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [engineVersion, showHazard, hazardScenario, refreshHazard]);

  useEffect(() => {
    const instance = map.current;
    if (!engineVersion || !instance) return;
    const source = instance.getSource(EVAC_SOURCE_ID) as GeoJSONSource | undefined;
    if (!source) return;
    void source.setData(evacuationData(evacuationSites));
  }, [engineVersion, evacuationSites]);

  useEffect(() => {
    const instance = map.current;
    if (!engineVersion || !instance?.getSource(EVAC_SOURCE_ID)) return;
    for (const id of [EVAC_ICON_LAYER_ID]) {
      if (instance.getLayer(id)) instance.setLayoutProperty(id, 'visibility',
        showEvacuationSites ? 'visible' : 'none');
    }
    if (instance.getLayer(EVAC_SITE_ID)) instance.setLayoutProperty(EVAC_SITE_ID,
      'visibility', instance.getLayer(EVAC_ICON_LAYER_ID) ? 'none'
        : showEvacuationSites ? 'visible' : 'none');
    if (!showEvacuationSites) sitePopup.current?.remove();
  }, [engineVersion, showEvacuationSites]);

  useLayoutEffect(() => {
    const instance = map.current;
    const popup = helpPopup.current;
    if (!helpPopupHost || !instance || !popup) return;
    const element = popup.getElement();
    const mapElement = instance.getContainer();
    const header = document.querySelector<HTMLElement>('.app-header');
    const viewport = window.visualViewport;
    let shiftX = 0;
    let shiftY = 0;
    const position = () => {
      if (helpPopup.current !== popup) return;
      const bounds = mapElement.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const left = Math.max(bounds.left, viewportLeft) + 12;
      const right = Math.min(bounds.right, viewportLeft + (viewport?.width ?? window.innerWidth)) - 12;
      const top = Math.max(bounds.top, viewportTop, header?.getBoundingClientRect().bottom ?? bounds.top) + 12;
      const bottom = Math.min(bounds.bottom, viewportTop + (viewport?.height ?? window.innerHeight)) - 12;
      const naturalLeft = rect.left - shiftX;
      const naturalTop = rect.top - shiftY;
      shiftX = Math.max(left, Math.min(naturalLeft, right - rect.width)) - naturalLeft;
      shiftY = Math.max(top, Math.min(naturalTop, bottom - rect.height)) - naturalTop;
      element.style.translate = `${shiftX}px ${shiftY}px`;
      element.classList.toggle('help-popup-shifted', Math.abs(shiftX) > 1 || Math.abs(shiftY) > 1);
    };
    position();
    helpPopupHost.element.querySelector<HTMLElement>('.help-popup-content')?.focus({ preventScroll: true });
    const observer = new ResizeObserver(position);
    observer.observe(element);
    observer.observe(mapElement);
    if (header) observer.observe(header);
    instance.on('move', position);
    window.addEventListener('resize', position);
    viewport?.addEventListener('resize', position);
    viewport?.addEventListener('scroll', position);
    return () => {
      observer.disconnect();
      instance.off('move', position);
      window.removeEventListener('resize', position);
      viewport?.removeEventListener('resize', position);
      viewport?.removeEventListener('scroll', position);
      element.style.removeProperty('translate');
      element.classList.remove('help-popup-shifted');
    };
  }, [helpPopupHost]);

  useEffect(() => {
    const instance = map.current;
    const lib = library.current;
    if (!engineVersion || !instance || !lib) return;
    const active = new Set(helpReports.map(report => report.id));
    let changed = false;
    for (const [id, marker] of helpMarkers.current) {
      if (!active.has(id)) {
        marker.remove();
        helpMarkers.current.delete(id);
        changed = true;
      }
    }
    for (const report of helpReports) {
      let marker = helpMarkers.current.get(report.id);
      if (!marker) {
        const element = document.createElement('div');
        element.className = 'help-marker-host';
        marker = new lib.Marker({ element, anchor: 'bottom' })
          .setLngLat([report.longitude, report.latitude]).addTo(instance);
        helpMarkers.current.set(report.id, marker);
        changed = true;
      }
      marker.setLngLat([report.longitude, report.latitude]);
    }
    if (changed) setHelpHosts([...helpMarkers.current].map(([id, marker]) => ({ id, element: marker.getElement() })));
    if (helpPopupHost) {
      const report = helpReports.find(item => item.id === helpPopupHost.id);
      if (!report) dismissHelp();
      else helpPopup.current?.setLngLat([report.longitude, report.latitude]);
    }
  }, [engineVersion, helpReports, helpPopupHost, dismissHelp]);

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
    if (!hosts.length) return;
    const visible = new Set<HTMLElement>();
    const updatePlayback = () => {
      for (const { element } of hosts) {
        element.dataset.ripplePaused = String(document.hidden || !visible.has(element));
      }
    };
    const observer = typeof IntersectionObserver === 'undefined' ? null
      : new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const element = entry.target as HTMLElement;
          if (entry.isIntersecting) visible.add(element);
          else visible.delete(element);
        }
        updatePlayback();
      }, { root: container.current, rootMargin: '80px' });
    for (const { element } of hosts) {
      if (observer) observer.observe(element);
      else visible.add(element);
    }
    updatePlayback();
    document.addEventListener('visibilitychange', updatePlayback);
    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', updatePlayback);
    };
  }, [hosts]);

  useEffect(() => {
    if (!engineVersion || !flow.selectedId) {
      lastFocused.current = null;
      return;
    }

    const key = flow.selectedId;
    if (lastFocused.current === key) return;
    lastFocused.current = key;
    const frame = requestAnimationFrame(() => focus(flow.selectedId!));
    return () => cancelAnimationFrame(frame);
  }, [engineVersion, flow.selectedId, focus]);

  useEffect(() => {
    if (!engineVersion || flow.selectedId || !nodeReturnView.current) return;
    const returnView = nodeReturnView.current;
    nodeReturnView.current = null;
    const instance = map.current;
    if (!instance || selectedEvacuationId.current) return;
    restorePitchAfterZoomOut.current = false;
    viewTransitioning.current = null;
    instance.easeTo({ ...returnView,
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 320 });
  }, [engineVersion, flow.selectedId]);

  return (
    <>
      <div ref={container} id="map" aria-label="Geographic monitoring map" />
      {helpHosts.map(({ id, element }) => {
        const report = helpReports.find(item => item.id === id);
        if (!report) return null;
        return createPortal(<button type="button" className="help-marker"
          aria-label={`${report.name || 'Someone'} needs help. Open unverified community report.`}
          onClick={event => { event.stopPropagation(); focusHelpReport(id); }}>
          <Icon name="help-person" /><span>HELP</span>
        </button>, element, id);
      })}
      {helpPopupHost && (() => {
        const report = helpReports.find(item => item.id === helpPopupHost.id);
        if (!report) return null;
        const routeId = `help:${report.id}`;
        const routeStatus = evacuationRoute.site?.id === routeId ? evacuationRoute.status : 'idle';
        const routeBusy = routeStatus === 'locating' || routeStatus === 'loading';
        return createPortal(<div className="help-popup-content" role="region" aria-label="Help request details"
          tabIndex={-1} onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              helpPopup.current?.remove();
            }
          }}>
          <h3>Help requested</h3>
          <p className="help-unverified">Community report · unverified</p>
          {!helpReportsLive && <p>Updates paused. This report may be out of date.</p>}
          <ReportDetails report={report} compact />
          <p>No response or rescue has been confirmed.</p>
          <button type="button" className="primary-btn help-directions" disabled={routeBusy}
            aria-busy={routeBusy} aria-live="polite" onClick={event => {
              event.stopPropagation();
              if (routeBusy || event.currentTarget.disabled) return;
              if (Date.parse(report.expires_at) <= Date.now()) {
                flow.notify('This help request has expired. Refresh the reports to see current requests.', true);
                return;
              }
              event.currentTarget.disabled = true;
              nodeReturnView.current = null;
              flow.closeDetails();
              void evacuationRoute.start({ id: routeId, kind: 'help-report',
                name: report.name || 'Help requested', latitude: report.latitude, longitude: report.longitude },
              'walking', { freshLocation: true });
            }}>
            <Icon name="route" />{routeStatus === 'locating' ? 'Finding location…'
              : routeStatus === 'loading' ? 'Finding route…' : 'Get Directions'}
          </button>
          <a className="secondary-btn help-google-maps" target="_blank" rel="noopener noreferrer"
            href={`https://www.google.com/maps/search/?api=1&query=${report.latitude},${report.longitude}`}
            onClick={event => event.stopPropagation()}>
            <Icon name="arrow-up-right" />Open in Google Maps
          </a>
          <p>Route to the nearest mapped path. Flood conditions and access are not verified.</p>
          {report.id === ownReportId && <button type="button" className="secondary-btn"
            onClick={() => flow.setModal('report')}>Manage my request</button>}
        </div>, helpPopupHost.element);
      })()}
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
            data-level={status.level ?? 'unavailable'}
            data-unavailable={status.level === null}
            data-ripple-active={status.level !== null && !status.connectionLost}
            data-zoom-tier={zoomTier}
            aria-label={`${node.name}: ${status.label} at this sensor. Open details.`}
            aria-pressed={flow.selectedId === id}
            title={`${node.name}: ${status.label}. Open sensor details.`}
            onClick={(event) => {
              event.stopPropagation();
              flow.selectNode(id);
              focus(id);
            }}
          >
            <span className="marker-label">{node.name}</span>
            <span className="sensor-ripples" aria-hidden="true">
              <span className="sensor-ripple" />
              <span className="sensor-ripple" />
              <span className="sensor-ripple" />
            </span>
            <span className="pin-ring"><Icon name="sensor" /></span>
          </button>,
          element,
          id,
        );
      })}
    </>
  );
});
