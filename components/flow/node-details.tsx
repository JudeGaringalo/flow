'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Image from 'next/image';
import { useFlow } from '@/hooks/use-flow';
import { observationTrend, useObservationHistory } from '@/hooks/use-observation-history';
import { useFlowIntelligence } from '@/hooks/use-flow-intelligence';
import type { NodeWeatherState } from '@/hooks/use-node-weather';
import { WEATHER_MAX_AGE_MS, weatherDescription } from '@/lib/node-weather';
import { Icon } from './icon';
import { RecentStatusChart } from './recent-status-chart';

export function NodeDetails({ weather }: { weather: NodeWeatherState }) {
  const f = useFlow();
  const node = f.selected;
  const history = useObservationHistory(f.nodes, f.selectedId);
  const intelligence = useFlowIntelligence(node, history.spans,
    !!node && f.getStatus(node).key === 'unavailable');
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

  const now = Date.now();
  const rainfall = weather.data?.daily.find(day => day.date === weather.data?.forecastDay)?.rainfallMm ?? null;
  const localWeather = weather.data?.current && now - weather.data.current.at <= WEATHER_MAX_AGE_MS
    ? weather.data.current : null;
  const condition = weatherDescription(localWeather?.weatherCode ?? null);
  const temperature = localWeather?.temperatureC;
  const status = f.getStatus(node);
  const trend = status.level === null ? { label: 'Unconfirmed', delta: null }
    : observationTrend(history.spans, now);
  const style = {
    '--status-color': status.color,
    ...(mobile && dragHeight !== null ? { height: `${dragHeight}px` } : {}),
  } as CSSProperties;
  return (
    <section
      ref={sheet}
      className={'details node-report' + (f.expanded ? ' expanded' : '')
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
          Updated <strong>{f.age(node)}</strong>
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
                <h3>{status.level && status.level > 0 ? `Flood ${status.short}` : status.label}</h3>
                <p>{status.level === null ? 'Current level unconfirmed'
                  : status.level === 0 ? 'Below first threshold' : `Level ${status.level} reached`}</p>
              </div>
            </div>
            <span className="trend-indicator" title="Threshold trend from recent recorded readings"
              data-trend={trend.delta === null ? 'unknown'
              : trend.delta > 0 ? 'rising' : trend.delta < 0 ? 'falling' : 'steady'}>
              {trend.label}
            </span>
          </div>
          <div className="measure-cards">
            <div className="measure-card">
              <Icon name="waves" />
              <div>
                <p>Water level</p>
                <strong>{status.level === null ? 'Unconfirmed' : `Level ${status.level} / 3`}</strong>
                <small>Threshold reading</small>
              </div>
            </div>
            <button className="measure-card weather-card" type="button" onClick={() => f.setModal('weather')}
              aria-label="View full weather forecast for this monitoring point" aria-haspopup="dialog">
              <Icon name="rain" />
              <span>
                <span className="weather-card-label">Rainfall (24h)</span>
                <strong aria-label={rainfall === null ? 'Rainfall estimate unavailable'
                  : `${rainfall} millimeters of forecast rainfall for the full Philippine day`}>
                  {rainfall === null ? '—' : rainfall > 0 && rainfall < 0.1 ? '<0.1 mm'
                    : `${rainfall.toFixed(1)} mm`}
                </strong>
                <small>{rainfall === null ? weather.loading ? 'Loading estimate…' : 'Unavailable'
                  : 'Full-day forecast'} · View weather</small>
              </span>
            </button>
          </div>
          <p className="measure-disclaimer">
            Threshold readings do not measure water depth in meters.
          </p>
          <p className="measure-disclaimer" aria-live="polite">
            {temperature !== null && temperature !== undefined && <>{Math.round(temperature)}°C · </>}
            {condition && <>{condition} · </>}
            {rainfall !== null ? <>Rainfall: 12 AM–12 AM Philippine time · </> : null}
            Weather estimates by <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>.
            {weather.error && <> Refresh unavailable. <button type="button" className="text-btn"
              disabled={weather.loading} onClick={weather.retryWeather}>Retry weather</button></>}
          </p>
        </div>
        <RecentStatusChart key={node.id} spans={history.spans} now={now} recorded={history.recorded}
          loading={history.loading} error={history.error} onRetry={history.retryHistory} />
        <section className="intelligence-card" aria-labelledby="intelligence-title">
          <div className="intelligence-heading">
            <Image src="/assets/flow-intelligence.png" alt="" width={32} height={30} unoptimized />
            <h3 id="intelligence-title">FLOW Intelligence</h3>
            <button className="icon-btn" type="button" aria-label="About FLOW observations"
              onClick={() => f.setModal('about')}><Icon name="info" /></button>
          </div>
          <p className="summary-text" aria-live="polite">{intelligence.summary}</p>
          <p className="intelligence-basis">{intelligence.basis}
            {intelligence.canRetry && <> <button className="text-btn" type="button"
              onClick={intelligence.retry}>Retry AI</button></>}
          </p>
        </section>
        <div className="support-cards">
          <section className="support-card countdown" aria-labelledby="critical-time-title"
            style={{ gridColumn: '1 / -1' }}>
            <div className="support-heading">
              <Icon name="clock" /><h3 id="critical-time-title">Estimated time to Level 3</h3>
            </div>
            <strong className="forecast-value">{intelligence.critical?.value}</strong>
            <p>{intelligence.critical?.detail}</p>
          </section>
        </div>
        <section className="recede-card" aria-labelledby="recede-title">
          <span className="recede-icon" aria-hidden="true"><Icon name="arrow-down" /></span>
          <div className="recede-copy">
            <h3 id="recede-title">Estimated time to recede</h3>
            <strong>{intelligence.recede?.value}</strong>
            <p>{intelligence.recede?.detail}</p>
          </div>
        </section>
      </div>
    </section>
  );
}
