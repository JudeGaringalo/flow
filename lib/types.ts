export type Theme = 'light' | 'dark';

export type Basemap = 'standard' | 'terrain' | 'satellite' | 'dark';

export type Level = 0 | 1 | 2 | 3;

export type Probes = [
  boolean,
  boolean,
  boolean
];

export type Quality = 'valid' | 'fault' | 'unknown';

export type StatusKey = 'below' | 'advisory' | 'watch' | 'warning' | 'unavailable' | 'fault';

export type Connection = 'unconfigured' | 'loading' | 'live' | 'error';

export interface FlowNode {
  id: string;
  name: string;
  area: string;
  latitude: number;
  longitude: number;
  probes: Probes;
  current_level: Level | null;
  quality: Quality;
  last_seen: string | null;
  state_version: number;
  rssi: number | null;
  firmware: string | null;
  is_public: boolean;
}

export interface Observation {
  id: string | number;
  node_id: string;
  level: Level | null;
  quality: Quality;
  probes: Probes;
  recorded_at: string;
}

export interface NodeStatus {
  key: StatusKey;
  label: string;
  short: string;
  color: string;
  level: number | null;
  age: number;
  connectionLost?: boolean;
}

export interface Follow {
  min_level: 1 | 2 | 3;
}

export interface Activity {
  id: string;
  node_id: string;
  name: string;
  text: string;
  at: string;
  read: boolean;
}

export interface Summary {
  text: string;
  provider: 'gemini' | 'fallback';
  version: number;
  expires: number;
}

export interface NodeInput {
  id: string;
  name: string;
  area: string;
  latitude: number;
  longitude: number;
}

export interface MapHandle {
  focus: (id: string) => void;
  fit: () => void;
  zoomBy: (delta: number) => void;
  locate: (latitude: number, longitude: number, accuracy: number) => void;
}

export type ModalKind = 'menu'
  | 'layers'
  | 'settings'
  | 'about'
  | 'install'
  | 'directions'
  | 'forecast'
  | 'route'
  | 'alerts'
  | 'follow'
  | 'ai-info'
  | 'admin'
  | 'node-form'
  | 'token'
  | 'wifi';
