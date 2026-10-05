import { levelFromProbes, nodeStatus } from './core';
import type { FlowNode, Level, StatusKey } from './types';

export interface IntelligenceSpan { start: number; end: number; level: Level | null }
export type ChangeDirection = 'rising' | 'falling' | 'unknown';
export interface TimingEstimate {
  kind: 'estimate' | 'reached' | 'insufficient' | 'unavailable';
  earliestAt: number | null;
  latestAt: number | null;
  basis: 'pace' | 'history' | null;
  samples: number;
  detail: string;
}
export interface IntelligenceAnalysis {
  level: Level | null;
  status: StatusKey;
  direction: ChangeDirection;
  changedAt: number | null;
  paceMs: number | null;
  critical: TimingEstimate;
  recede: TimingEstimate;
}
export interface IntelligenceResponse {
  nodeId: string;
  stateKey: string;
  summary: string;
  source: 'gemini' | 'sensor';
  availability: 'ready' | 'not-configured' | 'busy' | 'temporarily-unavailable' | 'sensor-unavailable';
  generatedAt: number;
  retryAfterSeconds: number | null;
}

const GAP_MS = 120_000;
const MIN_PACE_MS = 30_000;
const MAX_PROJECTION_MS = 12 * 3_600_000;

export function intelligenceStateKey(node: FlowNode, status: StatusKey) {
  return JSON.stringify([node.id, node.state_version, status, node.current_level,
    node.quality, node.probes, node.name, node.area, node.latitude, node.longitude]);
}

export function sensorSummary(status: StatusKey) {
  switch (status) {
    case 'warning': return 'The highest sensor threshold is reached at this monitoring point. Avoid floodwater and check official local instructions. Conditions away from the sensor may differ.';
    case 'watch': return 'The second water threshold is reached here. Stay alert for changes and check local advisories before traveling near this monitoring point.';
    case 'advisory': return 'The first water threshold is reached here. Monitor updates and use caution around low-lying roads near this monitoring point.';
    case 'below': return 'Water is below the first sensor threshold. This does not confirm that nearby roads are dry or safe.';
    case 'fault': return 'The latest probe combination could not be verified. The water level is unconfirmed until a valid reading arrives.';
    default: return 'A recent valid sensor reading is unavailable. FLOW cannot confirm the current water level here. Check official local updates.';
  }
}

function emptyTiming(detail: string, kind: TimingEstimate['kind'] = 'insufficient'): TimingEstimate {
  return { kind, earliestAt: null, latestAt: null, basis: null, samples: 0, detail };
}

function connected(a: IntelligenceSpan | undefined, b: IntelligenceSpan | undefined) {
  return !!a && !!b && a.level !== null && b.level !== null
    && b.start > a.end && b.start - a.end <= GAP_MS;
}

function directionAt(spans: IntelligenceSpan[], index: number): ChangeDirection {
  const a = spans[index - 1], b = spans[index];
  if (!connected(a, b)) return 'unknown';
  const delta = b.level! - a.level!;
  return delta > 0 ? 'rising' : delta < 0 ? 'falling' : 'unknown';
}

function paceAt(spans: IntelligenceSpan[], index: number): number | null {
  const a = spans[index - 2], b = spans[index - 1], c = spans[index];
  if (!connected(a, b) || !connected(b, c)) return null;
  const rising = a.level === 0 && b.level === 1 && c.level === 2;
  const falling = a.level === 3 && b.level === 2 && c.level === 1;
  if (!rising && !falling) return null;
  const pace = c.start - b.start;
  return pace >= MIN_PACE_MS && pace <= MAX_PROJECTION_MS ? pace : null;
}

function historicalTiming(spans: IntelligenceSpan[], currentIndex: number, target: 0 | 3,
  direction: ChangeDirection, pace: number | null): TimingEstimate | null {
  const current = spans[currentIndex];
  const previous = spans[currentIndex - 1];
  if (direction === 'unknown' || current.level === null || !previous
    || previous.level === null || Math.abs(current.level - previous.level) !== 1) return null;
  const durations: number[] = [];
  for (let i = 1; i < currentIndex; i++) {
    if (spans[i].level !== current.level || spans[i - 1].level !== previous.level
      || directionAt(spans, i) !== direction) continue;
    for (let j = i + 1; j < currentIndex; j++) {
      if (!connected(spans[j - 1], spans[j])
        || Math.abs(spans[j].level! - spans[j - 1].level!) !== 1) break;
      if (target === 3 && spans[j].level! < spans[j - 1].level!) break;
      if (target === 0 && direction === 'falling' && spans[j].level! > spans[j - 1].level!) break;
      if (spans[j].level === target) {
        let duration = spans[j].start - spans[i].start;
        if (target === 3 && pace !== null) {
          const previousPace = paceAt(spans, i);
          if (previousPace === null) break;
          duration *= pace / previousPace;
        }
        if (duration >= MIN_PACE_MS && duration <= MAX_PROJECTION_MS) durations.push(duration);
        i = j;
        break;
      }
      if (spans[j].start - spans[i].start > MAX_PROJECTION_MS) break;
    }
  }
  if (durations.length < 3) return null;
  return {
    kind: 'estimate', earliestAt: current.start + Math.min(...durations),
    latestAt: current.start + Math.max(...durations), basis: 'history', samples: durations.length,
    detail: target === 3
      ? `Low-confidence range from ${durations.length} previous rises at this sensor${pace === null ? '' : ', adjusted to the latest threshold timing'}. Conditions can change.`
      : `Low-confidence range from ${durations.length} previous returns below the first threshold at this sensor. Past events may differ.`,
  };
}

export function analyzeIntelligence(node: FlowNode, spans: IntelligenceSpan[], now: number,
  offline = false): IntelligenceAnalysis {
  let status = nodeStatus(node, now, offline).key;
  const derived = levelFromProbes(node.probes);
  if (status !== 'unavailable' && derived !== node.current_level) status = 'fault';
  const valid = status !== 'unavailable' && status !== 'fault';
  const level = valid ? derived : null;
  const result: IntelligenceAnalysis = {
    level, status, direction: 'unknown', changedAt: null, paceMs: null,
    critical: emptyTiming('More recorded rising thresholds are needed to estimate time to Level 3.'),
    recede: emptyTiming('Falling readings or at least three completed past events are needed to estimate receding time.'),
  };
  if (!valid) {
    result.critical = result.recede = emptyTiming('Timing estimates need a recent, valid sensor reading.', 'unavailable');
    return result;
  }
  if (level === 3) result.critical = emptyTiming('Level 3 is the highest sensor threshold, not a measurement of maximum flood depth.', 'reached');
  if (level === 0) result.recede = emptyTiming('Below the first threshold does not mean the area is dry or safe.', 'reached');
  const index = spans.length - 1;
  const latest = spans[index];
  if (!latest || latest.level !== level || now - latest.end > GAP_MS || latest.end > now + 30_000
    || latest.end < Date.parse(node.last_seen || '') - GAP_MS) return result;
  result.direction = directionAt(spans, index);
  result.changedAt = result.direction === 'unknown' ? null : latest.start;
  result.paceMs = paceAt(spans, index);
  if (level !== 3 && level !== 0 && result.direction === 'rising') {
    const historical = historicalTiming(spans, index, 3, result.direction, result.paceMs);
    if (historical) result.critical = historical;
    else if (level === 2 && result.paceMs !== null) {
      result.critical = {
        kind: 'estimate', earliestAt: latest.start + result.paceMs * .5,
        latestAt: latest.start + result.paceMs * 1.5, basis: 'pace', samples: 1,
        detail: 'Rough scenario using 0.5–1.5× the observed Level 1→2 interval for Level 2→3. Assumes similar threshold timing; not a validated forecast.',
      };
    }
  }
  if (level !== 0) {
    const historical = historicalTiming(spans, index, 0, result.direction, null);
    if (historical) result.recede = historical;
    else if (level === 1 && result.direction === 'falling' && result.paceMs !== null) {
      result.recede = {
        kind: 'estimate', earliestAt: latest.start + result.paceMs * .5,
        latestAt: latest.start + result.paceMs * 1.5, basis: 'pace', samples: 1,
        detail: 'Rough scenario using 0.5–1.5× the observed Level 2→1 interval to fall below Level 1. Assumes similar threshold timing; not an all-clear.',
      };
    }
  }
  return result;
}

export function timingPresentation(estimate: TimingEstimate, target: 0 | 3, now: number) {
  if (estimate.kind === 'reached') return { value: target === 3 ? 'Level 3 reached' : 'Below first threshold', detail: estimate.detail };
  if (estimate.kind !== 'estimate' || estimate.earliestAt === null || estimate.latestAt === null)
    return { value: estimate.kind === 'unavailable' ? 'Reading unavailable' : 'Not enough history', detail: estimate.detail };
  if (now >= estimate.latestAt) return { value: 'Estimate expired',
    detail: 'The estimated window passed without a confirmed threshold change. Waiting for new evidence.' };
  const min = Math.max(0, Math.ceil((estimate.earliestAt - now) / 60_000));
  const max = Math.max(1, Math.ceil((estimate.latestAt - now) / 60_000));
  const value = min <= 0 ? `Within ~${max} min` : min === max ? `~${max} min` : `~${min}–${max} min`;
  return { value, detail: estimate.detail };
}
