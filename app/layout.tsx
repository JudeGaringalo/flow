import type { Metadata, Viewport } from 'next';
import 'maplibre-gl/dist/maplibre-gl.css';
import './globals.css';
import './reference-ui.css';

export const metadata: Metadata = {
  title: 'FLOW',
  description: 'A map-first view of monitored flood conditions, with sensor history and FLOW Intelligence.',
  applicationName: 'FLOW',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/assets/flow-wave.png',
    apple: '/assets/flow-wave.png'
  },
  appleWebApp: {
    capable: true,
    title: 'FLOW',
    statusBarStyle: 'default'
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#ffffff'
};

export default function RootLayout({ children }: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="light" suppressHydrationWarning>{children}</body>
    </html>
  );
}
