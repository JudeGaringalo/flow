import type { SVGProps } from 'react';

// Lucide-derived paths retained from the supplied UI. See THIRD_PARTY.md (ISC).
const paths = {
  'flood': (
    <>
      <path d="m4 10 8-7 8 7M7 9v6h10V9M10 15v-4h4v4" />
      <path d="M3 18c2-2 4 2 6 0s4 2 6 0 4 2 6 0M3 22c2-2 4 2 6 0s4 2 6 0 4 2 6 0" />
    </>
  ),
  'more': <>
    <circle
      cx="5"
      cy="12"
      r="1"
    />
    <circle
      cx="12"
      cy="12"
      r="1"
    />
    <circle
      cx="19"
      cy="12"
      r="1"
    />
  </>,
  'rain': <>
    <path d="M20 15.5A4.5 4.5 0 0 0 18 7a6 6 0 0 0-11.5-1A5 5 0 0 0 5 16" />
    <path d="m8 15-1 4m6-4-1 4m6-4-1 4" />
  </>,
  'route': <>
    <circle
      cx="6"
      cy="6"
      r="3"
    />
    <circle
      cx="18"
      cy="18"
      r="3"
    />
    <path d="M9 6h7a4 4 0 0 1 0 8H8a4 4 0 0 0 0 8m1-8h2" />
  </>,
  'navigation': <>
    <path d="m3 11 18-8-8 18-2-8-8-2Z" />
  </>,
  'arrow-down': <>
    <path d="M12 4v16m-6-6 6 6 6-6" />
  </>,
  'arrow-up-right': <>
    <path d="M7 17 17 7M7 7h10v10" />
  </>,
  'map': <>
    <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" />
    <path d="M9 3v15m6-12v15" />
  </>,
  'map-pin': <>
    <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" />
    <circle
      cx="12"
      cy="10"
      r="3"
    />
  </>,
  'bookmark': <>
    <path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </>,
  'bell': (
    <>
      <path d="M10.268 21a2 2 0 0 0 3.464 0" />
      <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
    </>
  ),
  'settings': <>
    <path
      d="M9.7 4.3 10.3 2h3.4l.6 2.3 2 .9 2.1-.7 1.7 2.9-1.5 1.7.2 2.2 1.8 1.6-1.7 2.9-2.3-.4-1.9 1.3-.6 2.3h-3.4l-.6-2.3-2-.9-2.1.7-1.7-2.9L6 12l-.2-2.2L4 8.2l1.7-2.9 2.3.4Z"
    />
    <circle
      cx="12"
      cy="10.8"
      r="2.8"
    />
  </>,
  'search': <>
    <circle
      cx="10.5"
      cy="10.5"
      r="6.5"
    />
    <path d="m16 16 5 5" />
  </>,
  'filter': <>
    <path d="M4 7h16M7 12h10m-7 5h4" />
  </>,
  'shield': <>
    <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" />
    <path d="m9 12 2 2 4-4" />
  </>,
  'info': <>
    <circle
      cx="12"
      cy="12"
      r="9"
    />
    <path d="M12 11v6m0-10h.01" />
  </>,
  'locate': <>
    <circle
      cx="12"
      cy="12"
      r="8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    />
    <circle
      cx="12"
      cy="12"
      r="3.6"
      fill="currentColor"
      stroke="none"
    />
    <path
      d="M12 2v2m0 16v2M2 12h2m16 0h2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </>,
  'plus': <>
    <path d="M12 5v14M5 12h14" />
  </>,
  'minus': <>
    <path d="M5 12h14" />
  </>,
  'expand': <>
    <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />
  </>,
  'layers': <>
    <path 
      d="m12 3 10 5-10 5L2 8Z"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <path
      d="m2 14 10 5 10-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </>,
  'flask': <>
    <path d="M9 3h6m-5 0v6L4 19a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2L14 9V3M8 13h8" />
  </>,
  'list': <>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </>,
  'x': <>
    <path d="m6 6 12 12M6 18 18 6" />
  </>,
  'waves': <>
    <path
      d="M2 6c2-2 4-2 6 0s4 2 6 0 4-2 8 0M2 12c2-2 4-2 6 0s4 2 6 0 4-2 8 0M2 18c2-2 4-2 6 0s4 2 6 0 4-2 8 0"
    />
  </>,
  'triangle': <>
    <path d="m10.3 3.5-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4m0 4h.01" />
  </>,
  'wifi-off': <>
    <path
      d="m2 2 20 20M8.5 8.5A13 13 0 0 0 2 12m3 3a9 9 0 0 1 7-3m-4 6a5 5 0 0 1 8 0M12 21h.01M10 4a17 17 0 0 1 12 5m-6 2a13 13 0 0 1 3 2"
    />
  </>,
  'wifi': <>
    <path d="M2 9a17 17 0 0 1 20 0M5 13a11 11 0 0 1 14 0m-11 4a5 5 0 0 1 8 0M12 21h.01" />
  </>,
  'clock': <>
    <circle
      cx="12"
      cy="12"
      r="9"
    />
    <path d="M12 7v5l3 2" />
  </>,
  'refresh': <>
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M8 16H3v5" />
  </>,
  'arrow': <>
    <path d="M5 12h14m-5-5 5 5-5 5" />
  </>,
  'chevron': <>
    <path d="m9 5 7 7-7 7" />
  </>,
  'download': <>
    <path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" />
  </>,
  'check': <>
    <path d="m5 12 4 4L19 6" />
  </>,
  'external': <>
    <path d="M15 3h6v6m0-6L10 14m-1-9H4v16h16v-5" />
  </>,
  'copy': <>
    <rect
      x="8"
      y="8"
      width="12"
      height="13"
      rx="2"
    />
    <path d="M16 8V3H3v13h5" />
  </>,
  'sun': <>
    <circle
      cx="12"
      cy="12"
      r="4"
    />
    <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1" />
  </>,
  'moon': <>
    <path d="M20.9 13A9 9 0 0 1 11 3a9 9 0 1 0 9.9 10Z" />
  </>,
  'laptop': <>
    <rect
      x="4"
      y="3"
      width="16"
      height="13"
      rx="2"
    />
    <path d="M2 20h20l-2-4H4Z" />
  </>,
  'lock': <>
    <rect
      x="4"
      y="10"
      width="16"
      height="11"
      rx="2"
    />
    <path d="M8 10V6a4 4 0 0 1 8 0v4" />
  </>,
  'logout': <>
    <path d="M9 21H3V3h6m6 5 4 4-4 4m-8-4h12" />
  </>,
  'edit': <>
    <path d="m15 4 5 5M4 20l4-1L21 6a2 2 0 0 0-5-3L3 16l-1 5Z" />
  </>,
  'play': <>
    <path d="m8 4 12 8-12 8Z" />
  </>,
  'pause': <>
    <path d="M7 4v16M17 4v16" />
  </>,
  'radio': <>
    <circle
      cx="12"
      cy="12"
      r="2"
    />
    <path d="M7 7a7 7 0 0 0 0 10m10-10a7 7 0 0 1 0 10M4 4a11 11 0 0 0 0 16M20 4a11 11 0 0 1 0 16" />
  </>,
  'server': <>
    <rect
      x="3"
      y="3"
      width="18"
      height="7"
      rx="2"
    />
    <rect
      x="3"
      y="14"
      width="18"
      height="7"
      rx="2"
    />
    <path d="M7 6.5h.01M7 17.5h.01" />
  </>,
  'trash': <>
    <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
  </>,
};

export type IconName = keyof typeof paths;

export function Icon({ name, className = '', ...props }: {
  name: IconName;
} & SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={'icon ' + className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
