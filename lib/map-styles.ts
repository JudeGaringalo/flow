import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  StyleSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';

import type { Basemap } from './types';





const VECTOR_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const IMAGERY_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

export const SATELLITE_OCEAN_COLOR = '#102c38';

export const BUILDING_FILL_COLOR: ExpressionSpecification = [
  'case', ['>=', ['to-number', ['get', 'render_height'], 0], 15],
  '#3562b8', '#89b777',
];
export const BUILDING_OUTLINE_COLOR: ExpressionSpecification = [
  'case', ['>=', ['to-number', ['get', 'render_height'], 0], 15],
  '#244b94', '#537f47',
];

export const BASEMAPS: { id: Basemap; label: string; description: string }[] = [
  { id: 'standard', label: 'Standard', description: 'Streets and places' },
  { id: 'satellite', label: 'Satellite', description: 'Imagery + street labels' },
];

let vectorStyle: StyleSpecification | null = null;

export function isBasemap(value: unknown): value is Basemap {
  return BASEMAPS.some(({ id }) => id === value);
}

function sourceLayer(layer: LayerSpecification): string {
  return 'source-layer' in layer ? String(layer['source-layer']) : '';
}


function styleLayer(
  original: LayerSpecification,
  mode: Basemap,
): LayerSpecification {
  const layer = structuredClone(original);
  const source = sourceLayer(layer);
  const satellite = mode === 'satellite';
  const id = layer.id.toLowerCase();

  if (layer.type === 'background') {
    layer.paint = { ...layer.paint, 'background-color': '#f4f5f4' };
  }

  if (layer.type === 'fill') {
    if (source === 'water') {
      layer.paint = { ...layer.paint,
        'fill-color': satellite ? SATELLITE_OCEAN_COLOR : '#b7e5ed',
        ...(satellite ? { 'fill-opacity': 1 } : {}),
      };
      if (satellite) layer.filter = ['all', ...(layer.filter ? [layer.filter] : []),
        ['match', ['get', 'class'], ['ocean', 'sea'], true, false]] as FilterSpecification;
    } else if (source === 'building') {
      layer.paint = {
        ...layer.paint,
        'fill-color': BUILDING_FILL_COLOR,
        'fill-outline-color': BUILDING_OUTLINE_COLOR,
        'fill-opacity': 1,
      };
    } else if (source === 'landcover' || source === 'park') {
      layer.paint = {
        ...layer.paint,
        'fill-color': '#c9ead1',
        'fill-opacity': 0.55,
      };
    } else if (source === 'landuse') {
      layer.paint = {
        ...layer.paint,
        'fill-color': '#edf0e8',
      };
    }
  }

  if (layer.type === 'fill-extrusion' && source === 'building') {
    layer.paint = {
      ...layer.paint,
      'fill-extrusion-color': BUILDING_FILL_COLOR,
      'fill-extrusion-opacity': 1,
    };
  }

  if (layer.type === 'line') {
    if (source === 'waterway') {
      layer.paint = { ...layer.paint, 'line-color': '#ade0ec' };
    } else if (source === 'transportation' && !id.includes('rail')) {
      const casing = /casing|outline/.test(id);
      const major = /motorway|trunk|primary/.test(id);
      layer.paint = {
        ...layer.paint,
        'line-color': satellite
          ? casing ? '#183346' : '#f5f5e5'
          : casing ? '#dbe3e8' : major ? '#f8edce' : '#ffffff',
        ...(satellite ? { 'line-opacity': casing ? 0.38 : 0.56 } : {}),
      };
    } else if (source === 'boundary') {
      layer.paint = { ...layer.paint, 'line-color': '#c4cfd6' };
    }
  }

  if (layer.type === 'symbol') {
    const label = layer as SymbolLayerSpecification;
    const isWater = source === 'water_name' || source === 'waterway';
    if (source !== 'transportation_name' && label.layout) {
      delete label.layout['icon-image'];
    }
    label.paint = {
      ...label.paint,
      'text-color': satellite
        ? isWater ? '#9bd9ee' : '#f5f8fc'
        : isWater ? '#419fba' : '#596873',
      'text-halo-color': satellite ? '#142735' : '#ffffff',
      'text-halo-width': satellite ? 1.6 : 1.4,
      'text-halo-blur': 0.4,
    };
  }

  return layer;
}


export function composeBasemap(
  input: StyleSpecification,
  mode: Basemap,
): StyleSpecification {
  const base = structuredClone(input);
  const layers = base.layers
    .filter(layer => layer.type !== 'symbol' ||
      (sourceLayer(layer) !== 'poi' &&
        (sourceLayer(layer) === 'transportation_name' || layer.layout?.['text-field'] !== undefined)))
    .map(layer => styleLayer(layer, mode));
  const sources = { ...base.sources };

  if (mode === 'satellite') {
    sources['flow-imagery'] = {
      type: 'raster',
      tiles: [IMAGERY_TILES],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics and contributors',
    };

    return {
      ...base,
      name: 'FLOW Satellite + street labels',
      sources,
      layers: [
        { id: 'flow-imagery', type: 'raster', source: 'flow-imagery' },
        ...layers.filter((layer) =>
          layer.type === 'symbol' ||
          (layer.type === 'fill' && sourceLayer(layer) === 'water') ||
          ((layer.type === 'fill' || layer.type === 'fill-extrusion') &&
            sourceLayer(layer) === 'building') ||
          (layer.type === 'line' &&
            ['transportation', 'boundary'].includes(sourceLayer(layer))),
        ),
      ],
    };
  }

  return { ...base, name: `FLOW ${mode}`, sources, layers };
}

export async function loadBasemap(
  mode: Basemap,
  signal: AbortSignal,
): Promise<StyleSpecification> {
  if (!vectorStyle) {
    const response = await fetch(VECTOR_STYLE_URL, { signal });
    if (!response.ok) throw new Error('The map style could not be loaded.');
    const data = (await response.json()) as StyleSpecification;
    if (data.version !== 8 || !Array.isArray(data.layers) || !data.sources) {
      throw new Error('The map provider returned an invalid style.');
    }
    vectorStyle = data;
  }
  signal.throwIfAborted();
  return composeBasemap(vectorStyle, mode);
}
