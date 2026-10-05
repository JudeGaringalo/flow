<p align="center">
  <img src="public/assets/flow-wordmark.svg" alt="FLOW" width="240" />
</p>

<h1 align="center">Flood-Level Observation &amp; Warning</h1>

<p align="center">
  Live water-level observations, flood-hazard context, and community help requests on one map.
</p>

<p align="center">
  <a href="https://flow-startup.vercel.app/"><strong>Open FLOW</strong></a> &middot;
  <a href="#features">Features</a> &middot;
  <a href="#how-it-works">How it works</a> &middot;
  <a href="#development">Development</a>
</p>

---

FLOW is a public flood-observation web application focused on the Philippines. It connects water-level monitoring devices to an interactive map, helping people check nearby observations, review changes over time, explore recorded evacuation sites, and share requests for help.

The interface combines glass panels, standard and satellite maps, tilted building views, and status-colored water ripples. It adapts to desktop, tablet, and mobile screens and can be installed through supported browsers.

## Features

| Feature | What it does |
| --- | --- |
| **Live monitoring** | Displays each monitoring point's latest threshold status, individual probe states, reading time, and connection status. |
| **Recent status graph** | Shows recorded sensor levels as a line graph with **24H**, **7D**, and **30D** views. |
| **FLOW Intelligence** | Provides AI-assisted summaries of sensor conditions, with separate estimates from recorded observations for reaching Level 3 and receding below the first threshold when enough evidence is available. |
| **Local weather outlook** | Uses the selected node's coordinates for weather conditions, rain probability, daily rainfall forecasts, hourly temperature, and a seven-day outlook. |
| **Nearby alerts** | Shows alerts for rising sensor levels within **3 km**. Supported browsers can also receive closed-app push notifications after permission and subscription. |
| **NOAH flood-hazard layers** | Displays modeled **5-year** and **100-year** flood scenarios alongside live observations, with visibility controls in Map layers & Settings. |
| **Evacuation sites** | Shows recorded sites in Metro Manila and lets users inspect their mapped locations. |
| **Directions inside FLOW** | Draws a walking route from the viewer's location to an evacuation site or a public help request. Google Maps is available as an additional option. |
| **Community help requests** | Lets users publish an optional name, description, and location snapshot for others to see on the map. |
| **Responsive map controls** | Supports search, zoom, wide and tilted views, standard and satellite layers, and mobile detail sheets. |
| **Installable web app** | Provides an install flow, app icons, and an offline fallback page. |

## How it works

1. A registered monitoring device sends the states of its three water-level thresholds.
2. FLOW validates the reading and updates the stored observation.
3. The public map receives changes through Supabase Realtime, with refreshes to recover missed updates.
4. Eligible rising levels trigger nearby alerts. Accepted status changes also request an updated intelligence summary.
5. Users open a monitoring point to inspect its current state, recorded history, weather outlook, and available estimates.

### Reading the sensor status

| Level | Status | Color | Meaning |
| --- | --- | --- | --- |
| **0** | Below first threshold | Gray | No water threshold has been reached. |
| **1** | Flood Advisory | Blue | The first threshold has been reached. |
| **2** | Flood Watch | Yellow | The second threshold has been reached. |
| **3** | Flood Warning | Red | The third and highest sensor threshold has been reached. |

Unexpected probe combinations show **Sensor fault**. Readings older than two minutes, missing readings, or a lost live connection show **Unavailable**.

These are observations at individual monitoring points. The graph records threshold levels, not continuous water depth. History depends on the readings already recorded; missing periods are not reconstructed as measurements.

## FLOW Intelligence and weather

**FLOW Intelligence** follows changes in a node's sensor state and provides a short explanation of the current observation. Google Gemini supplies AI-assisted summaries when available; a sensor-based summary remains available as a fallback.

Timing estimates are calculated from recorded threshold transitions and relevant past events. They are shown as approximate ranges, with an explanation of their basis. When readings are stale or history is insufficient, FLOW shows that limitation instead of inventing a countdown. Level 3 is the highest sensor threshold, not a prediction of maximum flood depth.

**Weather outlooks** come from Open-Meteo using each node's latitude and longitude. Moving a node changes the forecast location. The daily view rolls over at **12:01 AM Philippine time** and refreshes while the app is active and connected, or when it resumes. Rainfall values are forecasts, not rainfall measured by the monitoring device.

## Community help requests

Open the three-dot menu and choose **Report / Request help**. A user can add a name and description, obtain their location, and explicitly agree to publish those details.

Published requests appear on the public map. Their compact popup includes **Name**, **Description**, expandable **Location details**, **Get Directions**, and **Open in Google Maps**. The reporting browser can also manage its own request.

- Requests remain publicly visible for up to **six hours after publishing or updating**, or until the user removes them.
- The shared position is a location snapshot with a reported accuracy, not continuous tracking.
- Users should use the same browser to update or resolve their request. Clearing its saved data removes that control.
- Reports are unverified community submissions. Publishing one does not contact emergency services or confirm that someone is responding.

## Understanding the map

**Live observations, modeled hazard, and community reports are separate information sources.** A sensor shows conditions at its own location. NOAH layers show modeled flood susceptibility for the selected scenario. A help marker shows a user's submitted request.

Hazard coverage and detail depend on the available datasets. An uncolored area does not establish that it is flood-free, and a colored area does not establish that it is flooding now.

Evacuation locations are recorded sites; FLOW does not confirm that a site is currently open or has capacity. Routes follow mapped paths and do not verify flood conditions, road passability, or safe access. Follow official local instructions when making evacuation decisions.

### Location, alerts, and offline access

FLOW uses permitted location access to center the map and identify nearby monitoring points. Closed-app alerts use the last approximate alert area saved while FLOW was open; they do not continuously track movement in the background.

Notification delivery depends on browser support, permission, connectivity, and device settings. The service worker provides an offline fallback page, but fresh readings, routes, forecasts, community reports, and alerts require a network connection.

## Built with

| Layer | Technology |
| --- | --- |
| Application | Next.js, React, TypeScript |
| Interactive map | MapLibre GL JS |
| Data and live updates | Supabase and PostgreSQL |
| Flood-hazard delivery | Bundled tiles and PMTiles archives |
| Weather | Open-Meteo |
| AI-assisted summaries | Google Gemini |
| Notifications and installation | Web Push, service worker, web app manifest |
| Hosting | Vercel |

## Development

Use **Node.js 22**. Connected features require an existing FLOW database and the project's service setup.

```sh
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000). Browser location permission is required to enter the map.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server. |
| `npm run typecheck` | Check TypeScript types. |
| `npm test` | Run the project's automated checks. |
| `npm run build` | Create a production build. |
| `npm start` | Serve a production build. |
| `npm run check` | Run type checking, tests, and a production build. |

### Project structure

| Directory | Contents |
| --- | --- |
| `app/` | Application pages, shared styles, and API routes. |
| `components/flow/` | Map interface, node details, weather, charts, and help-report UI. |
| `hooks/` | Live data, location, history, weather, intelligence, and routing state. |
| `lib/` | Status rules, map styles, data handling, and server operations. |
| `public/` | Branding, app assets, service worker, offline page, and bundled hazard tiles. |
| `scripts/` | Project checks and development utilities. |

## Data and map credits

FLOW uses NOAH flood-hazard data (ODbL) through the BetterGov PH PMTiles archive, OpenStreetMap contributors' data and routing, OpenFreeMap map tiles, Esri satellite imagery and its contributors, and Open-Meteo forecasts. Interface icon paths are adapted from Lucide (ISC).

FLOW brings these sources together with its own monitoring observations and community reports. It does not replace official warnings, emergency dispatch, or local disaster-response instructions.
