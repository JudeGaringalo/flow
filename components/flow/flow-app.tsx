'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Image from 'next/image';
import { FlowProvider, useFlow } from '@/hooks/use-flow';
import { config } from '@/lib/config';
import type { MapHandle } from '@/lib/types';
import { Icon } from './icon';
import { MapCanvas } from './map-canvas';
import { NodeDetails } from './node-details';
import { Dialogs, PwaRegistration } from './dialogs';

export default function FlowApp() {
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
          f.setListOpen(false);
          if (f.picking)
            f.setPicking(null);
          else
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
    [f.modal, f.picking]
  );

  function home() {
    f.closeDetails();
    f.setView('all');
    f.setFilter('all');
    f.setQuery('');
    f.setListOpen(false);
    setSearchOpen(false);
    mapRef.current?.fit();
  }

  function showList(saved = false) {
    f.setView(saved ? 'saved' : 'all');
    f.setListOpen(true);
  }

  function locate() {
    if (!navigator.geolocation) {
      f.notify('This browser does not support location access.', true);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      p => {
        mapRef.current?.locate(p.coords.latitude, p.coords.longitude, p.coords.accuracy);
        f.notify(
          `Map centered on your location (reported accuracy ±${Math.round(p.coords.accuracy)} m).`
        );
      },
      () => f.notify('Location was unavailable. Allow access or search for a monitored location.', true),
      {
        enableHighAccuracy: true,
        timeout: 12000
      }
    );
  }

  const unread = f.activity.filter(a => !a.read).length;
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
                ? 'Live sensor updates'
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
          onClick={home}
          aria-label="FLOW home"
        >
          <Image
            src="/assets/flow-wordmark.png"
            alt="FLOW"
            width={105}
            height={25}
            priority
          />
          <span>FLOOD-LEVEL OBSERVATION &amp; WARNING</span>
        </button>
        <nav
          className="header-nav"
          aria-label="Map navigation"
        >
          <button
            className={'nav-btn' + (f.view === 'all' ? ' active' : '')}
            onClick={() => showList()}
          >
            <Icon name="map" />
            {' '}
            Live map
          </button>
          <button
            className={'nav-btn' + (f.view === 'saved' ? ' active' : '')}
            onClick={() => showList(true)}
          >
            <Icon name="bookmark" />
            {' '}
            Saved locations
            {' '}
            <span>{f.saved.length}</span>
          </button>
        </nav>
        <div className="header-actions">
          <span className="header-location">METRO MANILA</span>
          <button
            className="icon-btn"
            aria-label={f.theme === 'light'
              ? 'Switch to dark appearance'
              : 'Switch to light appearance'}
            onClick={() => f.setTheme(f.theme === 'light' ? 'dark' : 'light')}
          >
            <Icon name={f.theme === 'light' ? 'moon' : 'sun'} />
          </button>
          <button
            className="icon-btn"
            aria-label="Open notifications"
            onClick={() => f.setModal('alerts')}
          >
            <Icon name="bell" />
            {unread > 0 && (
              <span className="notification-count">{unread > 9 ? '9+' : unread}</span>
            )}
          </button>
          <button
            className="icon-btn more-menu"
            aria-label="Open FLOW menu"
            onClick={() => f.setModal('menu')}
          >
            <Icon name="more" />
          </button>
        </div>
      </header>
      <main className="workspace">
        <div
          className={'map-workspace' + (f.selected ? ' has-selection' : '')}
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
                        No monitored locations match. Try a street name or node ID.
                      </div>
                    )}
                </div>
              )}
          </div>
          <button
            className="mobile-locations"
            onClick={() => f.setListOpen(!f.listOpen)}
            aria-label="Browse monitoring locations"
          >
            <Icon name="list" />
            {' '}
            Locations
          </button>
          {(f.offline || f.picking)
            && (
              <div
                className="map-message"
                role="status"
              >
                {f.picking
                  ? (
                    <>
                      <strong>Tap the map to set coordinates.</strong>
                      {' '}
                      Verify the installation position.
                      {' '}
                      <button
                        className="text-btn"
                        onClick={() => f.setPicking(null)}
                      >
                        Cancel
                      </button>
                    </>
                  )
                  : !config.configured
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
              aria-label="Fit all monitoring points"
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
            <span className={'mode-badge' + (f.offline ? ' offline' : ' live')}>
              <span className="status-dot" />
              {statusLabel}
            </span>
          </div>
          <LocationsList />
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
      {!f.ready
        && (
          <div
            className="initial-loading"
            role="status"
          >
            <Image
              src="/assets/flow-intelligence.png"
              width={32}
              height={30}
              alt=""
            />
            <span>Opening your monitoring map…</span>
          </div>
        )}
    </>
  );
}

function LocationsList() {
  const f = useFlow();
  const count = (key: string) => f.nodes.filter(
    n => key === 'online'
      ? f.getStatus(n).level !== null
      : f.getStatus(n).key === key
  ).length;

  return (
    <aside
      className={'sidebar' + (f.listOpen ? ' mobile-open' : '')}
      aria-label="Monitoring locations"
      inert={!f.listOpen}
    >
      <div className="sidebar-heading">
        <div>
          <span className="eyebrow">THE FLOW NETWORK</span>
          <h1>{f.view === 'saved' ? 'Saved locations' : 'Monitored locations'}</h1>
        </div>
        <button
          className="icon-btn"
          aria-label="Close locations"
          onClick={() => f.setListOpen(false)}
        >
          <Icon name="x" />
        </button>
      </div>
      <div className="mobile-map-tabs">
        <button
          className={'chip' + (f.view === 'all' ? ' active' : '')}
          onClick={() => f.setView('all')}
        >
          All locations
        </button>
        <button
          className={'chip' + (f.view === 'saved' ? ' active' : '')}
          onClick={() => f.setView('saved')}
        >
          Saved ·
          {' '}
          {f.saved.length}
        </button>
      </div>
      <div className="network-overview">
        <div>
          <span className="overview-label">Network overview</span>
          <span className="subtle">
            {f.nodes.length}
            {' '}
            nodes
          </span>
        </div>
        <div className="metric-row">
          {(['warning', 'watch', 'online'] as const).map(
            key => (
              <button
                className="metric"
                key={key}
                onClick={() => f.setFilter(key)}
              >
                <span className={'metric-number ' + key + '-text'}>{count(key)}</span>
                <span>
                  {key === 'warning' ? 'Warning+' : key === 'watch' ? 'Watch' : 'Reporting'}
                </span>
              </button>

            ))}
        </div>
      </div>
      <div className="list-toolbar">
        <h2>
          {f.visibleNodes.length}
          {' '}
          locations
        </h2>
        <button
          className="text-btn"
          onClick={() => {
            f.setQuery('');
            f.setFilter('all');
          }}
        >
          Clear filters
        </button>
      </div>
      <div className="filter-bar">
        {(['all', 'advisory', 'watch', 'warning', 'unavailable'] as const).map(
          key => (
            <button
              key={key}
              className={'chip' + (f.filter === key ? ' active' : '')}
              onClick={() => f.setFilter(key)}
            >
              {key === 'all'
                ? 'All'
                : key === 'unavailable' ? 'Unavailable' : key[0].toUpperCase() + key.slice(1)}
            </button>

          ))}
      </div>
      <div className="location-list">
        {f.visibleNodes.length
          ? f.visibleNodes.map(
            n => (
              <article
                className={'node-card' + (n.id === f.selectedId ? ' selected' : '')}
                key={n.id}
              >
                <button
                  className="node-select"
                  onClick={() => f.selectNode(n.id)}
                >
                  <h3>{n.name}</h3>
                  <p>{n.area}</p>
                  <div className="node-meta">
                    <span
                      className="status-label"
                      style={{ '--status-color': f.getStatus(n).color } as CSSProperties}
                    >
                      {f.getStatus(n).short}
                    </span>
                    <span>{f.age(n)}</span>
                  </div>
                </button>
                <button
                  className={'node-save' + (f.saved.includes(n.id) ? ' is-saved' : '')}
                  aria-label={`${f.saved.includes(n.id) ? 'Unsave' : 'Save'} ${n.name}`}
                  aria-pressed={f.saved.includes(n.id)}
                  onClick={() => f.toggleSaved(n.id)}
                >
                  <Icon name="bookmark" />
                </button>
              </article>

            ))
          : (
            <div className="empty-state">
              <Icon name="search" />
              <h3>{!f.nodes.length ? 'No sensors yet' : 'No matching locations'}</h3>
              <p>
                {!f.nodes.length
                  ? (config.configured
                    ? 'No sensors registered yet. An authorized installer can add the first node.'
                    : 'Connect Supabase to register your first sensor. The map has no observations yet.')
                  : 'Save a location or clear the filters to see more monitoring points.'}
              </p>
            </div>
          )}
      </div>
      <div className="sidebar-footer">
        <Icon name="shield" />
        <p>
          Observations apply at each sensor.
          <br />
          <span>Not official warnings or road-passability advice.</span>
        </p>
      </div>
    </aside>
  );
}
