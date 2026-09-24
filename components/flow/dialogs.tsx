'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useFlow } from '@/hooks/use-flow';
import { BASEMAPS } from '@/lib/map-styles';
import { STATUS } from '@/lib/core';
import { Icon } from './icon';
import type { MapHandle, ModalKind, StatusKey } from '@/lib/types';

const TITLES: Record<ModalKind, string> = {
  menu: 'FLOW', layers: 'Map layers', about: 'About observations',
  install: 'Install FLOW', directions: 'Open directions'
};

export function Dialogs({ mapRef }: { mapRef: React.RefObject<MapHandle | null> }) {
  const f = useFlow();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (f.modal && !element.open) element.showModal();
    else if (!f.modal && element.open) element.close();
  }, [f.modal]);

  return (
    <dialog ref={dialog} aria-labelledby="dialog-title" onCancel={() => f.setModal(null)}
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
        {f.modal && <Content key={f.modal} kind={f.modal} mapRef={mapRef} />}
      </div>
    </dialog>
  );
}

function Content({ kind, mapRef }: { kind: ModalKind; mapRef: React.RefObject<MapHandle | null> }) {
  const f = useFlow();
  if (kind === 'menu') return <Menu />;
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
  if (kind === 'install') return <InstallHelp />;
  return (
    <>
      <p><strong>F.L.O.W.</strong> means Flood-Level Observation &amp; Warning.
        The map shows the latest report at registered ESP32 sensor locations.</p>
      <Note>Readings are limited to those locations. Follow official warnings and local instructions.</Note>
      <p>A below-threshold reading does not establish a dry road. An unavailable or faulty
        sensor cannot confirm the current condition. FLOW does not measure continuous depth or rainfall.</p>
      <p>The device reports three threshold levels. No simulated flood data is shown.</p>
      <p className="map-data-credit">Streets and labels: OpenFreeMap, OpenMapTiles and OpenStreetMap contributors.
        Satellite imagery: Esri and its imagery contributors. Source credits also appear on the map.</p>
    </>
  );
}

function Menu() {
  const f = useFlow();
  const installed = useInstalledApp();
  return (
    <div className="menu-list">
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
  const node = f.selected;
  if (!node) return <p>Select a location first.</p>;
  const url = `https://www.google.com/maps/dir/?api=1&destination=${node.latitude},${node.longitude}&travelmode=driving`;
  return (
    <>
      <p>Open Google Maps for <strong>{node.name}</strong>.</p>
      <div className="route-note">
        <strong>This is a monitoring point, not a safe destination.</strong><br />
        FLOW does not verify road passability or share sensor readings with the routing provider.
        Follow official closures and local advice.
      </div>
      <div className="dialog-actions">
        <button className="secondary-btn" onClick={() => f.setModal(null)}>Stay on FLOW</button>
        <a className="primary-btn" href={url} target="_blank" rel="noopener noreferrer">
          Open Google Maps <Icon name="external" />
        </a>
      </div>
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
