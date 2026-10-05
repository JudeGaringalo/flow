'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useFlow } from '@/hooks/use-flow';
import { BASEMAPS } from '@/lib/map-styles';
import { STATUS } from '@/lib/core';
import type { MappedEvacuationSite } from '@/lib/evacuation-sites';
import type { HazardScenario, HazardState } from './map-canvas';
import { Icon } from './icon';
import { AlertSettings } from './alert-settings';
import { NodeWeatherPanel } from './node-weather-panel';
import type { NodeWeatherState } from '@/hooks/use-node-weather';
import type { MapHandle, ModalKind, StatusKey } from '@/lib/types';
import type { HelpReportsState } from '@/hooks/use-help-reports';
import { HelpReportPanel } from './help-report-panel';

const TITLES: Record<ModalKind, string> = {
  menu: 'FLOW', layers: 'Map layers & Settings', about: 'About observations',
  install: 'Install FLOW', directions: 'Evacuation directions', alerts: 'Nearby alerts',
  evacuation: 'Mapped evacuation sites',
  weather: 'Weather outlook',
  report: 'Report / Request help',
};

interface DialogProps {
  helpReports: HelpReportsState;
  weather: NodeWeatherState;
  mapRef: React.RefObject<MapHandle | null>;
  evacuationSites: MappedEvacuationSite[];
  showEvacuationSites: boolean;
  setShowEvacuationSites: (visible: boolean) => void;
  showHazard: boolean;
  setShowHazard: (visible: boolean) => void;
  hazardScenario: HazardScenario;
  setHazardScenario: (scenario: HazardScenario) => void;
  hazardState: HazardState;
  siteState: 'loading' | 'ready' | 'error';
  onRetrySites: () => void;
  onSelectEvacuation: (id: string) => void;
}

export function Dialogs(props: DialogProps) {
  const f = useFlow();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (f.modal && !element.open) element.showModal();
    else if (!f.modal && element.open) element.close();
  }, [f.modal]);

  return (
    <dialog ref={dialog} className={f.modal === 'weather' ? 'weather-dialog' : undefined}
      aria-labelledby="dialog-title" onCancel={() => f.setModal(null)}
      onClose={() => f.setModal(null)}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right ||
            event.clientY < rect.top || event.clientY > rect.bottom) f.setModal(null);
      }}>
      <div className="dialog-head">
        <div><h2 id="dialog-title">{f.modal ? TITLES[f.modal] : ''}</h2></div>
        <button className="icon-btn" aria-label="Close dialog" onClick={() => f.setModal(null)}>
          <Icon name="x" />
        </button>
      </div>
      <div className="dialog-body">
        {f.modal && <Content key={f.modal} kind={f.modal} {...props} />}
      </div>
    </dialog>
  );
}

function Content({ kind, weather, helpReports, mapRef, evacuationSites, showEvacuationSites,
  setShowEvacuationSites, showHazard, setShowHazard,
  hazardScenario, setHazardScenario, hazardState,
  siteState, onRetrySites, onSelectEvacuation }:
  DialogProps & { kind: ModalKind }) {
  const f = useFlow();
  if (kind === 'menu') return <Menu />;
  if (kind === 'report') return <HelpReportPanel state={helpReports} onView={id => {
    f.setModal(null);
    requestAnimationFrame(() => mapRef.current?.focusHelpReport(id));
  }} />;
  if (kind === 'weather') return f.selected
    ? <NodeWeatherPanel key={`${f.selected.id}:${f.selected.latitude}:${f.selected.longitude}`}
      node={f.selected} weather={weather} /> : <p>Select a monitoring point to see its weather.</p>;
  if (kind === 'evacuation') return <EvacuationDirectory sites={evacuationSites}
    state={siteState} onRetry={onRetrySites} onSelect={onSelectEvacuation} />;
  if (kind === 'layers') return (
    <>
      <p>Choose a map view. Street and place labels use the same source in every view.</p>
      <div className="basemap-options">
        {BASEMAPS.map(({ id, label, description }) => (
          <button key={id} className={'basemap-option basemap-' + id + (f.basemap === id ? ' active' : '')}
            aria-pressed={f.basemap === id} onClick={() => f.setBasemap(id)}>
            <span className="basemap-preview" aria-hidden="true" />
            <span><strong>{label}</strong><small>{description}</small></span>
            {f.basemap === id && <Icon name="check" />}
          </button>
        ))}
      </div>
      <h3>Flood hazard</h3>
      <p>Modeled flood areas for the selected rainfall scenario. This is not live flooding.</p>
      <div className="segmented" role="group" aria-label="Flood rainfall scenario">
        {(['5yr', '100yr'] as const).map(scenario => (
          <button key={scenario} type="button" className={hazardScenario === scenario ? 'active' : ''}
            aria-pressed={hazardScenario === scenario}
            onClick={() => setHazardScenario(scenario)}>
            {scenario === '100yr' ? '100-year' : '5-year'}
          </button>
        ))}
      </div>
      <button className="hazard-layer-toggle" type="button" aria-pressed={showHazard}
        onClick={() => setShowHazard(!showHazard)}>
        <span className="hazard-toggle-colors" aria-hidden="true"><i /><i /><i /></span>
        <span><strong>{showHazard ? 'Hide hazard map' : 'Show hazard map'}</strong>
          <small>Low · Medium · High</small></span>
        <span className="hazard-toggle-state">{showHazard ? 'On' : 'Off'}</span>
      </button>
      {showHazard && hazardState === 'unavailable' &&
        <p role="status">The hazard source is unavailable. Try again later.</p>}
      <p className="hazard-source">Map data: © NOAH (
        <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank"
          rel="noopener noreferrer">ODbL</a>). Coverage and detail vary by area.
        Sensor markers continue to report live observations separately.</p>
      <h3>Evacuation sites</h3>
      <p>Recorded candidate sites across NCR. Opening status and flood safety are not verified.</p>
      <button className="evacuation-layer-toggle" type="button"
        aria-pressed={showEvacuationSites}
        onClick={() => setShowEvacuationSites(!showEvacuationSites)}>
        <span className="evacuation-key-dot" aria-hidden="true"><Icon name="shelter" /></span>
        {showEvacuationSites ? 'Hide mapped sites' : 'Show mapped sites'}
        <strong>{evacuationSites.length}</strong>
      </button>
      <button className="text-btn" type="button" onClick={() => f.setModal('evacuation')}>
        Browse mapped sites <Icon name="chevron" />
      </button>
      <h3>FLOW markers</h3>
      <p>Filter monitoring points without changing the basemap.</p>
      <div className="layer-options">
        {(['all', 'advisory', 'watch', 'warning', 'below', 'unavailable', 'fault'] as ('all' | StatusKey)[])
          .map(key => (
            <button key={key} className={'layer-option' + (f.filter === key ? ' active' : '')}
              aria-pressed={f.filter === key} onClick={() => f.setFilter(key)}>
              <span className="status-dot" style={{ background: key === 'all' ? '#076bba' : STATUS[key].color }} />
              {key === 'all' ? 'All nodes' : STATUS[key].short}
            </button>
          ))}
      </div>
      <button className="secondary-btn full" onClick={() => { mapRef.current?.fit(); f.setModal(null); }}>
        <Icon name="expand" />{f.visibleNodes.length ? 'Fit visible nodes' : 'Show Philippines'}
      </button>
    </>
  );
  if (kind === 'directions') return <Directions />;
  if (kind === 'alerts') return <AlertSettings />;
  if (kind === 'install') return <InstallHelp />;
  return (
    <>
      <p><strong>F.L.O.W.</strong> means Flood-Level Observation &amp; Warning.
        The map shows the latest report at registered monitoring locations.</p>
      <Note>Readings are limited to those locations. Follow official warnings and local instructions.</Note>
      <p>A below-threshold reading does not establish a dry road. An unavailable or faulty
        sensor cannot confirm the current condition. FLOW does not measure continuous depth or rainfall.</p>
      <p>The device reports three threshold levels. The optional NOAH hazard layer depicts
        a modeled rainfall scenario; it is separate from live observations.</p>
      <p className="map-data-credit">Streets and labels: OpenFreeMap, OpenMapTiles and OpenStreetMap contributors.
        Satellite imagery: Esri and its imagery contributors.</p>
      <p className="map-data-credit">Walking routes: <a href="https://routing.openstreetmap.de/about.html"
        target="_blank" rel="noopener noreferrer">OSRM/FOSSGIS</a>, using © <a
          href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
          OpenStreetMap contributors</a> · <a href="https://www.openstreetmap.org/fixthemap"
          target="_blank" rel="noopener noreferrer">Fix the map</a>.
        Your location and destination are sent to the routing service. Routes do not verify flooding or site opening.</p>
    </>
  );
}

function EvacuationDirectory({ sites, state, onRetry, onSelect }: {
  sites: MappedEvacuationSite[];
  state: 'loading' | 'ready' | 'error';
  onRetry: () => void;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const term = query.trim().toLowerCase();
  const matches = term ? sites.filter(site =>
    `${site.name} ${site.city}`.toLowerCase().includes(term)) : sites;
  return <div className="evacuation-directory">
    <p>Saved site locations, initially from OpenStreetMap. The list may be incomplete or outdated.
      Confirm a site is open and your route is safe with your local disaster office.</p>
    {state === 'loading' && <p role="status">Loading recorded sites…</p>}
    {state === 'error' && <div role="status">
      <p>Site data could not load. Check your connection and try again.</p>
      <button type="button" className="secondary-btn" onClick={onRetry}>Retry site map</button>
    </div>}
    {state === 'ready' && <>
      <label htmlFor="evacuation-search">Search {sites.length} mapped sites</label>
      <input id="evacuation-search" type="search" value={query}
        placeholder="Name or city" onChange={event => setQuery(event.target.value)} />
      {matches.length === 0 && <p role="status">{sites.length ? 'No matching mapped sites.' : 'No sites have been recorded yet.'}</p>}
      {matches.length > 0 && <div className="evacuation-directory-list">
        {matches.slice(0, 80).map(site => <button type="button" key={site.id}
          onClick={() => onSelect(site.id)}>
          <Icon name="shelter" />
          <span><strong>{site.name}</strong><small>{site.city}</small></span>
          <Icon name="chevron" />
        </button>)}
      </div>}
      {matches.length > 80 && <p>Showing 80 of {matches.length}. Search by name or city for more.</p>}
    </>}
    <p className="evacuation-directory-credit">Initial site data: © OpenStreetMap contributors (ODbL).</p>
  </div>;
}

function Menu() {
  const f = useFlow();
  const installed = useInstalledApp();
  return (
    <div className="menu-list">
      <button type="button" onClick={() => f.setModal('report')}>
        <Icon name="help-person" />Report / Request help<Icon name="chevron" />
      </button>
      {!installed && <button type="button" onClick={() => f.setModal('install')}>
        <Icon name="download" />Install FLOW<Icon name="chevron" />
      </button>}
      <button type="button" onClick={() => f.setModal('about')}>
        <Icon name="info" />About observations<Icon name="chevron" />
      </button>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <div className="note">{children}</div>;
}

function Directions() {
  const f = useFlow();
  return (
    <>
      <p>Select an evacuation center on the map, then choose <strong>Get Directions</strong>
        to draw a route from your current location.</p>
      <button type="button" className="primary-btn" onClick={() => f.setModal('evacuation')}>
        <Icon name="shelter" />Choose an evacuation center
      </button>
    </>
  );
}

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
let installEvent: InstallPrompt | null = null;
const INSTALL_PROMPT_CHANGED = 'flow-install-prompt-changed';

function setInstallEvent(event: InstallPrompt | null) {
  installEvent = event;
  window.dispatchEvent(new Event(INSTALL_PROMPT_CHANGED));
}

interface InstallNavigator extends Navigator {
  standalone?: boolean;
  getInstalledRelatedApps?: () => Promise<Array<{ platform: string }>>;
}

function useInstalledApp() {
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    let active = true;
    let request = 0;
    const check = async () => {
      const current = ++request;
      const browser = navigator as InstallNavigator;
      if (window.matchMedia('(display-mode: standalone)').matches || browser.standalone) {
        if (active) setInstalled(true);
        return;
      }
      try {
        const apps = await browser.getInstalledRelatedApps?.();
        if (active && current === request) setInstalled(apps?.some(app => app.platform === 'webapp') ?? false);
      } catch {
        if (active && current === request) setInstalled(false);
      }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    const onInstalled = () => { request++; setInstalled(true); };
    void check();
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      active = false;
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  return installed;
}

export function PwaRegistration() {
  useEffect(() => {
    const capture = (event: Event) => { event.preventDefault(); setInstallEvent(event as InstallPrompt); };
    const installed = () => { setInstallEvent(null); };
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', installed);
    if ('serviceWorker' in navigator && window.isSecureContext) {
      if (process.env.NODE_ENV === 'production') {
        void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
      } else {
        void navigator.serviceWorker.getRegistrations().then(async registrations => {
          for (const registration of registrations) {
            const worker = registration.active || registration.waiting || registration.installing;
            if (worker && new URL(worker.scriptURL).pathname === '/sw.js') await registration.unregister();
          }
          if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.filter(key => key.startsWith('flow-next-shell-') || key.startsWith('flow-shell-'))
              .map(key => caches.delete(key)));
          }
        }).catch(() => {});
      }
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', capture);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);
  return null;
}

function InstallHelp() {
  const f = useFlow();
  const installed = useInstalledApp();
  const [canPrompt, setCanPrompt] = useState(false);
  const [platform, setPlatform] = useState<'ios' | 'android' | 'other' | null>(null);

  useEffect(() => {
    const update = () => setCanPrompt(installEvent !== null);
    update();
    window.addEventListener(INSTALL_PROMPT_CHANGED, update);
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    setPlatform(ios ? 'ios' : /Android/i.test(navigator.userAgent) ? 'android' : 'other');
    return () => window.removeEventListener(INSTALL_PROMPT_CHANGED, update);
  }, []);

  if (installed) return <p>FLOW is already installed on this device. Open it from your apps.</p>;

  return (
    <>
      <p>Install this web app on your Home Screen to open the same public monitoring map.</p>
      <ol className="setup-steps">
        <li><strong>iPhone/iPad:</strong> In Safari, Share → Add to Home Screen, then open FLOW from the icon.</li>
        <li><strong>Android:</strong> Browser menu → Install app or Add to Home Screen.</li>
        <li><strong>Desktop:</strong> Use the browser&apos;s install icon when available.</li>
      </ol>
      {!canPrompt && platform === 'android' &&
        <Note>If you just uninstalled FLOW, refresh this tab to let your browser check again. If it still offers to open the installed app, check Settings → Apps → FLOW → Uninstall. You do not need to clear browser data.</Note>}
      {platform === 'ios' &&
        <Note>If you removed FLOW from the Home Screen but did not delete it, check App Library and choose Delete App before adding it again.</Note>}
      {!canPrompt && platform === 'other' &&
        <Note>If you just uninstalled FLOW, refresh this tab to let your browser check again.</Note>}
      <Note>Offline pages cannot report current flood conditions. Reconnect to see the latest sensor readings.</Note>
      {platform && platform !== 'ios' && <button className="primary-btn full" onClick={async () => {
        const prompt = installEvent;
        if (!prompt) {
          window.location.reload();
          return;
        }
        setInstallEvent(null);
        try {
          await prompt.prompt();
          const choice = await prompt.userChoice;
          if (choice.outcome === 'dismissed') {
            f.notify('Installation cancelled. Refresh the page before trying again.');
          }
        } catch {
          f.notify('Install prompt unavailable. Refresh the page and use your browser’s install menu.', true);
        }
      }}>
        <Icon name="download" />{canPrompt ? 'Install FLOW' : 'Refresh install options'}
      </button>}
    </>
  );
}
