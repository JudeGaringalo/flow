import type {
  LayerSpecification,
  StyleSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';

import type { Basemap } from './types';

/**
 * One vector source and one set of labels are used across all four basemaps.
 * Satellite adds imagery below those labels. Terrain adds real DEM hillshading
 * below the same roads and labels. Neither layer describes flood extent.
 */
const VECTOR_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const DEM_TILES =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const IMAGERY_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

export const BASEMAPS: { id: Basemap; label: string; description: string }[] = [
  { id: 'standard', label: 'Standard', description: 'Streets and places' },
  { id: 'terrain', label: 'Terrain', description: 'Shaded relief + streets' },
  { id: 'satellite', label: 'Satellite', description: 'Imagery + street labels' },
  { id: 'dark', label: 'Dark', description: 'Low-light street map' },
];

let vectorStyle: StyleSpecification | null = null;

export function isBasemap(value: unknown): value is Basemap {
  return BASEMAPS.some(({ id }) => id === value);
}

function sourceLayer(layer: LayerSpecification): string {
  return 'source-layer' in layer ? String(layer['source-layer']) : '';
}

/** Recolor the renderer, not the geographic data or road-name expressions. */
function styleLayer(
  original: LayerSpecification,
  mode: Basemap,
): LayerSpecification {
  const layer = structuredClone(original);
  const source = sourceLayer(layer);
  const dark = mode === 'dark';
  const satellite = mode === 'satellite';
  const id = layer.id.toLowerCase();

  if (layer.type === 'background') {
    layer.paint = { ...layer.paint, 'background-color': dark ? '#112232' : '#f4f5f4' };
  }

  if (layer.type === 'fill') {
    if (source === 'water') {
      layer.paint = { ...layer.paint, 'fill-color': dark ? '#153e50' : '#b7e5ed' };
    } else if (source === 'building') {
      layer.paint = {
        ...layer.paint,
        'fill-color': dark ? '#203342' : '#e9edef',
        'fill-outline-color': dark ? '#294354' : '#dde4e8',
      };
    } else if (source === 'landcover' || source === 'park') {
      layer.paint = {
        ...layer.paint,
        'fill-color': dark ? '#173b32' : '#c9ead1',
        'fill-opacity': 0.55,
      };
    } else if (source === 'landuse') {
      layer.paint = {
        ...layer.paint,
        'fill-color': dark ? '#1c2e3a' : '#edf0e8',
      };
    }
  }

  if (layer.type === 'line') {
    if (source === 'waterway') {
      layer.paint = { ...layer.paint, 'line-color': dark ? '#28576c' : '#ade0ec' };
    } else if (source === 'transportation' && !id.includes('rail')) {
      const casing = /casing|outline/.test(id);
      const major = /motorway|trunk|primary/.test(id);
      layer.paint = {
        ...layer.paint,
        'line-color': satellite
          ? casing ? '#183346' : '#f5f5e5'
          : dark
            ? casing ? '#2f485b' : major ? '#435865' : '#344b5d'
            : casing ? '#dbe3e8' : major ? '#f8edce' : '#ffffff',
        ...(satellite ? { 'line-opacity': casing ? 0.38 : 0.56 } : {}),
      };
    } else if (source === 'boundary') {
      layer.paint = { ...layer.paint, 'line-color': dark ? '#5a7081' : '#c4cfd6' };
    }
  }

  if (layer.type === 'symbol') {
    const label = layer as SymbolLayerSpecification;
    const isWater = source === 'water_name' || source === 'waterway';
    const isPoi = source === 'poi';
    label.paint = {
      ...label.paint,
      'text-color': dark || satellite
        ? isWater ? '#9bd9ee' : '#f5f8fc'
        : isWater ? '#419fba' : isPoi ? '#427b96' : '#596873',
      'text-halo-color': dark || satellite ? '#142735' : '#ffffff',
      'text-halo-width': dark || satellite ? 1.6 : 1.4,
      'text-halo-blur': 0.4,
    };
    // Keep upstream text-field, filters, minzoom, text-size and collision rules.
    // This is why the same streets retain the same names in every mode.
  }

  return layer;
}

/** Pure style composition; used by the map and by regression tests. */
export function composeBasemap(
  input: StyleSpecification,
  mode: Basemap,
): StyleSpecification {
  const base = structuredClone(input);
  const layers = base.layers.map((layer) => styleLayer(layer, mode));
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
          (layer.type === 'line' &&
            ['transportation', 'boundary'].includes(sourceLayer(layer))),
        ),
      ],
    };
  }

  if (mode === 'terrain') {
    sources['flow-elevation'] = {
      type: 'raster-dem',
      tiles: [DEM_TILES],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 15,
      attribution: 'Terrain: Mapzen / Tilezen; USGS, NOAA and other source contributors',
    };

    const insertion = layers.findIndex((layer) =>
      layer.type === 'line' || layer.type === 'symbol',
    );
    layers.splice(insertion < 0 ? layers.length : insertion, 0, {
      id: 'flow-hillshade',
      type: 'hillshade',
      source: 'flow-elevation',
      paint: {
        'hillshade-exaggeration': 0.28,
        'hillshade-shadow-color': '#788a72',
        'hillshade-highlight-color': '#ffffff',
        'hillshade-accent-color': '#a5af8f',
      },
    });
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
