# Reference UI implementation notes

This frontend patch preserves the source/data contract of the three-level live-only FLOW app.
See README-FIRST.md in the patch for installation and validation limitations.

## Components

- `components/flow/flow-app.tsx`: reference header, floating search and map controls.
- `components/flow/node-details.tsx`: reference sheet/card hierarchy and existing detail actions.
- `components/flow/history-chart.tsx`: discrete threshold chart, range labels, no forecast extrapolation.
- `components/flow/map-canvas.tsx`: MapLibre lifecycle, React marker portals and unobtrusive credits.
- `components/flow/dialogs.tsx`: basemap chooser, provider credits and safe development SW behavior.
- `lib/map-styles.ts`: one shared vector label source, with optional satellite imagery underneath.
- `app/reference-ui.css`: isolated reference-specific styling imported after existing global styles.

## Behavioral boundaries

A monitoring point is not a flood-coverage polygon. A missing sensor observation is
not a dry road. All displayed measurements and AI summaries must originate from the
existing live backend. Unsupported reference metrics remain unavailable.

The history chart is an event-state timeline, not an exact-depth chart. The backend
currently stores transitions rather than a full heartbeat archive; therefore it cannot
reconstruct every historical communication outage. Do not describe this chart as
proof of uninterrupted sensor observation.

## Map source documentation

- https://openfreemap.org/quick_start/
- https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/TransformStyleFunction/
- https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9
- https://osmfoundation.org/wiki/Licence/Attribution_Guidelines

Basemap previews in the picker are abstract CSS icons, not additional map tiles or
sensor data. All views preserve the same street-name expressions, but contrast,
zoom, collision rules and tile coverage still affect which labels are visible.

## Testing

```sh
node scripts/test-map-styles.mjs
npm run check
```

The map-style test uses synthetic style objects rather than network services. Real
tile loading, iPhone PWA/push delivery and the full Next.js build must be verified in
your own environment. Review changes before overwriting locally customized files.
