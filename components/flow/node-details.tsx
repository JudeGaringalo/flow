'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Image from 'next/image';
import { useFlow } from '@/hooks/use-flow';
import { distanceText } from '@/lib/core';
import type { NodeStatus } from '@/lib/types';
import { Icon } from './icon';

function observationSummary(status: NodeStatus) {
  switch (status.key) {
    case 'warning':
      return 'The highest water threshold has been reached at this monitoring point. Avoid floodwater and check official local instructions. Conditions away from this sensor may differ.';
    case 'watch':
      return 'The second water threshold has been reached here. Stay alert for changes and check local advisories before traveling near this monitoring point.';
    case 'advisory':
      return 'The first water threshold has been reached here. Monitor updates and use caution around low-lying roads near this point.';
    case 'below':
      return 'All three water thresholds are currently below their trigger points at this sensor. This does not confirm that nearby roads are dry or safe.';
    case 'fault':
      return 'The latest probe combination could not be verified. The water level at this point is unconfirmed until a valid reading arrives.';
    default:
      return 'A recent valid sensor reading is unavailable. FLOW cannot confirm the current water level at this point. Check official local updates.';
  }
}

export function NodeDetails() {
  const f = useFlow();
  const node = f.selected;
  const drag = useRef<number | null>(null);
  const dragStartHeight = useRef(0);
  const bodyDrag = useRef<{ pointerId: number; startY: number; startHeight: number; active: boolean } | null>(null);
  const didDrag = useRef(false);
  const sheet = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mobile, setMobile] = useState(false);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  closingRef.current = closing;
  const [, updateAge] = useState(0);
  function finishSheetDrag(height: number, viewport: number) {
    if (height < viewport * .5) {
      setClosing(true);
      setDragHeight(0);
      closeTimer.current = setTimeout(f.closeDetails,
        window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 260);
    } else {
      f.setExpanded(height >= viewport * .82);
      setDragHeight(null);
    }
    setDragging(false);
  }
  const finishDragRef = useRef(finishSheetDrag);
  finishDragRef.current = finishSheetDrag;
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!node) return;
    const timer = setInterval(() => updateAge(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [node?.id]);
  useEffect(() => {
    if (!node || !mobile) return;
    const previous = document.activeElement;
    closeButton.current?.focus({ preventScroll: true });
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, [node?.id, mobile]);
  useEffect(() => {
    setClosing(false);
    setDragging(false);
    setDragHeight(null);
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [node?.id]);
  useEffect(() => {
    const element = sheet.current;
    if (!node || !mobile || !element) return;
    type TouchDrag = {
      startY: number;
      startHeight: number;
      content: HTMLElement | null;
      active: boolean;
      scrolling: boolean;
    };
    let gesture: TouchDrag | null = null;
    const viewport = () => window.visualViewport?.height ?? window.innerHeight;
    const start = (event: TouchEvent) => {
      if (event.touches.length !== 1 || closingRef.current) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest('.detail-handle, button, a, input, textarea, select')) return;
      gesture = {
        startY: event.touches[0].clientY,
        startHeight: element.getBoundingClientRect().height,
        content: target.closest<HTMLElement>('.detail-content'),
        active: false,
        scrolling: false,
      };
    };
    const move = (event: TouchEvent) => {
      if (!gesture || event.touches.length !== 1) return;
      const y = event.touches[0].clientY;
      const delta = y - gesture.startY;
      if (!gesture.active && Math.abs(delta) < 4) return;
      if (!gesture.active) {
        if (gesture.content && gesture.content.scrollTop > 1) {
          gesture.scrolling = true;
          return;
        }
        if (gesture.scrolling) {
          if (delta <= 0) return;
          gesture.startY = y;
          gesture.startHeight = element.getBoundingClientRect().height;
        } else if (gesture.content && delta < 0 && element.classList.contains('expanded')) {
          gesture.scrolling = true;
          return;
        }
        gesture.active = true;
        setDragging(true);
      }
      event.preventDefault();
      setDragHeight(Math.max(0, Math.min(viewport() - 16,
        gesture.startHeight + gesture.startY - y)));
    };
    const end = (event: TouchEvent) => {
      if (gesture?.active) {
        const y = event.changedTouches[0]?.clientY ?? gesture.startY;
        finishDragRef.current(gesture.startHeight + gesture.startY - y, viewport());
      }
      gesture = null;
    };
    const cancel = () => {
      if (gesture?.active) {
        setDragging(false);
        setDragHeight(null);
      }
      gesture = null;
    };
    element.addEventListener('touchstart', start, { passive: true });
    element.addEventListener('touchmove', move, { passive: false });
    element.addEventListener('touchend', end);
    element.addEventListener('touchcancel', cancel);
    return () => {
      element.removeEventListener('touchstart', start);
      element.removeEventListener('touchmove', move);
      element.removeEventListener('touchend', end);
      element.removeEventListener('touchcancel', cancel);
    };
  }, [node?.id, mobile]);
  if (!node) return null;

  const status = f.getStatus(node);
  const style = {
    '--status-color': status.color,
    ...(mobile && dragHeight !== null ? { height: `${dragHeight}px` } : {}),
  } as CSSProperties;
  return (
    <section
      ref={sheet}
      className={'details' + (f.expanded ? ' expanded' : '')
        + (dragging ? ' is-dragging' : '') + (closing ? ' is-closing' : '')}
      id="details"
      data-status={status.key}
      role="dialog"
      aria-modal={mobile || undefined}
      aria-labelledby="detail-location-title"
      style={style}
      onPointerDown={event => {
        if (!mobile || closing || event.pointerType === 'touch') return;
        const target = event.target instanceof Element ? event.target : null;
        if (!target || target.closest('.detail-handle, button, a, input, textarea, select')) return;
        if (target.closest<HTMLElement>('.detail-content')?.scrollTop) return;
        bodyDrag.current = {
          pointerId: event.pointerId,
          startY: event.clientY,
          startHeight: sheet.current?.getBoundingClientRect().height ?? window.innerHeight * .7,
          active: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const gesture = bodyDrag.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        if (!gesture.active && Math.abs(event.clientY - gesture.startY) < 4) return;
        gesture.active = true;
        setDragging(true);
        const viewport = window.visualViewport?.height ?? window.innerHeight;
        setDragHeight(Math.max(0, Math.min(viewport - 16,
          gesture.startHeight + gesture.startY - event.clientY)));
      }}
      onPointerUp={event => {
        const gesture = bodyDrag.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        if (gesture.active) {
          const viewport = window.visualViewport?.height ?? window.innerHeight;
          finishSheetDrag(gesture.startHeight + gesture.startY - event.clientY, viewport);
        }
        bodyDrag.current = null;
      }}
      onPointerCancel={event => {
        if (bodyDrag.current?.pointerId !== event.pointerId) return;
        bodyDrag.current = null;
        setDragging(false);
        setDragHeight(null);
      }}
    >
      <button
        className="detail-handle"
        aria-label={f.expanded ? 'Collapse sensor details' : 'Expand sensor details'}
        aria-expanded={f.expanded}
        onPointerDown={event => {
          if (closing) return;
          drag.current = event.clientY;
          didDrag.current = false;
          if (mobile) {
            dragStartHeight.current = sheet.current?.getBoundingClientRect().height ?? window.innerHeight * .7;
            setDragHeight(dragStartHeight.current);
            setDragging(true);
          }
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          if (drag.current === null) return;
          if (Math.abs(event.clientY - drag.current) > (mobile ? 6 : 25)) didDrag.current = true;
          if (mobile && didDrag.current) {
            const viewport = window.visualViewport?.height ?? window.innerHeight;
            setDragHeight(Math.max(0, Math.min(viewport - 16,
              dragStartHeight.current + drag.current - event.clientY)));
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
          didDrag.current = false;
          setDragging(false);
          setDragHeight(null);
        }}
        onPointerUp={event => {
          if (drag.current !== null && didDrag.current) {
            if (mobile) {
              const viewport = window.visualViewport?.height ?? window.innerHeight;
              const height = dragStartHeight.current + drag.current - event.clientY;
              finishSheetDrag(height, viewport);
            } else f.setExpanded(event.clientY < drag.current);
          } else if (mobile) setDragHeight(null);
          if (!didDrag.current) setDragging(false);
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
          <button ref={closeButton} className="icon-btn" aria-label="Close sensor details" onClick={f.closeDetails}>
            <Icon name="x" />
          </button>
        </div>
        <p className="detail-subtitle">{node.area}</p>
        <div className="detail-freshness">
          Latest report <strong>{f.age(node)}</strong>
        </div>
      </div>
      <div className="detail-content">
        <div className="detail-summary">
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
                <p>Water threshold</p>
                <strong>{status.level === null ? 'Unconfirmed' : `Level ${status.level} / 3`}</strong>
              </div>
            </div>
            <div className="measure-card">
              <Icon name="clock" />
              <div>
                <p>Last report</p>
                <strong>{f.age(node)}</strong>
              </div>
            </div>
          </div>
          <p className="measure-disclaimer">
            Readings reflect fixed water-level thresholds. Below threshold does not mean a road is safe.
            An old or faulty reading cannot confirm current conditions.
          </p>
        </div>
        <section className="intelligence-card" aria-labelledby="intelligence-title">
          <div className="intelligence-heading">
            <Image src="/assets/flow-intelligence.png" alt="" width={32} height={30} unoptimized />
            <h3 id="intelligence-title">FLOW Intelligence</h3>
          </div>
          <p className="summary-text">{observationSummary(status)}</p>
          <p className="intelligence-basis">Based on the latest sensor observation · {f.age(node)}</p>
        </section>
        <section className="detail-section detail-observation">
          <h3 className="device-heading">Sensor observation</h3>
          <div className="probe-grid">
            {node.probes.map((wet, index) => (
              <div className="probe-cell" key={index}>
                <span>Level {index + 1}</span>
                <b className={wet ? 'wet' : ''}>
                  {node.last_seen && node.quality !== 'unknown' ? (wet ? 'Reached' : 'Not reached') : 'Unknown'}
                </b>
              </div>
            ))}
          </div>
          <p className="note">These are the last reported threshold states. They do not confirm conditions when the reading is unavailable.</p>
          <dl>
            {([
              ['Device ID', node.id],
              ['Last received', node.last_seen
                ? new Date(node.last_seen).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })
                : 'No report yet'],
              ['Coordinates', `${node.latitude.toFixed(6)}, ${node.longitude.toFixed(6)}`]
            ] as const).map(([label, value]) => (
              <div className="keyvalue" key={label}><dt>{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>
        </section>
        {f.nearby.length > 0 && (
          <section className="detail-section detail-nearby">
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
