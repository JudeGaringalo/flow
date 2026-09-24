import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'FLOW — Flood-Level Observation & Warning',
    short_name: 'FLOW',
    description: 'Map-first flood observation and sensor information.',
    start_url: '/',
    scope: '/',
    related_applications: [
      { platform: 'webapp', url: '/manifest.webmanifest' }
    ],
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#053c82',
    icons: [
      {
        src: '/assets/flow-icon.png',
        sizes: '192x192',
        type: 'image/png'
      },
      {
        src: '/assets/flow-icon.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any'
      }
    ]
  };
}
