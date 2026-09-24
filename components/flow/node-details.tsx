'use client';

import { useRef, type CSSProperties } from 'react';
import { useFlow } from '@/hooks/use-flow';
import { distanceText } from '@/lib/core';
import { Icon } from './icon';

export function NodeDetails() {
  const f = useFlow();
  const node = f.selected;
  const drag = useRef<number | null>(null);
  const didDrag = useRef(false);
  if (!node) return null;

  const status = f.getStatus(node);
  const style = { '--status-color': status.color } as CSSProperties;
  return (
    <section
      className={'details' + (f.expanded ? ' expanded' : '')}
      id="details"
      data-status={status.key}
      aria-labelledby="detail-location-title"
      style={style}
    >
      <button
        className="detail-handle"
        aria-label={f.expanded ? 'Collapse sensor details' : 'Expand sensor details'}
        aria-expanded={f.expanded}
        onPointerDown={event => {
          drag.current = event.clientY;
          didDrag.current = false;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          if (drag.current !== null && Math.abs(event.clientY - drag.current) > 25)
            didDrag.current = true;
        }}
        onPointerCancel={() => { drag.current = null; didDrag.current = false; }}
        onPointerUp={event => {
          if (drag.current !== null && didDrag.current)
            f.setExpanded(event.clientY < drag.current);
          drag.current = null;
        }}
        onClick={() => {
          if (!didDrag.current) f.setExpanded(!f.expanded);
          didDrag.current = false;
        }}
      />
      <div className="detail-header">
        <div className="detail-title-row">
          <h2 id="detail-location-title">{node.name}</h2>
          <button className="icon-btn" aria-label="Close sensor details" onClick={f.closeDetails}>
            <Icon name="x" />
          </button>
        </div>
        <p className="detail-subtitle">{node.area}</p>
        <div className="detail-freshness">
          Latest report <strong>{f.age(node)}</strong>
        </div>
      </div>
      <div className="detail-content">
        <div className="condition-and-trend">
          <div className="condition-card">
            <div className="condition-icon">
              <Icon name={status.key === 'unavailable' ? 'wifi-off' : status.key === 'fault' ? 'triangle' : 'flood'} />
            </div>
            <div className="condition-copy">
              <h3>{status.label}</h3>
              <p>{status.level === null ? 'Current level unconfirmed'
                : status.level === 0 ? 'Below first threshold' : `Level ${status.level} reached`}</p>
            </div>
          </div>
        </div>
        <div className="measure-cards">
          <div className="measure-card">
            <Icon name="waves" />
            <div>
              <p>Latest water level</p>
              <strong>{status.level === null ? 'Unavailable' : `Level ${status.level} / 3`}</strong>
            </div>
          </div>
        </div>
        <p className="measure-disclaimer">
          Readings come from three fixed threshold probes. Below threshold does not mean a road is safe.
          An old or faulty reading cannot confirm current conditions.
        </p>
        <section className="detail-section">
          <h3 className="device-heading">Sensor observation</h3>
          <div className="probe-grid">
            {node.probes.map((wet, index) => (
              <div className="probe-cell" key={index}>
                <span>Level {index + 1}</span>
                <b className={wet ? 'wet' : ''}>
                  {node.last_seen && node.quality !== 'unknown' ? (wet ? 'Wet' : 'Dry') : 'Unknown'}
                </b>
              </div>
            ))}
          </div>
          <p className="note">These are the last reported probe values. They do not confirm conditions when the reading is unavailable.</p>
          <dl>
            {([
              ['Device ID', node.id],
              ['Last received', node.last_seen
                ? new Date(node.last_seen).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })
                : 'No report yet'],
              ['Coordinates', `${node.latitude.toFixed(6)}, ${node.longitude.toFixed(6)}`],
              ['Signal', node.rssi !== null ? `${node.rssi} dBm` : 'Unknown'],
              ['Firmware', node.firmware || 'Unknown']
            ] as const).map(([label, value]) => (
              <div className="keyvalue" key={label}><dt>{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>
        </section>
        {f.nearby.length > 0 && (
          <section className="detail-section">
            <div className="section-line"><h3>Nearby monitoring points</h3><span>Within 3 km</span></div>
            {f.nearby.map(near => (
              <button className="nearby-row" key={near.id} onClick={() => f.selectNode(near.id)}>
                <span className="nearby-icon"><Icon name="map-pin" /></span>
                <span><strong>{near.name}</strong><small className="nearby-age">
                  {distanceText(near.distance)} · {f.age(near)}
                </small></span>
                <span className="status-label" style={{ '--status-color': f.getStatus(near).color } as CSSProperties}>
                  {f.getStatus(near).short}
                </span>
              </button>
            ))}
          </section>
        )}
      </div>
      <footer className="detail-footer">
        <button className="primary-btn full" onClick={() => f.setModal('directions')}>
          <Icon name="navigation" /><span>Get Directions</span>
        </button>
        <p>Directions to a monitoring point do not confirm a safe route.</p>
      </footer>
    </section>
  );
}
