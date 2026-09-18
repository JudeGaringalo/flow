import type { FlowNode, NodeStatus, Observation, Probes, StatusKey, Level } from './types';

export const STATUS: Record<StatusKey, Omit<NodeStatus, 'age'>> = {
  below: {
    key: 'below',
    label: 'Below first threshold',
    short: 'Below threshold',
    color: '#648cad',
    level: 0
  },
  advisory: {
    key: 'advisory',
    label: 'Flood Advisory',
    short: 'Advisory',
    color: '#12b969',
    level: 1
  },
  watch: {
    key: 'watch',
    label: 'Flood Watch',
    short: 'Watch',
    color: '#ffca24',
    level: 2
  },
  warning: {
    key: 'warning',
    label: 'Flood Warning',
    short: 'Warning',
    color: '#ff8427',
    level: 3
  },
  unavailable: {
    key: 'unavailable',
    label: 'Data unavailable',
    short: 'Unavailable',
    color: '#9da9b2',
    level: null
  },
  fault: {
    key: 'fault',
    label: 'Check sensor',
    short: 'Sensor fault',
    color: '#9a68c4',
    level: null
  },
};

export function levelFromProbes(p: unknown): Level | null {
  if (!Array.isArray(p) || p.length !== 3 || p.some(x => typeof x !== 'boolean'))
    return null;

  const [a, b, c] = p;
  if ((b && !a) || (c && (!a || !b)))
    return null;

  return c ? 3 : b ? 2 : a ? 1 : 0;
}

export function probesFor(level: Level): Probes {
  return [level >= 1, level >= 2, level >= 3];
}

export function nodeStatus(node: FlowNode, now: number, offline = false): NodeStatus {
  const t = node.last_seen ? Date.parse(node.last_seen) : NaN;
  const age = (now - t) / 1000;
  if (offline || !Number.isFinite(t) || age > 120 || age < -30)
    return {
      ...STATUS.unavailable,
      age,
      connectionLost: offline
    };

  const level = levelFromProbes(node.probes);
  if (node.quality !== 'valid' || level === null)
    return {
      ...STATUS.fault,
      age
    };

  return {
    ...STATUS[(['below', 'advisory', 'watch', 'warning'] as const)[level]],
    age
  };
}

export function ageText(iso: string | null, now = Date.now()) {
  if (!iso || !Number.isFinite(Date.parse(iso)))
    return 'No reading yet';

  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 5
    ? 'just now'
    : s < 60
      ? `${s}s ago`
      : s < 3600
        ? `${Math.floor(s / 60)}m ago`
        : s < 86400
          ? `${Math.floor(s / 3600)}h ago`
          : `${Math.floor(s / 86400)}d ago`;
}

export const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-PH', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Manila'
});

export function distance(
  a: Pick<FlowNode, 'latitude' | 'longitude'>,
  b: Pick<FlowNode, 'latitude' | 'longitude'>
) {
  const rad = (n: number) => n * Math.PI / 180,
    dlat = rad(b.latitude - a.latitude),
    dlon = rad(b.longitude - a.longitude);
  const t = Math.sin(dlat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dlon / 2) ** 2;
  const v = Math.max(0, Math.min(1, t));
  return 6371000 * 2 * Math.atan2(Math.sqrt(v), Math.sqrt(1 - v));
}

export const distanceText = (m: number) => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`;

export function summaryFor(node: FlowNode, events: Observation[], nearby: FlowNode[], now: number) {
  const s = nodeStatus(node, now);
  if (s.key === 'unavailable')
    return 'This node has no current reading. Its last observation cannot confirm conditions now. Missing data does not mean low water.';

  if (s.key === 'fault')
    return 'The probe combination is inconsistent. A current flood level cannot be confirmed. Check the sensor connections before relying on its status.';

  const valid = events.filter(e => e.quality === 'valid' && e.level !== null)
    .sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));
  const last = valid.at(-1), prev = valid.at(-2);
  let text = `This monitoring point is reporting ${s.label}. `;
  if (last?.level != null && prev?.level != null && last.level !== prev.level)
    text += `Its latest recorded threshold transition is ${last.level > prev.level ? 'upward' : 'downward'}. `;
  else
    text += 'No newer threshold transition is recorded. ';

  const other = nearby.find(n => nodeStatus(n, now).level !== null);
  if (other)
    text += `${other.name}, approximately ${distanceText(distance(node, other))} away, reports ${nodeStatus(other, now).label} at its own monitoring point. `;

  text += 'Conditions between monitoring points and road passability are not established.';
  return text;
}

export function shouldAlert(
  previous: FlowNode | undefined,
  node: FlowNode,
  min: number,
  now = Date.now()
) {
  const s = nodeStatus(node, now);
  const old = previous ? levelFromProbes(previous.probes) : null;
  return s.level !== null && s.level >= min && (old === null || s.level > old);
}

export function csvCell(value: unknown) {
  let s = String(value ?? '');
  if (/^[=+@\t\r-]/.test(s))
    s = "'" + s;

  return '"' + s.replace(/"/g, '""') + '"';
}

export function normalizeNode(raw: Record<string, unknown>): FlowNode {
  const validProbes = Array.isArray(raw.probes) && raw.probes.length === 3
    && raw.probes.every(p => typeof p === 'boolean');
  return {
    id: String(raw.id),
    name: String(raw.name || raw.id),
    area: String(raw.area || ''),
    latitude: Number(raw.latitude),
    longitude: Number(raw.longitude),
    probes: (validProbes ? raw.probes : [false, false, false]) as Probes,
    current_level: typeof raw.current_level === 'number' ? raw.current_level as Level : null,
    quality: (!validProbes
      ? 'unknown'
      : raw.quality === 'valid'
        ? 'valid'
        : raw.quality === 'fault' ? 'fault' : 'unknown'),
    last_seen: typeof raw.last_seen === 'string' ? raw.last_seen : null,
    state_version: Number(raw.state_version || 0),
    rssi: typeof raw.rssi === 'number' ? raw.rssi : null,
    firmware: typeof raw.firmware === 'string' ? raw.firmware : null,
    is_public: raw.is_public === true
  };
}
