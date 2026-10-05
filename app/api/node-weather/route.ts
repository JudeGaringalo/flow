import { addWeatherDays, nextWeatherDayAt, parseOpenMeteo, WEATHER_REFRESH_MS, weatherCoordinates, weatherDay } from '@/lib/node-weather';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const latitude = params.get('latitude');
  const longitude = params.get('longitude');
  const coordinates = latitude?.trim() && longitude?.trim()
    ? weatherCoordinates(Number(latitude), Number(longitude)) : null;
  if (!coordinates) return Response.json({ error: 'Valid latitude and longitude are required.' }, {
    status: 400, headers: { 'Cache-Control': 'no-store' },
  });

  const now = Date.now();
  const day = weatherDay(now);
  if (params.has('day') && params.get('day') !== day)
    return Response.json({ error: 'Refresh weather for the current Philippine day.' }, {
      status: 400, headers: { 'Cache-Control': 'no-store' },
    });

  const [lat, lng] = coordinates.split(',');
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: lat, longitude: lng,
    current: 'temperature_2m,apparent_temperature,weather_code,is_day,relative_humidity_2m,wind_speed_10m',
    hourly: 'temperature_2m,apparent_temperature,weather_code,is_day,precipitation_probability,relative_humidity_2m,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,rain_sum,showers_sum,sunset,precipitation_probability_max',
    start_date: day, end_date: addWeatherDays(day, 6), timezone: 'Asia/Manila', timeformat: 'iso8601',
    temperature_unit: 'celsius', precipitation_unit: 'mm', wind_speed_unit: 'kmh',
  }).toString();

  try {
    const response = await fetch(url, {
      next: { revalidate: WEATHER_REFRESH_MS / 1000 }, signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Weather provider unavailable');
    const weather = parseOpenMeteo(await response.json(), coordinates, Date.now(), day);
    const cacheSeconds = Math.max(0, Math.min(600, Math.floor((nextWeatherDayAt(now) - Date.now()) / 1000)));
    return Response.json(weather, {
      headers: { 'Cache-Control': `public, max-age=${Math.min(60, cacheSeconds)}, s-maxage=${cacheSeconds}` },
    });
  } catch {
    return Response.json({ error: 'Weather estimates are temporarily unavailable.' }, {
      status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' },
    });
  }
}
