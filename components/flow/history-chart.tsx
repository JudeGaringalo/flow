'use client';

import { useFlow } from '@/hooks/use-flow';

/** Draw only recorded threshold events. Never fill gaps with synthetic points. */
export function HistoryChart() {
  const f = useFlow(), node = f.selected;
  if (!node)
    return null;

  const end = f.now, start = end - f.range * 3600000;
  const all = (f.histories[node.id] || []).filter(e => Date.parse(e.recorded_at) <= end);
  const before = all.filter(e => Date.parse(e.recorded_at) < start).at(-1);
  const inRange = all.filter(e => Date.parse(e.recorded_at) >= start);
  const events = before
    ? [
      {
        ...before,
        recorded_at: new Date(start).toISOString()
      },
      ...inRange
    ]
    : inRange;
  if (f.historyError)
    return (
      <div
        className="chart-empty"
        role="status"
      >
        {f.historyError}
      </div>
    );

  if (!events.length)
    return (
      <div className="chart-empty">
        No recorded transitions in this time range.
      </div>
    );

  const x = (t: number) => 28 + (t - start) / (end - start) * 265,
    y = (v: number) => 119 - v * 30;
  let path = '', last: number | null = null;
  for (const event of events) {
    const t = x(Date.parse(event.recorded_at));
    if (event.level === null || event.quality !== 'valid') {
      last = null;
      continue;
    }

    path += last === null ? `M${t},${y(event.level)} ` : `H${t} V${y(event.level)} `;
    last = event.level;
  }

  const lastEvent = events.at(-1);
  const lastSeen = node.last_seen ? Date.parse(node.last_seen) : NaN;
  if (last !== null && lastEvent && Number.isFinite(lastSeen)
    && lastSeen > Date.parse(lastEvent.recorded_at))
    path += `H${x(Math.min(end, lastSeen))}`;

  return (
    <svg
      className="trend-chart"
      viewBox="0 0 340 155"
      role="img"
      aria-label="Recorded threshold transitions from Level 0 through Level 3. Gaps do not confirm conditions."
    >
      {[0, 1, 2, 3].map(
        v => (
          <g key={v}>
            <line
              className="chart-grid"
              x1="28"
              x2="293"
              y1={y(v)}
              y2={y(v)}
            />
            <text
              x="0"
              y={y(v) + 3}
            >
              L
              {v}
            </text>
          </g>

        ))}
      {[0, 1, 2, 3, 4].map(
        v => <line
          key={v}
          className="chart-grid"
          x1={28 + v * 66.25}
          x2={28 + v * 66.25}
          y1="20"
          y2="119"
        />
      )}
      <path
        className="chart-observed"
        d={path}
      />
      <text
        x="28"
        y="143"
      >
        {f.range === 24 ? '24h ago' : f.range === 168 ? '7d ago' : '30d ago'}
      </text>
      <text
        x="293"
        y="143"
        textAnchor="end"
      >
        Now
      </text>
    </svg>
  );
}
