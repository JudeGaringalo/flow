'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import Image from 'next/image';
import { useFlow } from '@/hooks/use-flow';
import { useSummary } from '@/hooks/use-summary';
import { config } from '@/lib/config';
import { clock, csvCell, STATUS, summaryFor, distanceText } from '@/lib/core';
import { Icon } from './icon';
import { HistoryChart } from './history-chart';

export function NodeDetails() {
  const f = useFlow(),
    node = f.selected,
    { result, loading, refresh } = useSummary();
  const content = useRef<HTMLDivElement>(null),
    drag = useRef<number | null>(null),
    didDrag = useRef(false);

  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
  }, [node?.id, f.tab]);
  if (!node)
    return null;

  const s = f.getStatus(node);
  const events = f.histories[node.id] || [],
    valid = events.filter(e => e.quality === 'valid' && e.level !== null),
    last = valid.at(-1),
    previous = valid.at(-2);
  const trend = s.level === null
    ? 'Unconfirmed'
    : last?.level != null && previous?.level != null && last.level > previous.level
      ? 'Rising'
      : last?.level != null && previous?.level != null && last.level < previous.level
        ? 'Receding'
        : 'No change';
  const style = { '--status-color': s.color } as CSSProperties;
  const exportCSV = () => {
    const rows: unknown[][] = [
      ['node_id', 'recorded_at', 'level', 'quality', 'L1_wet', 'L2_wet', 'L3_wet', 'data_mode'],
      ...events.map(e => [node.id, e.recorded_at, e.level, e.quality, ...e.probes, config.mode])
    ];
    const blob = new Blob([rows.map(r => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' }),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = node.id + '-observations.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section
      className={'details' + (f.expanded ? ' expanded' : '')}
      id="details"
      data-status={s.key}
      aria-label={`${node.name} monitoring details`}
      aria-labelledby="detail-location-title"
      style={style}
    >
      <button
        className="detail-handle"
        aria-label={f.expanded ? 'Collapse location details' : 'Expand location details'}
        aria-expanded={f.expanded}
        onPointerDown={
          e => {
            drag.current = e.clientY;
            didDrag.current = false;
            e.currentTarget.setPointerCapture(e.pointerId);
          }
        }
        onPointerMove={
          e => {
            if (drag.current !== null && Math.abs(e.clientY - drag.current) > 25)
              didDrag.current = true;
          }
        }
        onPointerCancel={() => { drag.current = null; didDrag.current = false; }}
        onPointerUp={
          e => {
            if (drag.current !== null && didDrag.current)
              f.setExpanded(e.clientY < drag.current);

            drag.current = null;
          }
        }
        onClick={
          () => {
            if (!didDrag.current)
              f.setExpanded(!f.expanded);

            didDrag.current = false;
          }
        }
      />
      <div className="detail-header">
        <div className="detail-title-row">
          <h2 id="detail-location-title">{node.name}</h2>
          <button
            className="icon-btn"
            aria-label="Close location details"
            onClick={f.closeDetails}
          >
            <Icon name="x" />
          </button>
        </div>
        <p className="detail-subtitle">{node.area}</p>
        <div className="detail-freshness">
          <span>
            Updated
            {' '}
            <strong>{f.age(node)}</strong>
          </span>
          <button className="detail-source-link" onClick={() => f.setTab('device')}>Sensor data</button>
        </div>
      </div>
      <div
        className="detail-content"
        ref={content}
      >
        {f.tab !== 'overview'
          && (
            <button
              className="back-overview"
              onClick={() => f.setTab('overview')}
            >
              <Icon name="arrow" />
              {' '}
              Back to overview
            </button>
          )}
        {f.tab === 'overview'
          ? (
            <>
              <div className="condition-and-trend">
                <div className="condition-card">
                  <div className="condition-icon">
                    <Icon name={s.key === 'unavailable'
                      ? 'wifi-off'
                      : s.key === 'fault' ? 'triangle' : 'flood'} />
                  </div>
                  <div className="condition-copy">
                    <h3>{s.label}</h3>
                    <p>
                      {s.level === null
                        ? 'Current level unconfirmed'
                        : s.level === 0 ? 'Below first threshold' : `Level ${s.level} reached`}
                    </p>
                  </div>
                </div>
                <div className="trend-indicator">
                  {(trend === 'Rising' || trend === 'Receding') && (
                    <Icon name={trend === 'Receding' ? 'arrow-down' : 'arrow-up-right'} />
                  )}
                  {trend}
                </div>
              </div>
              <div className="measure-cards">
                <div className="measure-card">
                  <Icon name="waves" />
                  <div>
                    <p>Water level</p>
                    <strong>
                      {s.level === null ? 'Unavailable' : `Level ${s.level} / 3`}
                    </strong>
                  </div>
                </div>
                <div className="measure-card">
                  <Icon name="rain" />
                  <div>
                    <p>Rainfall (1h)</p>
                    <strong className="unavailable-value" aria-label="Rainfall not measured">—</strong>
                    <small>Not connected</small>
                  </div>
                </div>
              </div>
              <p className="measure-disclaimer">
                Threshold sensing only. Depth and rainfall are not measured.
              </p>
              <section className="recent-chart">
                <div className="section-line">
                  <h3>Recent status</h3>
                  <Ranges />
                </div>
                <HistoryChart />
                <p className="chart-caption">
                  Recorded threshold transitions · Philippine time
                </p>
              </section>
              <section className="intelligence-card">
                <div className="intelligence-heading">
                  <Image
                    src="/assets/flow-intelligence.png"
                    width={32}
                    height={30}
                    alt=""
                  />
                  <h3>FLOW Intelligence</h3>
                  <button
                    className="icon-btn"
                    aria-label="About FLOW Intelligence"
                    onClick={() => f.setModal('ai-info')}
                  >
                    <Icon name="info" />
                  </button>
                </div>
                {s.level === null
                  ? (
                    <p className="summary-text">
                      {f.offline
                        ? 'The app is disconnected. Restore the connection to check the latest reported condition.'
                        : summaryFor(node, [], [], f.now)}
                    </p>
                  )
                  : loading
                    ? (
                      <div
                        className="summary-loading"
                        role="status"
                        aria-label="Loading summary"
                      >
                        <div className="skeleton" />
                        <div className="skeleton" />
                        <div className="skeleton" />
                      </div>
                    )
                    : (
                      <p className="summary-text">
                        {result?.text || 'Refresh to summarize the latest sensor evidence.'}
                      </p>
                    )}
                <div className="ai-label">
                  <span>
                    {result?.provider === 'gemini'
                      ? 'AI-ASSISTED · CHECK SENSOR EVIDENCE'
                      : 'EVIDENCE SUMMARY · AI UNAVAILABLE'}
                  </span>
                  <button
                    aria-label="Refresh FLOW summary"
                    disabled={loading || s.level === null}
                    onClick={refresh}
                  >
                    <Icon name="refresh" />
                  </button>
                </div>
              </section>
              <div className="support-cards">
                <button
                  className="support-card route-card"
                  onClick={() => f.setModal('route')}
                >
                  <div className="support-heading">
                    <Icon name="route" />
                    <h3>Recommended Route</h3>
                    <span className="arrow">›</span>
                  </div>
                  <p>No flood-aware route is available for this location.</p>
                  <small>View map options</small>
                </button>
                <button
                  className="support-card countdown"
                  onClick={() => f.setModal('forecast')}
                >
                  <div className="support-heading">
                    <Icon name="clock" />
                    <h3>Time to Critical Level</h3>
                  </div>
                  <strong className="no-estimate">—</strong>
                  <p>No validated forecast available.</p>
                </button>
              </div>
              <button
                className="recede-card"
                onClick={() => f.setModal('forecast')}
              >
                <span className="recede-icon">
                  <Icon name="arrow-down" />
                </span>
                <span className="recede-copy">
                  <h3>Estimated Time To Recede</h3>
                  <span className="recede-value">
                    <strong className="no-estimate">—</strong>
                    <span className="recede-description">
                      Recession estimates are not available from threshold readings.
                    </span>
                  </span>
                </span>
              </button>
              <div className="evidence-links">
                <button
                  className="text-btn"
                  onClick={() => f.setTab('history')}
                >
                  <Icon name="clock" />
                  {' '}
                  Sensor history
                </button>
                <button
                  className="text-btn"
                  onClick={() => f.setTab('device')}
                >
                  <Icon name="radio" />
                  {' '}
                  Node details
                </button>
                <button
                  className="text-btn"
                  onClick={() => f.setModal('follow')}
                >
                  <Icon name="bell" />
                  {' '}
                  {f.follows[node.id] ? 'Manage alerts' : 'Get alerts'}
                </button>
              </div>
            </>
          )
          : f.tab === 'history'
            ? (
              <>
                <div className="history-controls">
                  <Ranges />
                  <button
                    className="text-btn"
                    onClick={exportCSV}
                  >
                    <Icon name="download" />
                    {' '}
                    Export CSV
                  </button>
                </div>
                <HistoryChart />
                <p className="mini-caption">
                  Discrete threshold observations, not continuous depth. Times shown in Philippine
                  time.
                </p>
                {f.historyTruncated
                  && (
                    <p className="note">
                      History is limited to the latest 10,000 events in the requested window.
                    </p>
                  )}
                <div className="detail-section">
                  {events.filter(e => Date.parse(e.recorded_at) >= f.now - f.range * 3600000).slice().reverse()
                    .map(
                      e => (
                        <article
                          className="event-row"
                          key={e.id}
                        >
                          <span
                            className="status-dot"
                            style={
                              {
                                background: e.level === null
                                  ? STATUS.fault.color
                                  : STATUS[(['below', 'advisory', 'watch', 'warning'] as const)[e.level]].color
                              }
                            }
                          />
                          <div>
                            <h4>
                              {e.quality !== 'valid' || e.level === null
                                ? 'Inconsistent sensor inputs'
                                : STATUS[(['below', 'advisory', 'watch', 'warning'] as const)[e.level]].label}
                            </h4>
                            <p>
                              {e.probes.map((wet, i) => `L${i + 1} ${wet ? 'wet' : 'dry'}`).join(' · ')}
                            </p>
                          </div>
                          <time>{clock(e.recorded_at)}</time>
                        </article>

                      ))}
                </div>
              </>
            )
            : (
              <>
                <h3 className="device-heading">Device information</h3>
                <dl>
                  {[
                    ['Device ID', node.id],
                    ['Coordinates', `${node.latitude.toFixed(6)}, ${node.longitude.toFixed(6)}`],
                    ['Sensor type', '3 threshold probes + common'],
                    ['GPIO assignments', 'L1:32 · L2:33 · L3:25'],
                    [
                      'Latest report',
                      node.last_seen
                        ? new Date(node.last_seen).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })
                        : 'No reading yet'
                    ],
                    ['Wi-Fi signal', node.rssi !== null ? node.rssi + ' dBm' : 'Unknown'],
                    ['Firmware', node.firmware || 'Unknown'],
                    ['Observation version', node.state_version]
                  ].map(
                    ([key, value]) => (
                      <div
                        className="keyvalue"
                        key={key}
                      >
                        <dt>{key}</dt>
                        <dd>{value}</dd>
                      </div>

                    ))}
                </dl>
                <div className="probe-grid">
                  {node.probes.map(
                    (wet, i) => (
                      <div
                        className="probe-cell"
                        key={i}
                      >
                        <span>
                          Level
                          {' '}
                          {i + 1}
                        </span>
                        <b className={wet ? 'wet' : ''}>
                          {node.last_seen ? (wet ? 'Wet' : 'Dry') : 'Unknown'}
                        </b>
                      </div>

                    ))}
                </div>
                <p className="note">
                  These are the last reported probe values.
                  {' '}
                  {s.level === null ? 'They do not confirm a current flood condition. ' : ''}
                  Coordinates are registered during setup. The device has no continuous-depth or
                  GPS sensor.
                </p>
                <button
                  className="secondary-btn full"
                  onClick={
                    async () => {
                      try {
                        await navigator.clipboard.writeText(location.href);
                        f.notify('Link copied.');
                      }
                      catch {
                        f.notify('Copy the address from your browser to share this node.', true);
                      }
                    }
                  }
                >
                  <Icon name="copy" />
                  {' '}
                  Copy location link
                </button>
                <section className="detail-section">
                  <div className="section-line">
                    <h3>Nearby monitoring points</h3>
                    <span>Within 3 km</span>
                  </div>
                  {f.nearby.map(
                    n => (
                      <button
                        className="nearby-row"
                        key={n.id}
                        onClick={() => f.selectNode(n.id)}
                      >
                        <span className="nearby-icon">
                          <Icon name="map-pin" />
                        </span>
                        <span>
                          <strong>{n.name}</strong>
                          <small className="nearby-age">
                            {distanceText(n.distance)}
                            {' '}
                            ·
                            {' '}
                            {f.age(n)}
                          </small>
                        </span>
                        <span
                          className="status-label"
                          style={{ '--status-color': f.getStatus(n).color } as CSSProperties}
                        >
                          {f.getStatus(n).short}
                        </span>
                      </button>

                    ))}
                </section>
              </>
            )}
      </div>
      <footer className="detail-footer">
        <button
          className="primary-btn full"
          onClick={() => f.setModal('directions')}
        >
          <Icon name="navigation" />
          <span>Get Directions</span>
        </button>
        <p>Monitoring-point directions do not confirm a safe or passable route.</p>
      </footer>
    </section>
  );
}

function Ranges() {
  const f = useFlow();

  return (
    <div
      className="segmented"
      aria-label="History time range"
    >
      {([
        [24, '24H'],
        [168, '7D'],
        [720, '30D']
      ] as const).map(
        ([hours, label]) => (
          <button
            key={hours}
            className={f.range === hours ? 'active' : ''}
            aria-pressed={f.range === hours}
            onClick={() => f.setRange(hours)}
          >
            {label}
          </button>

        ))}
    </div>
  );
}
