'use client';

import { useFlow } from '@/hooks/use-flow';
import type { Observation } from '@/lib/types';

const LEFT = 27;
const RIGHT = 272;
const TOP = 15;
const BOTTOM = 129;

const THRESHOLDS = [
  { level: 1, label: 'Advisory', color: '#329b70' },
  { level: 2, label: 'Watch', color: '#bc9525' },
  { level: 3, label: 'Warning', color: '#ec7c36' },
];

/** Show measured threshold steps. No sample depths or extrapolated forecast line. */
export function HistoryChart() {
  const flow = useFlow();
  const node = flow.selected;
  if (!node) return null;

  const end = flow.now;
  const start = end - flow.range * 3_600_000;
  const all = (flow.histories[node.id] || [])
    .filter((event) => Number.isFinite(Date.parse(event.recorded_at)))
    .filter((event) => Date.parse(event.recorded_at) <= end)
    .slice()
    .sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));
  const previous = all.filter((event) => Date.parse(event.recorded_at) < start).at(-1);
  const visible = all.filter((event) => Date.parse(event.recorded_at) >= start);
  const events: Observation[] = previous
    ? [{ ...previous, recorded_at: new Date(start).toISOString() }, ...visible]
    : visible;

  if (flow.historyError) {
    return <div className="chart-empty" role="status">{flow.historyError}</div>;
  }

  const x = (time: number) => LEFT + ((time - start) / (end - start)) * (RIGHT - LEFT);
  const y = (level: number) => BOTTOM - level * 34;
  let path = '';
  let last: Observation | null = null;

  for (const event of events) {
    if (event.level === null || event.quality !== 'valid') {
      last = null;
      continue;
    }
    const px = x(Date.parse(event.recorded_at));
    path += last
      ? `H${px.toFixed(2)} V${y(event.level)} `
      : `M${px.toFixed(2)},${y(event.level)} `;
    last = event;
  }

  const lastSeen = node.last_seen ? Date.parse(node.last_seen) : NaN;
  if (last && Number.isFinite(lastSeen) && lastSeen >= Date.parse(last.recorded_at)) {
    path += `H${x(Math.min(end, lastSeen)).toFixed(2)}`;
  }
  const lastPoint = last && last.level !== null ? {
    x: x(Date.parse(last.recorded_at)),
    y: y(last.level),
    color: THRESHOLDS.find((item) => item.level === last.level)?.color ?? '#467799',
  } : null;

  function axisLabel(time: number, index: number): string {
    if (index === 4) return 'Now';
    return new Date(time).toLocaleString('en-PH', flow.range === 24
      ? { hour: 'numeric', hour12: true, timeZone: 'Asia/Manila' }
      : { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });
  }

  return (
    <svg
      className="trend-chart"
      viewBox="0 0 360 164"
      role="img"
      aria-label={events.length
        ? 'Recorded threshold transitions from Level 0 to Level 3. This is not a depth measurement or forecast.'
        : 'No sensor history has been recorded in this period.'}
    >
      {[0, 1, 2, 3].map((level) => (
        <g key={level}>
          <line className="chart-grid" x1={LEFT} x2={RIGHT} y1={y(level)} y2={y(level)} />
          <text x="2" y={y(level) + 3}>{`L${level}`}</text>
        </g>
      ))}
      {[0, 1, 2, 3, 4].map((index) => {
        const px = LEFT + index * (RIGHT - LEFT) / 4;
        return (
          <g key={index}>
            <line className="chart-grid" x1={px} x2={px} y1={TOP} y2={BOTTOM} />
            <text
              x={px}
              y="151"
              textAnchor={index === 0 ? 'start' : index === 4 ? 'end' : 'middle'}
            >
              {axisLabel(start + index * (end - start) / 4, index)}
            </text>
          </g>
        );
      })}
      {THRESHOLDS.map(({ level, label, color }) => (
        <g key={level}>
          <line x1={LEFT} x2={RIGHT} y1={y(level)} y2={y(level)} stroke={color} strokeOpacity="0.65" />
          <text className="threshold-name" x="280" y={y(level) - 3} style={{ fill: color }}>{label}</text>
          <text x="280" y={y(level) + 9} style={{ fill: color }}>{`Level ${level}`}</text>
        </g>
      ))}
      {path && <path className="chart-observed" d={path} />}
      {lastPoint && (
        <circle
          cx={lastPoint.x}
          cy={lastPoint.y}
          r="4.7"
          fill={lastPoint.color}
          stroke="white"
          strokeWidth="1.5"
        />
      )}
      {!events.length && (
        <g>
          <rect x="47" y="63" width="204" height="28" rx="7" fill="var(--panel)" />
          <text className="chart-empty-message" x="149" y="81" textAnchor="middle">No recorded readings yet</text>
        </g>
      )}
    </svg>
  );
}
