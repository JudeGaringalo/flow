'use client';

import { useId, useMemo, useState } from 'react';
import { OBSERVATION_GAP_MS, type ObservationSpan } from '@/hooks/use-observation-history';

const ranges = [
  { label: '24H', duration: 86_400_000 },
  { label: '7D', duration: 7 * 86_400_000 },
  { label: '30D', duration: 30 * 86_400_000 },
] as const;
const plot = { left: 30, right: 278, top: 16, bottom: 134 };
const thresholds = [
  { level: 3, name: 'Warning', color: '#d92f38' },
  { level: 2, name: 'Watch', color: '#c29a00' },
  { level: 1, name: 'Advisory', color: '#147fc8' },
];

export function chartTimeWindow(spans: ObservationSpan[], now: number, duration: number) {
  const cutoff = now - duration;
  const first = spans.find(span => span.end >= cutoff && span.start <= now);
  if (!first) return { from: cutoff, to: now, partial: false };
  const firstAt = Math.max(cutoff, first.start);
  const padding = Math.max(10_000, Math.min(300_000, (now - firstAt) * 0.06));
  const from = Math.max(cutoff, Math.min(firstAt - padding, now - 60_000));
  return { from, to: now, partial: from > cutoff };
}

export function chartReadings(spans: ObservationSpan[], from: number, to: number) {
  const visible = spans.filter(span => span.end >= from && span.start <= to);
  const latestValid = visible.findLastIndex(span => span.level !== null);
  const samples: { at: number; level: ObservationSpan['level']; connected: boolean }[] = [];
  let previous: ObservationSpan | undefined;
  visible.forEach((span, index) => {
    const at = span.start >= from ? span.start : span.end;
    if (at > to) return;
    const connected = span.level !== null && previous !== undefined
      && span.start - previous.end <= OBSERVATION_GAP_MS;
    samples.push({ at, level: span.level, connected });
    if (index === latestValid && span.end > at && span.end <= to) {
      samples.push({ at: span.end, level: span.level, connected: true });
    }
    previous = span.level === null ? undefined : span;
  });

  const paths: string[] = [];
  const points: { x: number; y: number; level: number; at: number }[] = [];
  const y = (level: number) => plot.bottom - level / 3 * (plot.bottom - plot.top);
  let path = '';
  samples.forEach((sample, index) => {
    if (sample.level === null) {
      if (path) paths.push(path);
      path = '';
      return;
    }
    const x = samples.length === 1 ? (plot.left + plot.right) / 2
      : plot.left + index / (samples.length - 1) * (plot.right - plot.left);
    const point = { x, y: y(sample.level), level: sample.level, at: sample.at };
    points.push(point);
    const coordinate = `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
    if (!sample.connected) {
      if (path) paths.push(path);
      path = `M${coordinate}`;
    } else {
      path += `L${coordinate}`;
    }
  });
  if (path) paths.push(path);
  let ticks: typeof points = [];
  for (let count = Math.min(4, points.length); count > 0; count--) {
    ticks = Array.from({ length: count }, (_, index) =>
      points[count === 1 ? points.length - 1
        : Math.round(index / (count - 1) * (points.length - 1))]);
    if (ticks.every((tick, index) => index === 0 || tick.x - ticks[index - 1].x
      >= (index === 1 || index === count - 1 ? 90 : 64))) break;
  }
  return { paths, points, ticks, last: points.at(-1) ?? null };
}

export function RecentStatusChart({ spans, now, recorded, loading, error, onRetry }: {
  spans: ObservationSpan[];
  now: number;
  recorded: boolean;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const [range, setRange] = useState(0);
  const id = useId();
  const { from, to } = useMemo(
    () => chartTimeWindow(spans, now, ranges[range].duration), [spans, now, range]);
  const readings = useMemo(() => chartReadings(spans, from, to), [spans, from, to]);
  const showDate = to - from > 86_400_000;
  const showSeconds = readings.ticks.length === 1 || readings.ticks.some((tick, index) =>
    index > 0 && tick.at - readings.ticks[index - 1].at < 60_000);
  const time = useMemo(() => new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', hour12: true,
    ...(showSeconds ? { second: '2-digit' as const } : {}),
  }), [showSeconds]);
  const date = useMemo(() => new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', month: 'short', day: 'numeric',
  }), []);
  const tickLabel = (at: number) => time.format(at).replace(/\s+(AM|PM)$/, '$1');
  const singleReading = readings.points.length === 1;
  const lastColor = readings.last?.level === 3 ? '#d92f38'
    : readings.last?.level === 2 ? '#ffca24' : readings.last?.level === 1 ? '#147fc8' : '#758491';
  return (
    <section className="recent-chart detail-history" aria-labelledby={`${id}-heading`}>
      <div className="section-line">
        <h3 id={`${id}-heading`}>Recent status</h3>
        <div className="segmented history-ranges" role="tablist" aria-label="Recent status range">
          {ranges.map((option, index) => (
            <button key={option.label} type="button" role="tab"
              className={index === range ? 'active' : ''}
              id={`${id}-range-${index}`} aria-selected={index === range}
              aria-controls={`${id}-chart`} tabIndex={index === range ? 0 : -1}
              onClick={() => setRange(index)} onKeyDown={event => {
                let next: number | undefined;
                if (event.key === 'ArrowRight') next = (index + 1) % ranges.length;
                if (event.key === 'ArrowLeft') next = (index + ranges.length - 1) % ranges.length;
                if (event.key === 'Home') next = 0;
                if (event.key === 'End') next = ranges.length - 1;
                if (next === undefined) return;
                event.preventDefault();
                setRange(next);
                const buttons = event.currentTarget.parentElement?.querySelectorAll('button');
                buttons?.[next]?.focus();
              }}>{option.label}</button>
          ))}
        </div>
      </div>
      <div id={`${id}-chart`} role="tabpanel" aria-labelledby={`${id}-range-${range}`} aria-busy={loading}>
        <svg className="trend-chart" viewBox="0 0 354 170" role="img"
          aria-labelledby={`${id}-title ${id}-description`}>
          <title id={`${id}-title`}>{`${ranges[range].label} sensor status history`}</title>
          <desc id={`${id}-description`}>Reported threshold levels zero to three. Advisory is level one,
            Watch is level two, and Warning is level three. Straight lines connect recorded status
            changes and the latest reading. Points are evenly spaced by recording order; labels show
            actual times in Manila. Gaps indicate missing readings.</desc>
          <defs><clipPath id={`${id}-plot`}><rect x={plot.left} y={plot.top - 6}
            width={plot.right - plot.left} height={plot.bottom - plot.top + 12} /></clipPath></defs>
          {[0, 1, 2, 3].map(level => {
            const y = plot.bottom - level / 3 * (plot.bottom - plot.top);
            return <g key={level}>
              <line className="chart-grid" x1={plot.left} x2={plot.right} y1={y} y2={y} />
              <text x={plot.left - 12} y={y + 3} textAnchor="end">{level}</text>
            </g>;
          })}
          {readings.ticks.map((tick, index) => {
            const anchor = readings.ticks.length === 1 ? 'middle' : index === 0 ? 'start'
              : index === readings.ticks.length - 1 ? 'end' : 'middle';
            return <g key={index}>
              <line className="chart-grid" x1={tick.x} x2={tick.x} y1={plot.top} y2={plot.bottom} />
              <text x={tick.x} y={showDate ? 149 : 153} textAnchor={anchor}>
                {showDate ? <><tspan x={tick.x}>{date.format(tick.at)}</tspan>
                  <tspan x={tick.x} dy="13">{tickLabel(tick.at)}</tspan></> : tickLabel(tick.at)}
              </text>
            </g>;
          })}
          {thresholds.map(threshold => {
            const y = plot.bottom - threshold.level / 3 * (plot.bottom - plot.top);
            return <g key={threshold.level}>
              <line x1={plot.left} x2={plot.right} y1={y} y2={y}
                stroke={threshold.color} strokeWidth="1" />
              <text className="threshold-name" x={plot.right + 8} y={y + 2}
                style={{ fill: threshold.color }}>{threshold.name}</text>
              <text x={plot.right + 8} y={y + 14}>Level {threshold.level}</text>
            </g>;
          })}
          <g clipPath={`url(#${id}-plot)`}>
            {readings.paths.map((path, index) => <path className="chart-observed" key={index} d={path} />)}
            {readings.points.slice(0, -1).map((point, index) => <circle key={index}
              cx={point.x} cy={point.y} r="2.5" fill="#087cf4" stroke="#fff" strokeWidth="1">
              <title>{`Recorded level ${point.level}, ${new Date(point.at)
                .toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}`}</title>
            </circle>)}
          </g>
          {readings.last ? <circle cx={readings.last.x} cy={readings.last.y} r="5"
            fill={lastColor} stroke="#fff" strokeWidth="2">
            <title>{`Last valid reading: level ${readings.last.level}, ${new Date(readings.last.at)
              .toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}`}</title>
          </circle> : <text className="chart-empty-message" x="154" y="89" textAnchor="middle">
            Waiting for a sensor reading
          </text>}
        </svg>
      </div>
      <p className="chart-caption" role="status">
        {loading ? 'Loading recorded history…' : error
          ? 'Recorded history is unavailable. Latest status stays live.'
          : recorded ? 'Recorded sensor history · Times in Manila.' : 'Waiting for recorded history.'}
        {error && <>{' '}<button className="text-btn" type="button" onClick={onRetry}>Retry</button></>}
        {!loading && !error && readings.last && <><br />
          {singleReading ? 'One reading so far; the line grows with new readings.'
            : 'Changes are evenly spaced; labels show actual times.'}
        </>}
      </p>
    </section>
  );
}
