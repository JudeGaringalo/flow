'use client';

import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { useFlow } from '@/hooks/use-flow';
import { config } from '@/lib/config';
import { STATUS, clock } from '@/lib/core';
import { enablePush, disablePush } from '@/lib/push';
import * as api from '@/lib/supabase';
import type { IconName } from './icon';
import { Icon } from './icon';
import type { MapHandle, ModalKind, NodeInput, StatusKey } from '@/lib/types';

const TITLES: Record<ModalKind, string> = {
  menu: 'FLOW, your way',
  layers: 'Map layers',
  settings: 'Settings & connection',
  about: 'About Observations',
  install: 'Install FLOW',
  directions: 'Open directions',
  forecast: 'About these estimates',
  route: 'Recommended route',
  alerts: 'Your location alerts',
  follow: 'Stay informed here',
  'ai-info': 'How this summary works',
  admin: 'Node Administration',
  'node-form': 'Configure node',
  token: 'Save your device token',
  wifi: 'Connect a node to Wi-Fi'
};

export function Dialogs({ mapRef }: {
  mapRef: React.RefObject<MapHandle | null>;
}) {
  const f = useFlow(), dialog = useRef<HTMLDialogElement>(null);

  useEffect(
    () => {
      const d = dialog.current;
      if (!d)
        return;

      if (f.modal && !d.open)
        d.showModal();
      else if (!f.modal && d.open)
        d.close();
    },
    [f.modal]
  );

  return (
    <dialog
      ref={dialog}
      aria-labelledby="dialog-title"
      onCancel={() => f.setModal(null)}
      onClose={() => f.setModal(null)}
      onClick={
        e => {
          if (e.target !== e.currentTarget)
            return;

          const r = e.currentTarget.getBoundingClientRect();
          if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
            f.setModal(null);
        }
      }
    >
      <div className="dialog-head">
        <div>
          <span className="eyebrow">FLOOD-LEVEL OBSERVATION & WARNING</span>
          <h2 id="dialog-title">{f.modal ? TITLES[f.modal] : ''}</h2>
        </div>
        <button
          className="icon-btn"
          aria-label="Close dialog"
          onClick={() => f.setModal(null)}
        >
          <Icon name="x" />
        </button>
      </div>
      <div className="dialog-body">
        {f.modal && <Content
          key={f.modal}
          kind={f.modal}
          mapRef={mapRef}
        />}
      </div>
    </dialog>
  );
}

function Content({ kind, mapRef }: {
  kind: ModalKind;
  mapRef: React.RefObject<MapHandle | null>;
}) {
  const f = useFlow();
  if (kind === 'menu')
    return (
      <div className="menu-list">
        {([
          [
            'list',
            'Monitored locations',
            () => {
              f.setView('all');
              f.setListOpen(true);
              f.setModal(null);
            }
          ],
          [
            'bookmark',
            'Saved locations',
            () => {
              f.setView('saved');
              f.setListOpen(true);
              f.setModal(null);
            }
          ],
          ['settings', 'Settings & Connection', () => f.setModal('settings')],
          ['lock', 'Node Administration', () => f.setModal('admin')],
          ['download', 'Install FLOW', () => f.setModal('install')],
          ['info', 'About Observations', () => f.setModal('about')]
        ] as [
          IconName,
          string,
          () => void
        ][]).map(
          ([icon, label, action]) => (
            <button
              key={label}
              onClick={action}
            >
              <Icon name={icon} />
              {label}
              <Icon name="chevron" />
            </button>

          ))}
      </div>
    );

  if (kind === 'layers')
    return (
      <>
        <p>Markers represent monitored points, not the extent of flooding.</p>
        <div className="layer-options">
          {(['all', 'advisory', 'watch', 'warning', 'below', 'unavailable', 'fault'] as ('all' | StatusKey)[]).map(
            key => (
              <button
                className={'layer-option' + (f.filter === key ? ' active' : '')}
                aria-pressed={f.filter === key}
                key={key}
                onClick={() => f.setFilter(key)}
              >
                <span
                  className="status-dot"
                  style={{ background: key === 'all' ? '#076bba' : STATUS[key].color }}
                />
                {key === 'all' ? 'All nodes' : STATUS[key].short}
              </button>

            ))}
        </div>
        <Toggle
          label="Light map"
          description="Switch between light and dark appearance."
          checked={f.theme === 'light'}
          onChange={() => f.setTheme(f.theme === 'light' ? 'dark' : 'light')}
        />
        <button
          className="secondary-btn full"
          onClick={() => {
            mapRef.current?.fit();
            f.setModal(null);
          }}
        >
          <Icon name="expand" />
          {' '}
          Fit visible nodes
        </button>
      </>
    );

  if (kind === 'follow')
    return <FollowForm />;

  if (kind === 'alerts')
    return <Alerts />;

  if (kind === 'admin')
    return <Admin />;

  if (kind === 'node-form')
    return <NodeForm />;

  if (kind === 'settings')
    return <Settings />;

  if (kind === 'token')
    return (
      <>
        <p>
          <strong>{f.newToken?.id}</strong>
          {' '}
          has a new device token. Copy it now; the server stores only its hash.
        </p>
        <textarea
          className="token-output"
          readOnly
          value={f.newToken?.token || ''}
          aria-label="Device token"
        />
        <p className="note">
          Keep this token in this node&apos;s firmware or protected configuration. Do not
          commit it, put it in web code, or share it. Rotation invalidates the previous
          token.
        </p>
        <button
          className="primary-btn full"
          onClick={
            async () => {
              try {
                await navigator.clipboard.writeText(f.newToken?.token || '');
                f.notify('Device token copied.');
              }
              catch {
                f.notify('Select and copy the token manually.', true);
              }
            }
          }
        >
          <Icon name="copy" />
          {' '}
          Copy token
        </button>
      </>
    );

  if (kind === 'directions')
    return <Directions />;

  if (kind === 'route')
    return (
      <>
        <p>{'Flood-aware route calculation is not connected.'}</p>
        <Note>
          No route is being recommended for real travel. A FLOW node observes one point,
          not every street on a route.
        </Note>
        <button
          className="primary-btn full"
          onClick={() => f.setModal('directions')}
        >
          <Icon name="external" />
          {' '}
          Open standard map directions
        </button>
      </>
    );

  if (kind === 'forecast')
    return (
      <>
        <p>
          No continuous-depth, rainfall, route-forecast or recession service is connected.
        </p>
        <Note>
          <strong>Current sensor capability</strong>
          <br />
          The ESP32 prototype measures three discrete thresholds. Gemini explains approved
          observations; it does not calculate a validated time to Critical, predict
          recession, or confirm a safe route.
        </Note>
        <p>
          These unconnected fields remain unavailable. A future version needs
          independently validated data and models before showing actual estimates.
        </p>
      </>
    );

  if (kind === 'ai-info')
    return (
      <>
        <p>
          FLOW Intelligence helps interpret the selected node&apos;s current status,
          recent transitions and fresh nearby observations. Measured status is independent
          of AI.
        </p>
        <Note>
          {'The Next.js API fetches approved evidence. Gemini selects relevant fact IDs; the server assembles those verified sentences. A failed model call uses a clearly labeled fallback.'}
        </Note>
        <p>
          It does not infer rainfall, continuous depth, unmonitored streets, road safety
          or future water levels. Missing or stale information never becomes a current
          low-water report.
        </p>
      </>
    );

  if (kind === 'wifi')
    return (
      <>
        <p>
          Wi-Fi setup happens locally on the ESP32—not through the hosted map&apos;s
          Internet connection.
        </p>
        <ol className="setup-steps">
          <li>
            Put the node into its
            {' '}
            <strong>Wi-Fi setup mode</strong>
            .
          </li>
          <li>
            Connect your phone to the node&apos;s temporary
            {' '}
            <strong>FLOW-SETUP</strong>
            {' '}
            network.
          </li>
          <li>
            Open the local setup page and provide the 2.4 GHz router or hotspot credentials.
          </li>
          <li>
            Return to your normal Internet connection and verify the node reports a fresh
            reading.
          </li>
        </ol>
        <Note>
          The captive portal requires ESP32 firmware and is not implemented by this web
          project. Your existing Wi-Fi firmware can still send data through the documented
          ingestion endpoint. Never enter Wi-Fi passwords into the public map.
        </Note>
      </>
    );

  if (kind === 'install')
    return <InstallHelp />;

  return (
    <>
      <p>
        <strong>F.L.O.W.</strong>
        {' '}
        means Flood-Level Observation &amp; Warning. The public interface stays on the
        map, with current sensor facts first and contextual interpretation second.
      </p>
      <Note>
        Live observations are limited to the registered sensor locations. Follow
        official warnings and local instructions.
      </Note>
      <p>
        A below-threshold reading does not establish a dry road. An unavailable or
        faulty node cannot confirm a current flood condition. Notifications may be
        delayed or blocked.
      </p>
      <p>
        The initial device reports Levels 1–3 only. No simulated flood data is generated
        by this application.
      </p>
    </>
  );
}

function Note({ children }: {
  children: ReactNode;
}) {
  return (
    <div className="note">{children}</div>
  );
}

function Toggle({ label, description, checked, onChange }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="settings-row">
      <div>
        <h3>{label}</h3>
        <p>{description}</p>
      </div>
      <button
        className="toggle"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onChange}
      />
    </div>
  );
}

function Settings() {
  const f = useFlow();
  const [busy, setBusy] = useState(false);

  return (
    <>
      <Toggle
        label="Light appearance"
        description="Applies to the interface and map."
        checked={f.theme === 'light'}
        onChange={() => f.setTheme(f.theme === 'light' ? 'dark' : 'light')}
      />
      <dl>
        {[
          ['App mode', 'Live only'],
          [
            'Data connection',
            config.configured
              ? (f.offline ? 'Unavailable' : f.connection)
              : 'Not configured'
          ],
          ['Supabase', config.supabaseUrl || 'Not configured'],
          ['Map mode', config.mapMode],
          ['Stale after', '120 seconds without a fresh report']
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
      {f.connectionError && (
        <p
          className="error-text"
          role="alert"
        >
          {f.connectionError}
        </p>
      )}
      <p className="note">
        Production connection values are set in your Vercel environment variables.
        Gemini and privileged database keys remain in private server environment
        variables.
      </p>
      {<button
        className="secondary-btn full"
        onClick={() => void f.refreshLive()}
      >
        <Icon name="refresh" />
        {' '}
        Refresh live observations
      </button>}
      <button
        className="text-btn spaced"
        disabled={busy}
        onClick={
          async () => {
            setBusy(true);
            try {
              await disablePush();
              f.notify('Browser push subscription removed.');
            }
            catch (e) {
              f.notify(e instanceof Error ? e.message : 'Could not unsubscribe.', true);
            }
            finally {
              setBusy(false);
            }
          }
        }
      >
        Disable this browser&apos;s background push
      </button>
    </>
  );
}

function FollowForm() {
  const f = useFlow(), n = f.selected;
  const [min, setMin] = useState<1 | 2 | 3>(n ? f.follows[n.id]?.min_level || 2 : 2),
    [busy, setBusy] = useState(false),
    [pushBusy, setPushBusy] = useState(false),
    [result, setResult] = useState(''),
    [error, setError] = useState('');
  if (!n)
    return (
      <p>Select a node first.</p>
    );

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!n)
      return;

    setBusy(true);
    setError('');
    try {
      await f.follow(n.id, min);
    }
    catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save preference.');
    }
    finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p>
        Choose when to receive alerts for
        {' '}
        <strong>{n.name}</strong>
        . Alerts describe observations at this node, not road passability.
      </p>
      <form onSubmit={save}>
        {([1, 2, 3] as const).map(
          level => (
            <label
              className="radio-option"
              key={level}
            >
              <input
                type="radio"
                name="threshold"
                checked={min === level}
                onChange={() => setMin(level)}
              />
              <span>
                <b>
                  {['', 'Advisory or higher', 'Watch or higher', 'Warning only'][level]}
                </b>
                <small>
                  {level === 3
                    ? 'When Level 3 is reached'
                    : `Valid increases at or above Level ${level}`}
                </small>
              </span>
              <span
                className="status-dot"
                style={
                  { background: STATUS[(['below', 'advisory', 'watch', 'warning'] as const)[level]].color }
                }
              />
            </label>

          ))}
        <Note>
          {'Web Push requires permission, a configured push backend and a supported browser. Save your preference, then enable browser push.'}
          <br />
          On iPhone/iPad, add FLOW to the Home Screen and open it there before enabling
          notifications.
        </Note>
        <div className="dialog-actions">
          {f.follows[n.id]
            && (
              <button
                type="button"
                className="danger-btn"
                disabled={busy}
                onClick={
                  async () => {
                    setBusy(true);
                    try {
                      await f.follow(n.id, null);
                      f.setModal(null);
                    }
                    catch (e) {
                      setError(e instanceof Error ? e.message : 'Could not remove preference.');
                    }
                    finally {
                      setBusy(false);
                    }
                  }
                }
              >
                Stop alerts
              </button>
            )}
          <button
            type="submit"
            className="primary-btn"
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Save alert preference'}
          </button>
        </div>
        {error && (
          <p
            className="error-text"
            role="alert"
          >
            {error}
          </p>
        )}
      </form>
      <button
        className="text-btn spaced"
        disabled={pushBusy}
        onClick={
          async () => {
            setPushBusy(true);
            setResult('');
            try {
              setResult(await enablePush(n.id));
            }
            catch (e) {
              setResult(e instanceof Error ? e.message : 'Could not enable push.');
            }
            finally {
              setPushBusy(false);
            }
          }
        }
      >
        <Icon name="bell" />
        {pushBusy ? 'Enabling…' : 'Enable browser push notifications'}
      </button>
      {result && (
        <p
          className="push-result"
          role="status"
        >
          {result}
        </p>
      )}
    </>
  );
}

function Alerts() {
  const f = useFlow();

  useEffect(() => {
    f.setActivity(a => a.map(i => ({
      ...i,
      read: true
    })));
  }, []);

  return (
    <>
      <p>
        {'Activity observed in this browser. Background push has its own delivery path.'}
      </p>
      <h3>Followed locations</h3>
      {Object.keys(f.follows).length
        ? Object.entries(f.follows)
          .map(
            ([id, pref]) => (
              <div
                className="admin-node-row"
                key={id}
              >
                <div>
                  <strong>{f.nodes.find(n => n.id === id)?.name || id}</strong>
                  <small>
                    Level
                    {' '}
                    {pref.min_level}
                    {' '}
                    or higher
                  </small>
                </div>
                <button
                  className="text-btn"
                  onClick={() => {
                    f.selectNode(id);
                    f.setModal('follow');
                  }}
                >
                  Edit
                </button>
              </div>

            ))
        : (
          <Note>
            Tap a map marker, then choose Get alerts to follow a monitoring point.
          </Note>
        )}
      <h3>Recent activity</h3>
      {f.activity.length
        ? f.activity.map(
          a => (
            <article
              className="activity-item"
              key={a.id}
            >
              <Icon name="bell" />
              <div>
                <b>{a.name}</b>
                <p>{a.text}</p>
                <time>{clock(a.at)}</time>
                <button
                  className="text-btn"
                  onClick={() => f.selectNode(a.node_id)}
                >
                  View on map
                </button>
              </div>
            </article>

          ))
        : (
          <div className="empty-state">
            <Icon name="bell" />
            <p>No new activity here yet.</p>
          </div>
        )}
      {f.activity.length > 0
        && (
          <button
            className="text-btn spaced"
            onClick={() => f.setActivity([])}
          >
            Clear local activity
          </button>
        )}
    </>
  );
}

function Admin() {
  const f = useFlow(),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  if (!f.admin)
    return (
      <>
        <p>
          The public map needs no account. Only authorized installers can register or edit
          nodes.
        </p>
        <form
          onSubmit={
            async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                const u = await api.login(email, password);
                f.setAdmin(u);
                setPassword('');
              }
              catch (e) {
                setError(e instanceof Error ? e.message : 'Sign-in failed.');
              }
              finally {
                setBusy(false);
              }
            }
          }
        >
          <label className="field">
            <span>Email address</span>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <button
            className="primary-btn full"
            disabled={busy}
            type="submit"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          {error && (
            <p
              className="error-text"
              role="alert"
            >
              {error}
            </p>
          )}
        </form>
      </>
    );

  return (
    <>
      <p>{`Signed in as ${f.admin?.email}.`}</p>
      <div className="dialog-actions start">
        <button
          className="primary-btn"
          onClick={() => {
            f.setEditing(null);
            f.setModal('node-form');
          }}
        >
          <Icon name="plus" />
          {' '}
          Register node
        </button>
        <button
          className="secondary-btn"
          onClick={() => f.setModal('wifi')}
        >
          <Icon name="wifi" />
          {' '}
          Wi-Fi setup
        </button>
      </div>
      {f.nodes.map(
        n => (
          <div
            className="admin-node-row"
            key={n.id}
          >
            <div>
              <strong>{n.name}</strong>
              <small>{n.id}</small>
            </div>
            <button
              className="text-btn"
              onClick={() => {
                f.setEditing(n);
                f.setModal('node-form');
              }}
            >
              <Icon name="edit" />
              {' '}
              Edit
            </button>
          </div>

        ))}
      {<button
        className="text-btn spaced"
        onClick={
          async () => {
            try {
              const db = await api.getSupabase();
              await db.auth.signOut();
              f.setAdmin(null);
              f.notify('Signed out.');
            }
            catch {
              f.notify('Sign-out failed.', true);
            }
          }
        }
      >
        <Icon name="logout" />
        {' '}
        Sign out
      </button>}
    </>
  );
}

function NodeForm() {
  const f = useFlow(),
    existing = !!f.editing && f.nodes.some(n => n.id === f.editing?.id);
  const [v, setV] = useState<NodeInput>(f.editing || {
    id: '',
    name: '',
    area: '',
    latitude: NaN,
    longitude: NaN
  }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const patch = (key: keyof NodeInput, value: string | number) => setV(a => ({
    ...a,
    [key]: value
  }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!/^[A-Z0-9-]{3,40}$/.test(v.id)) {
      setError('Use 3–40 uppercase letters, digits or hyphens for the node ID.');
      return;
    }

    if (!Number.isFinite(v.latitude) || Math.abs(v.latitude) > 90 || !Number.isFinite(v.longitude)
      || Math.abs(v.longitude) > 180) {
      setError('Enter valid coordinates.');
      return;
    }

    setBusy(true);
    try {
      await f.saveNode(v, existing ? v.id : undefined);
    }
    catch (e) {
      setError(e instanceof Error ? e.message : 'Node could not be saved.');
    }
    finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p>
        {existing
          ? 'Edit this installation.'
          : 'Register a fixed location. A new node remains unavailable until its first real observation.'}
      </p>
      <form onSubmit={submit}>
        <label className="field">
          <span>Device ID</span>
          <input
            required
            maxLength={40}
            value={v.id}
            disabled={existing}
            onChange={e => patch('id', e.target.value.toUpperCase())}
          />
        </label>
        <label className="field">
          <span>Location name</span>
          <input
            required
            maxLength={80}
            placeholder="e.g. Main entrance"
            value={v.name}
            onChange={e => patch('name', e.target.value)}
          />
        </label>
        <label className="field">
          <span>Area</span>
          <input
            maxLength={100}
            placeholder="City, Metro Manila"
            value={v.area}
            onChange={e => patch('area', e.target.value)}
          />
        </label>
        <div className="field-grid">
          <label className="field">
            <span>Latitude</span>
            <input
              required
              type="number"
              step="any"
              min={-90}
              max={90}
              value={Number.isFinite(v.latitude) ? v.latitude : ''}
              onChange={e => patch('latitude', e.target.value === '' ? NaN : Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>Longitude</span>
            <input
              required
              type="number"
              step="any"
              min={-180}
              max={180}
              value={Number.isFinite(v.longitude) ? v.longitude : ''}
              onChange={e => patch('longitude', e.target.value === '' ? NaN : Number(e.target.value))}
            />
          </label>
        </div>
        <div className="dialog-actions start">
          <button
            className="secondary-btn"
            type="button"
            onClick={() => {
              f.setPicking(v);
              f.closeDetails();
              f.setModal(null);
            }}
          >
            <Icon name="map-pin" />
            {' '}
            Pick on map
          </button>
          <button
            className="secondary-btn"
            type="button"
            onClick={
              () => {
                if (!navigator.geolocation) {
                  setError('Location access is not available.');
                  return;
                }

                navigator.geolocation.getCurrentPosition(
                  p => {
                    setV(
                      a => ({
                        ...a,
                        latitude: Number(p.coords.latitude.toFixed(6)),
                        longitude: Number(p.coords.longitude.toFixed(6))
                      })
                    );
                  },
                  () => setError('Location permission denied or unavailable. Enter coordinates manually.'),
                  {
                    enableHighAccuracy: true,
                    timeout: 12000
                  }
                );
              }
            }
          >
            <Icon name="locate" />
            {' '}
            Use my location
          </button>
        </div>
        <Note>
          Verify the pin at the actual installation. A phone&apos;s position is not
          necessarily the sensor&apos;s position. Use the actual installation coordinates.
        </Note>
        <button
          className="primary-btn full"
          type="submit"
          disabled={busy}
        >
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Register node'}
        </button>
        {error && (
          <p
            className="error-text"
            role="alert"
          >
            {error}
          </p>
        )}
      </form>
      {existing
        && (
          <button
            className="danger-btn spaced"
            onClick={
              async () => {
                if (!window.confirm('Rotate this node’s token? Its previous token will stop working.'))
                  return;

                try {
                  await f.rotateToken(v.id);
                }
                catch (e) {
                  setError(e instanceof Error ? e.message : 'Rotation failed.');
                }
              }
            }
          >
            Rotate device token
          </button>
        )}
    </>
  );
}

function Directions() {
  const f = useFlow(), n = f.selected;
  if (!n)
    return (
      <p>Select a location first.</p>
    );

  const url = `https://www.google.com/maps/dir/?api=1&destination=${n.latitude},${n.longitude}&travelmode=driving`;

  return (
    <>
      <p>
        Open Google Maps for
        {' '}
        <strong>{n.name}</strong>
        .
      </p>
      <div className="route-note">
        <strong>This is a monitoring point, not a safe destination.</strong>
        <br />
        FLOW does not verify road passability or send its observations to the routing
        provider. Follow official closures and local advice.
      </div>
      <div className="dialog-actions">
        <button
          className="secondary-btn"
          onClick={() => f.setModal(null)}
        >
          Stay on FLOW
        </button>
        <a
          className="primary-btn"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Google Maps
          {' '}
          <Icon name="external" />
        </a>
      </div>
    </>
  );
}

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: string;
  }>;
}

let installEvent: InstallPrompt | null = null;

export function PwaRegistration() {
  useEffect(
    () => {
      const capture = (e: Event) => {
        e.preventDefault();
        installEvent = e as InstallPrompt;
      };
      window.addEventListener('beforeinstallprompt', capture);
      if ('serviceWorker' in navigator && window.isSecureContext)
        void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { });

      return () => window.removeEventListener('beforeinstallprompt', capture);
    },
    []
  );
  return null;
}

function InstallHelp() {
  const f = useFlow();

  return (
    <>
      <p>
        Install the same web application on your Home Screen. Your map and location
        preferences stay in this browser.
      </p>
      <ol className="setup-steps">
        <li>
          <strong>iPhone/iPad:</strong>
          {' '}
          Share → Add to Home Screen, then open FLOW from that icon.
        </li>
        <li>
          <strong>Android:</strong>
          {' '}
          Browser menu → Install app or Add to Home Screen.
        </li>
        <li>
          <strong>Desktop:</strong>
          {' '}
          Use the browser&apos;s install icon when available.
        </li>
      </ol>
      <Note>
        Installation does not guarantee notification delivery. Permission,
        operating-system settings and network access still apply. Offline pages cannot
        report current flood conditions.
      </Note>
      <button
        className="primary-btn full"
        onClick={
          async () => {
            if (installEvent) {
              await installEvent.prompt();
              await installEvent.userChoice;
              installEvent = null;
            }
            else
              f.notify('Use your browser’s Install app or Add to Home Screen option.');
          }
        }
      >
        <Icon name="download" />
        {' '}
        Install FLOW
      </button>
    </>
  );
}
