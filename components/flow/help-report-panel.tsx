'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { HELP_REPORT_HOURS, helpReportTime, validHelpLocation, type HelpLocation, type HelpReport } from '@/lib/help-reports';
import type { HelpReportsState } from '@/hooks/use-help-reports';
import { Icon } from './icon';

export function HelpReportPanel({ state, onView }: {
  state: HelpReportsState;
  onView: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [location, setLocation] = useState<HelpLocation | null>(null);
  const [consent, setConsent] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [editing, setEditing] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const disabled = state.busy || locating;

  function locate() {
    if (!navigator.geolocation) { setLocationError('Location access is unavailable in this browser.'); return; }
    setLocating(true);
    setLocationError('');
    setConsent(false);
    setLocation(null);
    navigator.geolocation.getCurrentPosition(position => {
      if (!mounted.current) return;
      setLocating(false);
      const next = {
        latitude: position.coords.latitude, longitude: position.coords.longitude,
        accuracy: position.coords.accuracy, located_at: new Date(position.timestamp).toISOString(),
      };
      if (!validHelpLocation(next)) {
        setLocationError('Your location is outside the Philippines map area or could not be measured. Try again.');
        return;
      }
      setLocation(next);
    }, cause => {
      if (!mounted.current) return;
      setLocating(false);
      setLocationError(cause.code === 1
        ? 'Allow location access in your browser settings, then try again.'
        : 'Your location could not be found. Move somewhere with a clearer signal if possible, then try again.');
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
  }

  async function publish(event: FormEvent) {
    event.preventDefault();
    if (!location || !consent || disabled) return;
    if (Date.now() - Date.parse(location.located_at) > 300000) {
      setLocationError('Your location is out of date. Use Find my location again.');
      setConsent(false);
      return;
    }
    if (await state.publish({ ...location, name, message, consent })) {
      if (!mounted.current) return;
      setEditing(false);
      setLocation(null);
      setConsent(false);
    }
  }

  const others = state.reports.filter(report => report.id !== state.ownId);
  return <div className="help-panel">
    <p>Let people on FLOW see that you need help. This does not contact emergency services or confirm that help is coming.</p>
    {state.own && !editing ? <section className="help-current" aria-label="Your active help request">
      <div className="help-current-title"><Icon name="help-person" /><h3>Your request is on the map</h3></div>
      <ReportDetails report={state.own} />
      <div className="help-actions">
        <button type="button" className="secondary-btn" onClick={() => onView(state.own!.id)}>View on map</button>
        <button type="button" className="secondary-btn" disabled={state.busy} onClick={() => {
          setName(state.own!.name); setMessage(state.own!.message);
          setLocation(null); setConsent(false); setEditing(true);
        }}>Update request</button>
      </div>
      <button type="button" className="primary-btn" disabled={state.busy}
        onClick={() => void state.resolve()}>{state.busy ? 'Removing…' : 'Resolved — remove my request'}</button>
    </section> : <form className="help-form" onSubmit={event => void publish(event)}>
      <label htmlFor="help-name">Name or nickname <span>(optional)</span></label>
      <input id="help-name" name="name" autoComplete="nickname" maxLength={60}
        value={name} onChange={event => setName(event.target.value)} disabled={disabled} />
      <label htmlFor="help-message">What help do you need? <span>(optional)</span></label>
      <textarea id="help-message" name="message" rows={3} maxLength={280}
        placeholder="Example: Two people need help on the second floor."
        value={message} onChange={event => setMessage(event.target.value)} disabled={disabled} />
      <button type="button" className="secondary-btn help-locate" disabled={disabled} onClick={locate}>
        <Icon name="map-pin" />{locating ? 'Finding your location…' : 'Find my location'}
      </button>
      {location && <div className="help-location" role="status">
        <strong>{location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}</strong>
        <span>Reported accuracy: ±{Math.ceil(location.accuracy)} m</span>
        {location.accuracy > 100 && <p>This location is approximate. Try finding it again for a more accurate pin.</p>}
      </div>}
      {locationError && <p className="help-error" role="alert">{locationError}</p>}
      <label className="help-consent">
        <input type="checkbox" checked={consent} disabled={!location || disabled}
          onChange={event => setConsent(event.target.checked)} />
        <span>I agree to share this precise location, name, and message publicly on FLOW for {HELP_REPORT_HOURS} hours or until I remove the request.</span>
      </label>
      <button type="submit" className="primary-btn" disabled={!location || !consent || disabled}>
        {state.busy ? 'Publishing…' : editing ? 'Update my public request' : 'Publish help request'}
      </button>
      {editing && <button type="button" className="secondary-btn" disabled={disabled}
        onClick={() => setEditing(false)}>Cancel update</button>}
    </form>}
    {state.mutationError && <p className="help-error" role="alert">{state.mutationError}</p>}
    {state.notice && (state.own || state.notice.includes('removed')) && <p className="help-notice" role="status">{state.notice}</p>}
    <p className="help-footnote">This shares a location snapshot, not live tracking. Use the same browser to update or remove your request. Clearing its saved data removes that control.</p>
    <section className="help-community" aria-label="Community help requests">
      <h3>Community requests <span>({others.length})</span></h3>
      <p className="help-feed-state" role="status">{state.loading ? 'Loading reports…'
        : state.live && !state.error ? 'Live updates · user reports are unverified'
          : 'Updates unavailable · displayed reports may be out of date'}</p>
      {state.error && <div className="help-error" role="alert"><p>{state.error}</p>
        <button type="button" className="secondary-btn" onClick={state.refresh}>Retry</button></div>}
      {!state.loading && !state.error && !others.length && <p>No other active requests are currently listed.</p>}
      {others.map(report => <button key={report.id} type="button" className="help-list-item" onClick={() => onView(report.id)}>
        <Icon name="help-person" />
        <span><strong>{report.name || 'Someone needs help'}</strong>
          <span>{report.message || 'Help requested at this location.'}</span>
          <small>{helpReportTime(report.updated_at)}</small></span>
        <Icon name="chevron" />
      </button>)}
    </section>
  </div>;
}

export function ReportDetails({ report, compact = false }: { report: HelpReport; compact?: boolean }) {
  const location = <>
    <p className="help-coordinates">{report.latitude.toFixed(6)}, {report.longitude.toFixed(6)}</p>
    <p>Location accuracy: ±{Math.ceil(report.accuracy)} m<br />
      Located {helpReportTime(report.located_at)}<br />
      Visible until {helpReportTime(report.expires_at)}</p>
  </>;
  return <div className="help-report-details">
    <p><strong>Name:</strong> {report.name || 'Not provided'}</p>
    <p><strong>Description:</strong> {report.message || 'Help requested at this location.'}</p>
    {compact ? <details className="help-location-details">
      <summary>Location details</summary>
      <div>{location}</div>
    </details> : location}
  </div>;
}
