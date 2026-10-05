export const WEATHER_REFRESH_MS = 10 * 60_000;
export const WEATHER_MAX_AGE_MS = 90 * 60_000;
const MANILA_OFFSET_MS = 8 * 3_600_000;
const DAY_MS = 24 * 3_600_000;

export interface WeatherHour {
  at: number;
  temperatureC: number | null;
  feelsLikeC: number | null;
  weatherCode: number | null;
  isDay: boolean | null;
  rainChance: number | null;
  humidity: number | null;
  windKmh: number | null;
}

export interface WeatherDay {
  date: string;
  weatherCode: number | null;
  highC: number | null;
  lowC: number | null;
  rainfallMm: number | null;
  rainChance: number | null;
  sunsetAt: number | null;
}

export interface NodeWeather {
  coordinates: string;
  forecastDay: string;
  fetchedAt: number;
  current: WeatherHour | null;
  hourly: WeatherHour[];
  daily: WeatherDay[];
}

const weatherNames: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Freezing fog', 51: 'Light drizzle', 53: 'Moderate drizzle',
  55: 'Dense drizzle', 56: 'Light freezing drizzle', 57: 'Dense freezing drizzle',
  61: 'Light rain', 63: 'Moderate rain', 65: 'Heavy rain',
  66: 'Light freezing rain', 67: 'Heavy freezing rain',
  71: 'Light snow', 73: 'Moderate snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Light showers', 81: 'Moderate showers', 82: 'Heavy showers',
  85: 'Light snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm',
  96: 'Thunderstorm with hail', 97: 'Heavy thunderstorm', 99: 'Thunderstorm with heavy hail',
};

export function weatherDescription(code: number | null) {
  return code === null ? null : weatherNames[code] ?? null;
}

export function weatherCoordinates(latitude: unknown, longitude: unknown) {
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90
    || typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180)
    return null;
  return `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
}

export function manilaDate(at: number) {
  return new Date(at + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

export function weatherDay(now = Date.now()) {
  return manilaDate(now - 60_000);
}

export function nextWeatherDayAt(now = Date.now()) {
  const today = Date.parse(`${manilaDate(now)}T00:01:00+08:00`);
  return today > now ? today : today + DAY_MS;
}

export function addWeatherDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function number(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function localTimestamp(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const at = Date.parse(value + '+08:00');
  return Number.isFinite(at) && manilaDate(at) === value.slice(0, 10) ? at : null;
}

function bounded(value: unknown, min: number, max: number) {
  return number(value) && value >= min && value <= max ? value : null;
}

function code(value: unknown) {
  return number(value) && Number.isInteger(value) && weatherDescription(value) ? value : null;
}

function parseHour(values: Record<string, unknown>, units: Record<string, unknown>): WeatherHour | null {
  const at = units.time === 'iso8601' ? localTimestamp(values.time) : null;
  if (at === null) return null;
  return {
    at,
    temperatureC: units.temperature_2m === '°C' ? bounded(values.temperature_2m, -100, 100) : null,
    feelsLikeC: units.apparent_temperature === '°C' ? bounded(values.apparent_temperature, -100, 100) : null,
    weatherCode: units.weather_code === 'wmo code' ? code(values.weather_code) : null,
    isDay: values.is_day === 0 ? false : values.is_day === 1 ? true : null,
    rainChance: units.precipitation_probability === '%' ? bounded(values.precipitation_probability, 0, 100) : null,
    humidity: units.relative_humidity_2m === '%' ? bounded(values.relative_humidity_2m, 0, 100) : null,
    windKmh: units.wind_speed_10m === 'km/h' ? bounded(values.wind_speed_10m, 0, 500) : null,
  };
}

function row(series: Record<string, unknown>, index: number): Record<string, unknown> {
  return Object.fromEntries(Object.entries(series).map(([key, values]) =>
    [key, Array.isArray(values) ? values[index] : undefined]));
}

export function parseOpenMeteo(value: unknown, coordinates: string, now = Date.now(), day = weatherDay(now)): NodeWeather {
  const data = object(value);
  if (data.timezone !== 'Asia/Manila' || data.utc_offset_seconds !== 28_800)
    throw new Error('Weather timezone unavailable');
  const current = parseHour(object(data.current), object(data.current_units));
  const hourly = object(data.hourly);
  const daily = object(data.daily);
  const hourlyUnits = object(data.hourly_units);
  const dailyUnits = object(data.daily_units);
  const result: NodeWeather = {
    coordinates, forecastDay: day, fetchedAt: now,
    current: current && current.at <= now && current.at >= now - WEATHER_MAX_AGE_MS ? current : null,
    hourly: [], daily: [],
  };
  if (Array.isArray(hourly.time)) {
    for (let index = 0; index < Math.min(hourly.time.length, 168); index++) {
      const hour = parseHour(row(hourly, index), hourlyUnits);
      if (hour && manilaDate(hour.at) >= day && manilaDate(hour.at) <= addWeatherDays(day, 6)
        && (!result.hourly.length || hour.at > result.hourly.at(-1)!.at)) result.hourly.push(hour);
    }
  }
  if (dailyUnits.time === 'iso8601' && Array.isArray(daily.time)) {
    for (let index = 0; index < Math.min(daily.time.length, 7); index++) {
      const values = row(daily, index);
      if (!validDate(values.time) || values.time < day || values.time > addWeatherDays(day, 6)
        || result.daily.some(item => item.date === values.time)) continue;
      const rain = dailyUnits.rain_sum === 'mm' ? bounded(values.rain_sum, 0, 10_000) : null;
      const showers = dailyUnits.showers_sum === 'mm' ? bounded(values.showers_sum, 0, 10_000) : null;
      result.daily.push({
        date: values.time,
        weatherCode: dailyUnits.weather_code === 'wmo code' ? code(values.weather_code) : null,
        highC: dailyUnits.temperature_2m_max === '°C' ? bounded(values.temperature_2m_max, -100, 100) : null,
        lowC: dailyUnits.temperature_2m_min === '°C' ? bounded(values.temperature_2m_min, -100, 100) : null,
        rainfallMm: rain !== null && showers !== null ? Math.round((rain + showers) * 1000) / 1000 : null,
        rainChance: dailyUnits.precipitation_probability_max === '%' ? bounded(values.precipitation_probability_max, 0, 100) : null,
        sunsetAt: dailyUnits.sunset === 'iso8601' ? localTimestamp(values.sunset) : null,
      });
    }
  }
  if (!result.hourly.some(hour => hour.temperatureC !== null) || !result.daily.some(item => item.date === day))
    throw new Error('Daily weather forecast unavailable');
  return result;
}

function nullable(value: unknown, min: number, max: number) {
  return value === null || bounded(value, min, max) !== null;
}

function validHour(value: unknown): value is WeatherHour {
  const hour = object(value);
  return number(hour.at) && nullable(hour.temperatureC, -100, 100) && nullable(hour.feelsLikeC, -100, 100)
    && (hour.weatherCode === null || code(hour.weatherCode) !== null)
    && (hour.isDay === null || typeof hour.isDay === 'boolean') && nullable(hour.rainChance, 0, 100)
    && nullable(hour.humidity, 0, 100) && nullable(hour.windKmh, 0, 500);
}

function validDay(value: unknown): value is WeatherDay {
  const day = object(value);
  return validDate(day.date) && (day.weatherCode === null || code(day.weatherCode) !== null)
    && nullable(day.highC, -100, 100) && nullable(day.lowC, -100, 100) && nullable(day.rainfallMm, 0, 20_000)
    && nullable(day.rainChance, 0, 100) && (day.sunsetAt === null || number(day.sunsetAt));
}

export function parseNodeWeather(value: unknown, coordinates: string, day = weatherDay()): NodeWeather {
  const data = object(value);
  if (data.coordinates !== coordinates || data.forecastDay !== day || !number(data.fetchedAt)
    || (data.current !== null && !validHour(data.current)) || !Array.isArray(data.hourly)
    || !data.hourly.length || data.hourly.length > 168 || !data.hourly.every(validHour)
    || !Array.isArray(data.daily) || !data.daily.length || data.daily.length > 7 || !data.daily.every(validDay)
    || !data.daily.some(item => item.date === day)) throw new Error('Weather response unavailable');
  return data as unknown as NodeWeather;
}
