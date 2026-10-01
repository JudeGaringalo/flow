'use client';

import { useFlow } from '@/hooks/use-flow';

export function AlertSettings() {
  const f = useFlow();
  return <div className="alert-settings">
    <p>FLOW alerts you when a monitored water level rises within 3 km of your location.
      Background alerts use the last area saved while FLOW was open.</p>
    <p className="alert-state" role="status">Background alerts: {f.pushStatus === 'on' ? 'on'
      : f.pushStatus === 'working' ? 'setting up…'
        : f.pushStatus === 'off' ? 'off'
          : f.pushStatus === 'error' ? 'could not connect' : 'unavailable on this deployment'}.</p>
    {f.pushStatus === 'error' && <p className="alert-feedback" role="alert">{f.pushError}</p>}
    <p>System notifications: {f.notificationPermission === 'granted' ? 'allowed'
      : f.notificationPermission === 'denied' ? 'blocked in this browser'
        : f.notificationPermission === 'default' ? 'permission not given' : 'not supported here'}.
      Alerts also appear on screen while FLOW is open.</p>
    <div className="alert-actions">
      <button className="secondary-btn" type="button" disabled={f.locationWorking}
        onClick={() => void f.requestAlertLocation()}>
        {f.locationWorking ? 'Checking location…' : 'Update my location'}
      </button>
      {f.pushStatus === 'on' && <button className="secondary-btn" type="button"
        onClick={() => void f.turnOffBackgroundAlerts()}>Turn off background alerts</button>}
      {f.pushStatus === 'off' && <button className="primary-btn" type="button"
        onClick={f.turnOnBackgroundAlerts}>Turn on background alerts</button>}
    </div>
    {f.locationError && <p className="alert-feedback" role="alert">{f.locationError}</p>}
    <p className="alert-footnote">FLOW saves an approximate area for closed-app alerts.
      Update it when you move. A report covers the sensor location only;
      check official warnings and instructions.</p>
  </div>;
}
