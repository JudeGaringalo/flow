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
import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, GeoJSONSourceSpecification, LayerSpecification, Map as LibreMap, Marker as LibreMarker, Popup as LibrePopup, StyleSpecification, VectorSourceSpecification } from 'maplibre-gl';

import { Icon } from './icon';
import { useFlow } from '@/hooks/use-flow';
import { loadBasemap } from '@/lib/map-styles';
import type { MappedEvacuationSite } from '@/lib/evacuation-sites';
import hazardBundle from '@/lib/hazard-bundle.json';
import hazardOverview from '@/lib/hazard-overview.json';
import hazard100 from '@/lib/hazard-100.json';
import neighboringCountries from '@/lib/neighboring-countries.json';
import type { Basemap, MapHandle } from '@/lib/types';

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

const HEAT_SOURCE_ID = 'flow-sensor-heat';
const HAZARD_SOURCE_ID = 'flow-noah-hazard';
const HAZARD_LAYER_ID = 'flow-noah-hazard-fill';
const HAZARD_BUILDING_MASK_ID = 'flow-noah-building-mask';
const NEIGHBORS_SOURCE_ID = 'flow-neighboring-countries';
const NEIGHBORS_MASK_ID = 'flow-neighboring-countries-mask';
const EVAC_SOURCE_ID = 'flow-evacuation-sites';
const EVAC_SITE_ID = 'flow-evacuation-points';
const EVAC_ICON_ID = 'flow-evacuation-icon';
const EVAC_ICON_LAYER_ID = 'flow-evacuation-icons';
const EVAC_FOOTPRINT_SOURCE_ID = 'flow-evacuation-footprint';
const EVAC_FOOTPRINT_FILL_ID = 'flow-evacuation-footprint-fill';
const EVAC_FOOTPRINT_3D_ID = 'flow-evacuation-footprint-3d';
const BUILDINGS_3D_ID = 'flow-buildings-3d';
const BUILDINGS_3D_MIN_ZOOM = 12;
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

export type HazardScenario = '5yr' | '100yr';
const HAZARD_ARCHIVES: Record<HazardScenario, string> = {
  '5yr': process.env.NEXT_PUBLIC_NOAH_5YR_PMTILES_URL?.trim()
    || 'https://huggingface.co/datasets/bettergovph/project-noah-hazard-maps/resolve/main/PMTiles/layers/flood_5yr.pmtiles',
  '100yr': process.env.NEXT_PUBLIC_NOAH_100YR_PMTILES_URL?.trim()
    || 'https://huggingface.co/datasets/bettergovph/project-noah-hazard-maps/resolve/main/PMTiles/layers/flood_100yr.pmtiles',
};
const LOCAL_HAZARD = hazardBundle.ready;
const LOCAL_OVERVIEW = hazardOverview.ready;
const LOCAL_100 = hazard100.ready;
let hazardProtocolRegistered = false;
const hazardArchives: Partial<Record<HazardScenario, import('pmtiles').PMTiles>> = {};
let hazardProtocolPromise: Promise<void> | null = null;

export type HazardState = 'off' | 'loading' | 'ready' | 'empty' | 'zoom' | 'unavailable';

function tileIntersectsBounds(z: number, x: number, y: number,
  bounds: readonly number[]) {
  const [west, south, east, north] = bounds;
  const count = 2 ** z;
  const xAt = (longitude: number) => Math.max(0, Math.min(count - 1,
    Math.floor((longitude + 180) / 360 * count)));
  const yAt = (latitude: number) => Math.max(0, Math.min(count - 1,
    Math.floor((1 - Math.asinh(Math.tan(latitude * Math.PI / 180)) / Math.PI) / 2 * count)));
  return x >= xAt(west) && x <= xAt(east) &&
    y >= yAt(north) && y <= yAt(south);
}

function tileInLocalBundle(z: number, x: number, y: number) {
  return LOCAL_HAZARD && z >= hazardBundle.minzoom && z <= hazardBundle.maxzoom &&
    tileIntersectsBounds(z, x, y, hazardBundle.bounds);
}

function tileInLocal100(z: number, x: number, y: number) {
  return LOCAL_100 && z <= hazard100.maxzoom &&
    tileIntersectsBounds(z, x, y,
      z <= hazard100.overviewMaxzoom ? hazard100.overviewBounds : hazard100.detailBounds);
}

function prepareHazardProtocol(lib: typeof import('maplibre-gl')) {
  if (!hazardProtocolPromise) {
    hazardProtocolPromise = import('pmtiles').then(pmtiles => {
      if (!hazardProtocolRegistered) {
        lib.addProtocol('flowhazard', async (params, abortController) => {
          const match = /^flowhazard:\/\/noah\/(5yr|100yr)\/(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(params.url);
          if (!match) throw new Error('Invalid FLOW hazard tile URL');
          const scenario = match[1] as HazardScenario;
          const [z, x, y] = match.slice(2).map(Number);
          if (scenario === '100yr' && tileInLocal100(z, x, y)) {
            const local = await fetch(
              `/hazard/${hazard100.version}/${z}/${x}/${y}.pbf.gz`,
              { signal: abortController.signal },
            );
            if (local.ok) return { data: new Uint8Array(await local.arrayBuffer()) };
          }
          if (scenario === '5yr' && LOCAL_OVERVIEW && z <= hazardOverview.maxzoom &&
              tileIntersectsBounds(z, x, y, hazardOverview.bounds)) {
            const overview = await fetch(
              `/hazard/${hazardOverview.version}/${z}/${x}/${y}.pbf.gz`,
              { signal: abortController.signal },
            );
            if (overview.ok) return { data: new Uint8Array(await overview.arrayBuffer()) };
          }
          if (scenario === '5yr' && tileInLocalBundle(z, x, y)) {
            const local = await fetch(
              `/hazard/${hazardBundle.version}/${z}/${x}/${y}.pbf`,
              { signal: abortController.signal },
            );
            if (local.ok) return { data: new Uint8Array(await local.arrayBuffer()) };
          }
          const archive = hazardArchives[scenario] ??
            (hazardArchives[scenario] = new pmtiles.PMTiles(HAZARD_ARCHIVES[scenario]));
          const tile = await archive.getZxy(z, x, y, abortController.signal);
          abortController.signal.throwIfAborted();
          return { data: tile ? new Uint8Array(tile.data) : new Uint8Array() };
        });
        hazardProtocolRegistered = true;
      }
    }).catch(error => {
      hazardProtocolPromise = null;
      throw error;
    });
  }
  return hazardProtocolPromise;
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
    paint: { 'fill-color': satellite ? '#102c38' : '#b7e5ed', 'fill-opacity': 1 },
  });
  else instance.setPaintProperty(NEIGHBORS_MASK_ID, 'fill-color',
    satellite ? '#102c38' : '#b7e5ed');
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
    (layer.type === 'fill' || layer.type === 'fill-extrusion') &&
    'source-layer' in layer && layer['source-layer'] === 'building')?.id
    ?? layers.find(layer => layer.type === 'symbol')?.id;
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
    paint: { 'fill-color': satellite ? '#102c38' : '#b7e5ed', 'fill-opacity': 1 },
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
}

function setObservationLayerVisibility(instance: LibreMap, hazardVisible: boolean,
  heatVisible = !hazardVisible) {
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
  for (const level of [1, 2, 3]) {
    const id = `flow-sensor-heat-${level}`;
    if (instance.getLayer(id)) {
      const visibility = heatVisible ? 'visible' : 'none';
      if (instance.getLayoutProperty(id, 'visibility') !== visibility)
        instance.setLayoutProperty(id, 'visibility', visibility);
    }
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
        'fill-color': satellite ? '#aeb2bb' : '#e9edef',
        'fill-outline-color': satellite ? '#87939d' : '#dde4e8',
        'fill-opacity': 1,
      },
    }, beforeId);
    else {
      instance.setPaintProperty(HAZARD_BUILDING_MASK_ID, 'fill-color',
        satellite ? '#aeb2bb' : '#e9edef');
      instance.setPaintProperty(HAZARD_BUILDING_MASK_ID, 'fill-outline-color',
        satellite ? '#87939d' : '#dde4e8');
      instance.moveLayer(HAZARD_BUILDING_MASK_ID, beforeId);
    }
  }


  const color: ExpressionSpecification = ['interpolate', ['linear'],
    ['to-number', ['get', 'render_height'], 0],
    0, '#aeb2bb', 8, '#9aa4b6', 16, '#7895c8',
    30, '#547bc7', 70, '#3562b8'];
  const opacity = 1;
  if (buildingExtrusions.length) {
    if (instance.getLayer(BUILDINGS_3D_ID)) instance.removeLayer(BUILDINGS_3D_ID);
    for (const extrusion of buildingExtrusions) {
      instance.setLayerZoomRange(extrusion.id, BUILDINGS_3D_MIN_ZOOM, 24);
      instance.setPaintProperty(extrusion.id, 'fill-extrusion-color', color);
      instance.setPaintProperty(extrusion.id, 'fill-extrusion-opacity', opacity);
      instance.setPaintProperty(extrusion.id, 'fill-extrusion-height',
        ['to-number', ['get', 'render_height'], 0]);
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
          minzoom: BUILDINGS_3D_MIN_ZOOM,
          filter: ['!=', ['get', 'hide_3d'], true],
          paint: {
            'fill-extrusion-color': color,
            'fill-extrusion-opacity': opacity,
            'fill-extrusion-height': ['to-number', ['get', 'render_height'], 0],
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
  hazardScenario: HazardScenario;
  onHazardStateChange: (state: HazardState) => void;
}>(function MapCanvas({ onFlatViewChange, evacuationSites, showEvacuationSites,
  showHazard, hazardScenario, onHazardStateChange }, ref) {
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
  const hazardScenarioRef = useRef(hazardScenario);
  hazardScenarioRef.current = hazardScenario;
  const appliedHazardScenario = useRef<HazardScenario | null>(null);
  const hazardStateChange = useRef(onHazardStateChange);
  hazardStateChange.current = onHazardStateChange;
  const hazardArchiveReady = useRef(false);
  const hazardArchiveFailed = useRef(false);
  const hazardHadDataInView = useRef(false);
  const lastHeatSnapshot = useRef('');

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
  const nodeReturnView = useRef<CameraView | null>(null);
  const evacuationReturnView = useRef<CameraView | null>(null);
  const restorePitchAfterZoomOut = useRef(false);

  const refreshHazard = useCallback((instance: LibreMap) => {
    if (!hazardVisibleRef.current || !instance.getSource(HAZARD_SOURCE_ID)) return;
    if (!hazardArchiveReady.current || !instance.isSourceLoaded(HAZARD_SOURCE_ID)) {
      if (hazardArchiveFailed.current) {
        setObservationLayerVisibility(instance, true, true);
        hazardStateChange.current('unavailable');
      } else if (!hazardHadDataInView.current) {
        setObservationLayerVisibility(instance, true, true);
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
    setObservationLayerVisibility(instance, true, true);
    hazardStateChange.current(hazardArchiveFailed.current ? 'unavailable' : 'empty');
  }, []);

  const dismissEvacuation = useCallback((instance: LibreMap) => {
    selectedEvacuationId.current = null;
    evacuationReturnView.current = null;
    sitePopup.current?.remove();
    sitePopup.current = null;
    selectedFootprintKey.current = '';
    const footprint = instance.getSource(EVAC_FOOTPRINT_SOURCE_ID) as GeoJSONSource | undefined;
    if (footprint) void footprint.setData(emptyFootprint());
  }, []);

  const focus = useCallback((id: string) => {
    const instance = map.current;
    const el = container.current;
    const node = latest.current.nodes.find((item) => item.id === id);
    if (!instance || !el || !node) return;
    const target: [number, number] = [node.longitude, node.latitude];
    if (!nodeReturnView.current) nodeReturnView.current = returnViewAt(instance, target);
    else nodeReturnView.current.center = target;
    if (selectedEvacuationId.current) dismissEvacuation(instance);
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
  }, [dismissEvacuation]);

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

    sitePopup.current = new lib.Popup({ offset: 16, maxWidth: '290px', closeOnClick: false,
      className: 'flow-evacuation-popup' })
      .setLngLat([site.longitude, site.latitude]).setDOMContent(content).addTo(instance);
    sitePopup.current.on('close', () => {
      if (selectedEvacuationId.current !== id) return;
      selectedEvacuationId.current = null;
      sitePopup.current = null;
      selectedFootprintKey.current = '';
      const currentSource = instance.getSource(EVAC_FOOTPRINT_SOURCE_ID) as GeoJSONSource | undefined;
      if (currentSource) void currentSource.setData(emptyFootprint());
      const returnView = evacuationReturnView.current;
      evacuationReturnView.current = null;
      if (returnView) instance.easeTo({ ...returnView,
        duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 320 });
    });
    instance.easeTo({ center: [site.longitude, site.latitude],
      zoom: Math.max(15, instance.getZoom()),
      pitch: CITY_PITCH, bearing: CITY_BEARING,
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 320 });
  }, []);

  const finishViewTransitionIfIdle = useCallback((instance: LibreMap, transitionId: number) => {
    if (viewTransitioning.current !== transitionId || instance.isMoving()) return;
    viewTransitioning.current = null;
    flatViewChange.current(instance.getPitch() <= 1);
  }, []);

  const showPhilippines = useCallback((transitionId?: number) => {
    const instance = map.current;
    if (!instance) return;
    nodeReturnView.current = null;
    dismissEvacuation(instance);
    restorePitchAfterZoomOut.current = false;
    instance.fitBounds(PHILIPPINES_OVERVIEW_BOUNDS, {
      padding: overviewPadding(instance.getContainer().clientWidth),
      pitch: 0,
      bearing: 0,
      duration: 320,
    }, transitionId === undefined ? undefined : { flowViewTransition: transitionId });
    if (transitionId !== undefined) finishViewTransitionIfIdle(instance, transitionId);
  }, [dismissEvacuation, finishViewTransitionIfIdle]);

  const fit = useCallback(() => {
    const instance = map.current;
    const lib = library.current;
    if (!instance || !lib || viewTransitioning.current !== null) return;
    dismissEvacuation(instance);
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
  }, [dismissEvacuation, finishViewTransitionIfIdle, showPhilippines]);

  const wideView = useCallback(() => {
    const instance = map.current;
    if (!instance || viewTransitioning.current !== null) return;
    dismissEvacuation(instance);
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
  }, [dismissEvacuation, finishViewTransitionIfIdle]);

  useImperativeHandle(ref, () => ({
    focus,
    focusEvacuation,
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
  }), [finishViewTransitionIfIdle, focus, focusEvacuation, fit, showPhilippines, wideView]);

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
          maxBounds: MAP_LIMITS,
          renderWorldCopies: false,
          transformCameraUpdate: ({ center, zoom, pitch }) => {
            if (zoom <= overviewZoom + 0.01) {
              return { center: overviewCenter, pitch: 0, bearing: 0 };
            }
            // A pitched wide view exposes far more tiles than a flat one.
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
            selectedFootprintKey.current = '';
            addHeatLayers(instance, latest.current);
            if (hazardVisibleRef.current && hazardProtocolRegistered)
              addHazardLayer(instance, true, hazardScenarioRef.current);
            setObservationLayerVisibility(instance, hazardVisibleRef.current,
              !hazardHadDataInView.current);
            addEvacuationLayers(instance, sitesRef.current, sitesVisibleRef.current,
              evacuationIcon.current);
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
          if (selectedEvacuationId.current) refreshSelectedFootprint(instance);
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
      userMarker.current?.remove();
      selectedEvacuationId.current = null;
      sitePopup.current?.remove();
      sitePopup.current = null;
      if (evacuationIcon.current) evacuationIcon.current.onload = null;
      evacuationIcon.current = null;
      selectedFootprintKey.current = '';
      instance?.remove();
      map.current = null;
      appliedStyle.current = null;
      nodeReturnView.current = null;
      evacuationReturnView.current = null;
      viewTransitioning.current = null;
      restorePitchAfterZoomOut.current = false;
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

          instance.setStyle(withLocalHazard(style, hazardVisibleRef.current,
            flow.basemap === 'satellite', hazardScenarioRef.current), { diff: true });
          appliedStyle.current = { basemap: flow.basemap, retry };


          const currentStyle = instance.getStyle();
          if (currentStyle?.name === style.name && currentStyle.layers?.length) {
            addHeatLayers(instance, latest.current);
            if (hazardVisibleRef.current && hazardProtocolRegistered)
              addHazardLayer(instance, true, hazardScenarioRef.current);
            setObservationLayerVisibility(instance, hazardVisibleRef.current,
              !hazardHadDataInView.current);
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
        setObservationLayerVisibility(instance, true, !hazardHadDataInView.current);
      void prepareHazardProtocol(lib).then(() => {
        if (cancelled || map.current !== instance || !hazardVisibleRef.current) return;
        hazardArchiveReady.current = true;
        if (instance.getSource(HEAT_SOURCE_ID)) {
          addHazardLayer(instance, true, hazardScenario);
          setObservationLayerVisibility(instance, true, !hazardHadDataInView.current);
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
    const source = instance.getSource(HEAT_SOURCE_ID) as GeoJSONSource | undefined;
    if (!source) return;
    const data = heatData(flow);
    const snapshot = JSON.stringify(data);
    if (snapshot === lastHeatSnapshot.current) return;
    lastHeatSnapshot.current = snapshot;
    void source.setData(data);
  }, [engineVersion, flow.visibleNodes, flow.getStatus]);

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
