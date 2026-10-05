'use client';

import { useEffect, useId, useState } from 'react';
import type { NodeWeatherState } from '@/hooks/use-node-weather';
import { manilaDate, WEATHER_MAX_AGE_MS, weatherDay, weatherDescription, type WeatherHour } from '@/lib/node-weather';
import type { FlowNode } from '@/lib/types';
import { Icon } from './icon';

const timeFormat = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', hour12: true,
});
const hourFormat = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila', hour: 'numeric', hour12: true,
});
const dayFormat = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'long' });
const dateFormat = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila', month: 'short', day: 'numeric',
});
const degrees = (value: number | null | undefined) => value == null ? '—' : `${Math.round(value)}°`;
const percent = (value: number | null | undefined) => value == null ? '—' : `${Math.round(value)}%`;
const dayTime = (date: string) => Date.parse(`${date}T12:00:00+08:00`);

function WeatherGlyph({ code, isDay = true, className = '' }: {
  code: number | null; isDay?: boolean | null; className?: string;
}) {
  const storm = code !== null && code >= 95;
  const snow = code !== null && ((code >= 71 && code <= 77) || code === 85 || code === 86);
  const rain = code !== null && ((code >= 51 && code <= 67) || (code >= 80 && code <= 82));
  const fog = code === 45 || code === 48;
  const clear = code === 0 || code === 1;
  const sun = <g className="weather-sun">
    <circle cx="32" cy="27" r="10" fill="currentColor" stroke="none" />
    <path d="M32 7v5m0 30v5M12 27h5m30 0h5M18 13l4 4m20 20 4 4M18 41l4-4m20-20 4-4" />
  </g>;
  const moon = <path className="weather-moon" d="M40 12a18 18 0 1 0 10 29 17 17 0 0 1-10-29Z" />;
  return <svg className={`weather-glyph ${className}`} viewBox="0 0 64 64" aria-hidden="true"
    fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    {code === null ? <><circle cx="32" cy="28" r="17" strokeDasharray="3 6" /><path d="M32 20v10m0 7h.01" /></>
      : clear ? isDay === false ? moon : sun
      : <>
        {(code === 2 || code === 3) && <g transform="translate(-10 -5) scale(.85)">
          {isDay === false ? moon : sun}
        </g>}
        <path className={storm ? 'weather-cloud storm-cloud' : 'weather-cloud'}
          d="M17 43a9 9 0 1 1 2-18 13 13 0 0 1 25 4 7 7 0 1 1 3 14Z" />
        {rain && <path className="weather-rain" d="m21 49-3 6m15-6-3 6m15-6-3 6" />}
        {storm && <path className="weather-lightning" d="m35 35-9 14h8l-4 11 15-18h-9l3-7Z" fill="currentColor" stroke="none" />}
        {snow && <path className="weather-snow" d="M23 49v10m-4-8 8 6m0-6-8 6m24-8v10m-4-8 8 6m0-6-8 6" />}
        {fog && <path d="M14 50h36m-31 7h26" />}
      </>}
  </svg>;
}

function MetricGlyph({ kind }: { kind: 'rain' | 'humidity' | 'wind' }) {
  return <svg className={`weather-metric-glyph ${kind}`} viewBox="0 0 24 24" aria-hidden="true"
    fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {kind === 'wind' ? <path d="M3 8h12a3 3 0 1 0-3-3M3 12h16a2 2 0 1 1-2 2M3 16h7a3 3 0 1 1-3 3" />
      : <><path d="M12 3C9 7 5 11 5 15a7 7 0 0 0 14 0c0-4-4-8-7-12Z" />
        {kind === 'rain' ? <path d="M8 15a4 4 0 0 0 4 4" /> : <path d="M6 15h12a6 6 0 0 1-12 0Z" fill="currentColor" stroke="none" />}</>}
  </svg>;
}

function TemperatureChart({ hours, date }: { hours: WeatherHour[]; date: string }) {
  const id = useId().replaceAll(':', '');
  const values = hours.flatMap(hour => hour.temperatureC === null ? [] : [hour.temperatureC]);
  if (!values.length) return <p className="weather-empty">Temperature forecast is unavailable for this day.</p>;
  const low = Math.floor(Math.min(...values)) - 2;
  const high = Math.ceil(Math.max(...values)) + 2;
  const start = Date.parse(`${date}T00:00:00+08:00`);
  const points = hours.map(hour => ({
    ...hour, x: 24 + (hour.at - start) / (23 * 3_600_000) * 592,
    y: hour.temperatureC === null ? null : 119 - (hour.temperatureC - low) / (high - low) * 90,
  }));
  const segments: Array<typeof points> = [];
  for (const point of points) {
    if (point.y === null) { segments.push([]); continue; }
    let segment = segments.at(-1);
    if (!segment || (segment.length && point.at - segment.at(-1)!.at !== 3_600_000)) {
      segment = [];
      segments.push(segment);
    }
    segment.push(point);
  }
  return <figure className="weather-temperature-chart">
    <svg viewBox="0 0 640 162" role="img" aria-labelledby={`${id}-title ${id}-description`}>
      <title id={`${id}-title`}>{`Hourly temperature forecast for ${dateFormat.format(dayTime(date))}`}</title>
      <desc id={`${id}-description`}>Line graph from midnight to 11 PM Philippine time.
        Forecast temperatures range from {Math.min(...values)} to {Math.max(...values)} degrees Celsius.
        Missing hours leave gaps in the line.</desc>
      <defs><linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="currentColor" stopOpacity=".22" />
        <stop offset="100%" stopColor="currentColor" stopOpacity=".03" />
      </linearGradient></defs>
      {[45, 85, 125].map(y => <line className="weather-chart-grid" key={y} x1="24" x2="616" y1={y} y2={y} />)}
      {segments.filter(segment => segment.length).map((segment, index) => {
        const path = segment.map((point, at) => `${at ? 'L' : 'M'}${point.x.toFixed(1)},${point.y!.toFixed(1)}`).join(' ');
        const first = segment[0], last = segment.at(-1)!;
        return <g key={index}>
          {segment.length > 1 && <path d={`${path} L${last.x.toFixed(1)},125 L${first.x.toFixed(1)},125 Z`}
            fill={`url(#${id}-fill)`} />}
          <path className="weather-temperature-line" d={path} fill="none" />
          {segment.length === 1 && <circle cx={first.x} cy={first.y!} r="3" fill="currentColor" />}
        </g>;
      })}
      {points.filter(point => point.y !== null && (point.at - start) / 3_600_000 % 3 === 0).map(point =>
        <text className="weather-chart-value" key={point.at} x={point.x} y={point.y! - 10} textAnchor="middle">
          {Math.round(point.temperatureC!)}°
        </text>)}
      {[0, 3, 6, 9, 12, 15, 18, 21].map(hour => <text className="weather-chart-time" key={hour}
        x={hour === 0 ? 12 : 24 + hour / 23 * 592} y="150" textAnchor={hour === 0 ? 'start' : 'middle'}>
        {hourFormat.format(start + hour * 3_600_000).replace(/\s/g, '')}
      </text>)}
    </svg>
    <figcaption>Hourly forecast · 12 AM–11 PM · °C</figcaption>
  </figure>;
}

export function NodeWeatherPanel({ node, weather }: { node: FlowNode; weather: NodeWeatherState }) {
  const [now, setNow] = useState(Date.now);
  const [chosenDay, setChosenDay] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = setInterval(update, 60_000);
    document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, []);
  const data = weather.data;
  const date = chosenDay && data?.daily.some(day => day.date === chosenDay) ? chosenDay : data?.forecastDay;
  const day = data?.daily.find(item => item.date === date);
  const today = date === weatherDay(now);
  const hours = data?.hourly.filter(hour => manilaDate(hour.at) === date) ?? [];
  const currentHour = data?.hourly.find(hour => hour.at === Math.floor(now / 3_600_000) * 3_600_000);
  const current = today && data?.current && now - data.current.at <= WEATHER_MAX_AGE_MS ? data.current : null;
  const conditions = today ? current ?? currentHour : hours.find(hour => hour.at === dayTime(date!)) ?? hours[0];
  const outlook = today ? data?.hourly.filter(hour => hour.at >= Math.floor(now / 3_600_000) * 3_600_000).slice(0, 12) ?? []
    : hours.slice(0, 12);
  const chanceHours = outlook.filter(hour => hour.rainChance !== null);
  const rainHour = chanceHours.find(hour => hour.rainChance! >= 50)
    ?? chanceHours.reduce<WeatherHour | null>((best, hour) => !best || hour.rainChance! > best.rainChance! ? hour : best, null);
  const rainChance = today ? currentHour?.rainChance : conditions?.rainChance;
  const condition = weatherDescription(conditions?.weatherCode ?? null);
  const loading = !data && weather.loading;

  return <div className="weather-panel" aria-busy={weather.loading}>
    <div className="weather-location">
      <Icon name="map-pin" />
      <span><strong>{node.area || node.name}</strong><small>{node.name}</small></span>
      <button className="icon-btn" type="button" aria-label="Refresh weather" disabled={weather.loading}
        onClick={weather.retryWeather}><Icon name="refresh" /></button>
    </div>
    {!data ? <div className="weather-empty-state" role="status">
      <Icon name={loading ? 'clock' : 'rain'} />
      <h3>{loading ? 'Loading your local forecast…' : 'Weather could not load'}</h3>
      <p>{loading ? 'Preparing hourly conditions and the 7-day outlook.' : 'Check your connection and try again.'}</p>
      {!loading && <button className="primary-btn" type="button" onClick={weather.retryWeather}>Retry weather</button>}
    </div> : <>
      {weather.error && <p className="weather-refresh-error" role="status">
        Could not refresh the forecast. Showing the last available update.
        <button type="button" className="text-btn" disabled={weather.loading} onClick={weather.retryWeather}>Retry</button>
      </p>}
      <div className="weather-layout">
        <div className="weather-overview">
          <section className="weather-hero" data-night={conditions?.isDay === false || undefined} aria-label="Weather conditions">
            <WeatherGlyph code={conditions?.weatherCode ?? null} isDay={conditions?.isDay} className="weather-hero-glyph" />
            <div className="weather-hero-copy">
              <div className="weather-hero-main"><h3>{condition ?? 'Conditions unavailable'}</h3>
                <strong>{degrees(conditions?.temperatureC)}</strong></div>
              <p>{conditions?.feelsLikeC != null ? <>Feels {degrees(conditions.feelsLikeC)} · </> : null}
                {day?.sunsetAt ? <>Sunset {timeFormat.format(day.sunsetAt)}</> : 'Sunset unavailable'}</p>
              <small>{conditions ? `${current ? 'Modeled conditions' : 'Forecast'} for ${timeFormat.format(conditions.at)}`
                : 'Local forecast unavailable'}</small>
            </div>
          </section>
          <div className="weather-forecast-time"><Icon name="clock" />
            <span>{date ? dateFormat.format(dayTime(date)) : 'Today'} · Philippine time</span></div>
          <dl className="weather-metrics">
            <div><dt>Rain chance</dt><dd><MetricGlyph kind="rain" /><span>{percent(rainChance)}</span></dd></div>
            <div><dt>Humidity</dt><dd><MetricGlyph kind="humidity" /><span>{percent(conditions?.humidity)}</span></dd></div>
            <div><dt>Wind</dt><dd><MetricGlyph kind="wind" />
              <span>{conditions?.windKmh == null ? '—' : `${Math.round(conditions.windKmh)} km/h`}</span></dd></div>
          </dl>
          <div className="weather-rain-outlook">
            <MetricGlyph kind="rain" />
            <div><strong>{rainHour && rainHour.rainChance! > 0
              ? `${dayFormat.format(rainHour.at)} ${timeFormat.format(rainHour.at)}` : 'Rain outlook'}</strong>
              <p>{rainHour ? rainHour.rainChance! > 0 ? `Rain possible · ${percent(rainHour.rainChance)}`
                : '0% hourly rain chance in this outlook' : 'Rain probability is unavailable'}</p></div>
          </div>
          <div className="weather-rain-total"><Icon name="rain" /><div>
            <span>Full-day rainfall forecast</span>
            <strong>{day?.rainfallMm == null ? 'Unavailable' : day.rainfallMm > 0 && day.rainfallMm < .1
              ? '<0.1 mm' : `${day.rainfallMm.toFixed(1)} mm`}</strong>
            <small>12 AM–12 AM · Forecast, not measured rainfall</small>
          </div></div>
        </div>
        <div className="weather-hourly-and-chart">
          <section className="weather-section" aria-labelledby="weather-hourly-title">
            <div className="weather-section-head"><h3 id="weather-hourly-title">Hourly outlook</h3>
              <span>{today ? 'Next 12 hours' : '12 AM–11 AM'}</span></div>
            {outlook.length ? <ol className="weather-hour-list" tabIndex={0} aria-label="Hourly weather; scroll for more hours">
              {outlook.map((hour, index) => <li key={hour.at} className={today && index === 0 ? 'is-current' : undefined}>
                <span>{today && index === 0 ? 'Now' : hourFormat.format(hour.at)}</span>
                <WeatherGlyph code={hour.weatherCode} isDay={hour.isDay} />
                <strong>{degrees(hour.temperatureC)}</strong>
                <small><MetricGlyph kind="rain" />{percent(hour.rainChance)}</small>
              </li>)}
            </ol> : <p className="weather-empty">Hourly forecast is unavailable.</p>}
          </section>
          <section className="weather-section" aria-labelledby="weather-temperature-title">
            <div className="weather-section-head"><h3 id="weather-temperature-title">Temperature</h3><span>Full 24-hour day</span></div>
            {date && <TemperatureChart hours={hours} date={date} />}
          </section>
        </div>
        <section className="weather-section weather-week" aria-labelledby="weather-week-title">
          <div className="weather-section-head"><h3 id="weather-week-title">7-day forecast</h3><span>{node.area || node.name}</span></div>
          <div className="weather-day-list" role="group" aria-label="Choose a forecast day">
            {data.daily.map(item => <button key={item.date} type="button" aria-pressed={date === item.date}
              className={date === item.date ? 'is-current' : undefined} onClick={() => setChosenDay(item.date)}>
              <span>{dayFormat.format(dayTime(item.date))}</span><small>{dateFormat.format(dayTime(item.date))}</small>
              <WeatherGlyph code={item.weatherCode} />
              <div><strong>{degrees(item.highC)}</strong><span>{degrees(item.lowC)}</span></div>
              <small><MetricGlyph kind="rain" />{percent(item.rainChance)}</small>
            </button>)}
          </div>
        </section>
      </div>
      <p className="weather-credit">Forecasts by <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>
        {' · '}Updated {timeFormat.format(data.fetchedAt)}. Daily outlook refreshes at 12:01 AM Philippine time.</p>
    </>}
  </div>;
}
