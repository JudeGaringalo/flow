'use client';

import { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import Image from 'next/image';
import { FlowProvider, useFlow } from '@/hooks/use-flow';
import { config } from '@/lib/config';
import type { EvacuationSiteResponse, MappedEvacuationSite } from '@/lib/evacuation-sites';
import type { MapHandle } from '@/lib/types';
import { Icon } from './icon';
import { MapCanvas, type HazardState } from './map-canvas';
import { NodeDetails } from './node-details';
import { Dialogs, PwaRegistration } from './dialogs';

export default function FlowApp() {
  ReactDOM.preconnect('https://tiles.openfreemap.org', { crossOrigin: 'anonymous' });
  return (
    <FlowProvider>
      <Workspace />
    </FlowProvider>
  );
}

function Workspace() {
  const f = useFlow(),
    mapRef = useRef<MapHandle | null>(null),
    searchRef = useRef<HTMLInputElement>(null),
    searchDock = useRef<HTMLDivElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [flatView, setFlatView] = useState(false);
  const [evacuationSites, setEvacuationSites] = useState<MappedEvacuationSite[]>([]);
  const [showEvacuationSites, setShowEvacuationSites] = useState(true);
  const [showHazard, setShowHazard] = useState(false);
  const [hazardState, setHazardState] = useState<HazardState>('off');
  const [siteState, setSiteState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [siteRequest, setSiteRequest] = useState(0);

  useEffect(() => {
    if (f.selectedId) setShowHazard(true);
  }, [f.selectedId]);

  useEffect(() => {
    if (!f.ready) return;
    const controller = new AbortController();
    setSiteState('loading');
    void fetch('/api/evacuation-sites', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Recorded evacuation sites unavailable');
        const data: EvacuationSiteResponse = await response.json();
        if (!Array.isArray(data.sites)) throw new Error('Invalid evacuation map data');
        if (!controller.signal.aborted) {
          setEvacuationSites(data.sites);
          setSiteState('ready');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setSiteState('error');
      });
    return () => controller.abort();
  }, [f.ready, siteRequest]);

  useEffect(
    () => {
      const pointer = (event: PointerEvent) => {
        if (!searchDock.current?.contains(event.target as Node))
          setSearchOpen(false);
      };
      const key = (event: KeyboardEvent) => {
        const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((document.activeElement as HTMLElement)?.tagName);
        if (event.key === '/' && !editing && !f.modal) {
          event.preventDefault();
          searchRef.current?.focus();
          setSearchOpen(true);
        }

        if (event.key === 'Escape' && !f.modal) {
          setSearchOpen(false);
          f.closeDetails();
        }
      };
      document.addEventListener('pointerdown', pointer);
      document.addEventListener('keydown', key);
      return () => {
        document.removeEventListener('pointerdown', pointer);
        document.removeEventListener('keydown', key);
      };
    },
    [f.modal]
  );

  function home() {
    f.closeDetails();
    f.setFilter('all');
    f.setQuery('');
    setSearchOpen(false);
    mapRef.current?.showPhilippines();
  }

  function locate() {
    if (!navigator.geolocation) {
      f.notify('This browser does not support location access.', true);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      p => {
        const located = mapRef.current?.locate(p.coords.latitude, p.coords.longitude, p.coords.accuracy);
        if (!located) {
          f.notify('Your location is outside the Philippines map view, or the map is still loading.', true);
        }
      },
      () => f.notify('Location was unavailable. Allow access or search for a monitored location.', true),
      {
        enableHighAccuracy: true,
        timeout: 12000
      }
    );
  }

  const statusLabel = !f.ready
    ? 'Loading FLOW…'
    : !config.configured
      ? 'No sensor connection'
      : !f.online
        ? 'Connection unavailable'
        : f.connection === 'loading'
          ? 'Connecting to sensors…'
          : f.connection === 'error'
            ? 'Connection unavailable'
            : !f.nodes.length
              ? 'No nodes registered'
              : f.nodes.some(n => f.getStatus(n).level !== null)
                ? 'Live flood conditions'
                : 'No current readings';

  if (!f.alertLocation && f.locationChecking) return <>
    <PwaRegistration />
    <main className="location-gate-page">
      <section className="location-gate location-gate-checking" role="status">
        <Image src="/assets/flow-wordmark.svg" alt="FLOW" width={145} height={36} priority />
        <p>Finding your location…</p>
      </section>
    </main>
  </>;

  if (!f.alertLocation) return <>
    <PwaRegistration />
    <main className="location-gate-page">
      <section className="location-gate" role="dialog" aria-modal="true"
        aria-labelledby="location-gate-title" aria-describedby="location-gate-description">
        <div className="location-gate-heading">
          <Image src="/assets/flow-wordmark.svg" alt="FLOW" width={145} height={36} priority />
          <h1 id="location-gate-title">Enable your location</h1>
        </div>
        <p id="location-gate-description">
          FLOW uses your location to check which monitoring points are within 3 km and alert you
          when their water level rises. If you allow notifications, FLOW saves an approximate
          area for alerts while the app is closed.
        </p>
        <button className="primary-btn" type="button" disabled={f.locationWorking}
          onClick={() => void f.requestAlertLocation()}>
          {f.locationWorking ? 'Checking location…' : 'Enable location and alerts'}
        </button>
        {f.locationError && <p className="location-gate-error" role="alert">{f.locationError}</p>}
        <small>Allow location access when prompted. Browser notifications also need permission;
          FLOW will show alerts on screen when system notifications are unavailable.</small>
      </section>
    </main>
  </>;

  return (
    <>
      <a
        className="skip-link"
        href="#map-workspace"
      >
        Skip to map
      </a>
      <header className="app-header">
        <button
          className="brand"
          onClick={() => f.setModal('menu')}
          aria-label="Open FLOW menu"
          title="FLOW menu"
        >
          <Image
            src="/assets/flow-wordmark.svg"
            alt="FLOW"
            width={97}
            height={23}
            priority
          />
          <span>FLOOD-LEVEL OBSERVATION &amp; WARNING</span>
        </button>
        <div className="header-actions">
          <button className="icon-btn" aria-label="Nearby alerts" title="Nearby alerts"
            onClick={() => f.setModal('alerts')}><Icon name="bell" /></button>
          <button
            className="icon-btn more-menu"
            aria-label="More FLOW options"
            onClick={() => f.setModal('menu')}
          >
            <Icon name="more" />
          </button>
        </div>
      </header>
      <main className="workspace" data-flow-reference="2026-09">
        <div
          className={'map-workspace' + (f.selected ? ' has-selection' : '') + (f.expanded ? ' sheet-expanded' : '')}
          id="map-workspace"
          tabIndex={-1}
        >
          <MapCanvas ref={mapRef} onFlatViewChange={setFlatView}
            evacuationSites={evacuationSites} showEvacuationSites={showEvacuationSites}
            showHazard={showHazard} onHazardStateChange={setHazardState} />
          <div
            className="search-dock"
            ref={searchDock}
          >
            <form
              className="search-wrap"
              onSubmit={
                e => {
                  e.preventDefault();
                  if (f.visibleNodes.length) {
                    f.selectNode(f.visibleNodes[0].id);
                    mapRef.current?.focus(f.visibleNodes[0].id);
                    setSearchOpen(false);
                    searchRef.current?.blur();
                  }
                }
              }
            >
              <input
                ref={searchRef}
                id="search"
                type="search"
                autoComplete="off"
                placeholder="Search location"
                aria-label="Search monitored locations"
                aria-expanded={searchOpen}
                aria-controls="search-results"
                value={f.query}
                onFocus={() => setSearchOpen(true)}
                onChange={e => {
                  f.setQuery(e.target.value);
                  setSearchOpen(true);
                }}
              />
              <button
                className="plain-btn"
                type="submit"
                aria-label="Search"
              >
                <Icon name="search" />
              </button>
            </form>
            {searchOpen
              && (
                <div
                  className="search-results"
                  id="search-results"
                >
                  {f.visibleNodes.length
                    ? f.visibleNodes.slice(0, 8)
                      .map(
                        n => (
                          <button
                            className="search-result"
                            key={n.id}
                            onClick={() => {
                              f.selectNode(n.id);
                              mapRef.current?.focus(n.id);
                              setSearchOpen(false);
                            }}
                          >
                            <span
                              className="status-dot"
                              style={{ background: f.getStatus(n).color }}
                            />
                            <span>
                              <strong>{n.name}</strong>
                              <small>
                                {n.area}
                                {' '}
                                ·
                                {' '}
                                {f.getStatus(n).label}
                              </small>
                            </span>
                          </button>

                        ))
                    : (
                      <div className="search-empty">
                        {!f.nodes.length
                          ? 'No monitored locations yet. Registered sensors will appear here.'
                          : 'No monitored locations match. Try a street name or node ID.'}
                      </div>
                    )}
                </div>
              )}
          </div>
          {f.offline
            && (
              <div
                className="map-message"
                role="status"
              >
                {!config.configured
                    ? 'Connect Supabase to register your first sensor. No readings are available yet.'
                    : f.connection === 'loading'
                      ? 'Connecting to sensor observations…'
                      : 'Connection unavailable. Previous observations do not confirm current conditions.'}
              </div>
            )}
          <div
            className="map-controls"
            aria-label="Map controls"
          >
            <div className="map-control-group">
              <button
                className="map-btn"
                aria-label="Zoom in"
                onClick={() => mapRef.current?.zoomBy(1)}
              >
                <Icon name="plus" />
              </button>
              <button
                className="map-btn"
                aria-label="Zoom out"
                onClick={() => mapRef.current?.zoomBy(-1)}
              >
                <Icon name="minus" />
              </button>
            </div>
            <button
              className="map-btn fit-control"
              aria-label={flatView ? 'Return to tilted view'
                : f.visibleNodes.length ? 'Fit all monitoring points' : 'Show Philippines'}
              onClick={() => {
                if (flatView) mapRef.current?.restoreTilt();
                else mapRef.current?.fit();
              }}
            >
              <Icon name={flatView ? 'tilt' : 'expand'} />
            </button>
            <button
              className="map-btn"
              aria-label="Use my location"
              onClick={locate}
            >
              <Icon name="locate" />
            </button>
            <button
              className="map-btn"
              aria-label="Map layers"
              data-action="layers"
              onClick={() => f.setModal('layers')}
            >
              <Icon name="layers" />
            </button>
          </div>
          <div className="map-status">
            {showHazard && <div className="hazard-map-key" role="status">
              <div className="hazard-map-key-heading">
                <strong>Modeled flood hazard</strong>
                <span>{f.selected ? `Near ${f.selected.name}` : 'NOAH · 5-year scenario'}</span>
              </div>
              {f.selected && <div className="hazard-live-node">
                <span className="status-dot" style={{ background: f.getStatus(f.selected).color }} />
                <span>{f.selected.name}: {f.getStatus(f.selected).label} at this sensor</span>
              </div>}
              {hazardState === 'ready' && <div className="hazard-scale" aria-label="Flood hazard levels">
                <span><i className="hazard-low" />Low</span>
                <span><i className="hazard-medium" />Medium</span>
                <span><i className="hazard-high" />High</span>
              </div>}
              {hazardState !== 'ready' && <small>
                {hazardState === 'loading' ? 'Loading mapped areas…'
                  : hazardState === 'zoom' ? 'Zoom in for detailed hazard areas.'
                    : hazardState === 'empty' ? 'No mapped areas in view; coverage varies.'
                      : hazardState === 'unavailable' ? 'Hazard layer unavailable. Try moving the map.'
                        : 'Preparing mapped areas…'}
              </small>}
              <small>Scenario map, not current floodwater.</small>
            </div>}
            <span className={'mode-badge' + (f.connection === 'live' && !f.offline && f.nodes.some(n => f.getStatus(n).level !== null) ? ' live' : ' offline')}>
              <span className="status-dot" />
              {statusLabel}
            </span>
            <button className="evacuation-map-key" type="button"
              onClick={() => f.setModal('evacuation')}>
              <span className="evacuation-key-dot" aria-hidden="true"><Icon name="shelter" /></span>
              {siteState === 'loading' ? 'Loading evacuation sites…'
                : siteState === 'error' ? 'Evacuation map unavailable'
                  : `${evacuationSites.length} mapped evacuation sites`}
              <Icon name="chevron" />
            </button>
          </div>

          <NodeDetails />
        </div>
      </main>
      <Dialogs mapRef={mapRef} evacuationSites={evacuationSites}
        showEvacuationSites={showEvacuationSites} setShowEvacuationSites={setShowEvacuationSites}
        showHazard={showHazard} setShowHazard={setShowHazard} hazardState={hazardState}
        siteState={siteState} onRetrySites={() => setSiteRequest(value => value + 1)}
        onSelectEvacuation={id => {
          setShowEvacuationSites(true);
          f.setModal(null);
          requestAnimationFrame(() => mapRef.current?.focusEvacuation(id));
        }} />
      <PwaRegistration />
      <div
        className="toasts"
        aria-live="polite"
      >
        {f.toasts.map(
          t => (
            <div
              key={t.id}
              className={'toast' + (t.error ? ' error' : '') + (t.alertLevel ? ` alert alert-${t.alertLevel}` : '')}
            >
              <Icon name={t.alertLevel ? 'bell' : t.error ? 'triangle' : 'check'} />
              <span>{t.text}</span>
            </div>

          ))}
      </div>
    </>
  );
}
