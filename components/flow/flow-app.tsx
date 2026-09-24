'use client';

import { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import Image from 'next/image';
import { FlowProvider, useFlow } from '@/hooks/use-flow';
import { config } from '@/lib/config';
import type { MapHandle } from '@/lib/types';
import { Icon } from './icon';
import { MapCanvas } from './map-canvas';
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
          <MapCanvas ref={mapRef} />
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
              aria-label={f.visibleNodes.length ? 'Fit all monitoring points' : 'Show Philippines'}
              onClick={() => mapRef.current?.fit()}
            >
              <Icon name="expand" />
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
            <span className={'mode-badge' + (f.connection === 'live' && !f.offline && f.nodes.some(n => f.getStatus(n).level !== null) ? ' live' : ' offline')}>
              <span className="status-dot" />
              {statusLabel}
            </span>
          </div>
          <NodeDetails />
        </div>
      </main>
      <Dialogs mapRef={mapRef} />
      <PwaRegistration />
      <div
        className="toasts"
        aria-live="polite"
      >
        {f.toasts.map(
          t => (
            <div
              key={t.id}
              className={'toast' + (t.error ? ' error' : '')}
            >
              <Icon name={t.error ? 'triangle' : 'check'} />
              <span>{t.text}</span>
            </div>

          ))}
      </div>
    </>
  );
}
