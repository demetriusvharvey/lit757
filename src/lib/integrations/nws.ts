export const HAMPTON_ROADS_WEATHER_POINTS = [
  { id: "virginia-beach", city: "Virginia Beach", latitude: 36.8529, longitude: -75.9780 },
  { id: "norfolk", city: "Norfolk", latitude: 36.8508, longitude: -76.2859 },
  { id: "hampton", city: "Hampton", latitude: 37.0299, longitude: -76.3452 },
] as const;

const NWS_HEADERS = {
  Accept: "application/geo+json",
  "User-Agent": "Buzz/1.0 (https://lit757.vercel.app; contact: demetriusvharvey@gmail.com)",
};

export type NwsForecastPeriod = {
  number: number;
  name: string;
  startTime: string;
  endTime: string;
  isDaytime: boolean;
  temperature: number;
  temperatureUnit: string;
  probabilityOfPrecipitation?: { value?: number | null } | null;
  windSpeed: string;
  windDirection: string;
  shortForecast: string;
  detailedForecast: string;
};

async function nwsJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: NWS_HEADERS,
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`NWS request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export async function fetchNwsPoint(latitude: number, longitude: number) {
  return nwsJson<{ properties: { forecast: string; forecastHourly: string; forecastGridData: string; county: string; forecastZone: string } }>(
    `https://api.weather.gov/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`,
  );
}

export async function fetchNwsWeather(latitude: number, longitude: number) {
  const point = await fetchNwsPoint(latitude, longitude);
  const [forecast, hourly, alerts] = await Promise.all([
    nwsJson<{ properties: { updated: string; periods: NwsForecastPeriod[] } }>(point.properties.forecast),
    nwsJson<{ properties: { updated: string; periods: NwsForecastPeriod[] } }>(point.properties.forecastHourly),
    nwsJson<{ features: Array<{ id: string; properties: Record<string, unknown> }> }>(
      `https://api.weather.gov/alerts/active?point=${latitude.toFixed(4)},${longitude.toFixed(4)}`,
    ),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    point: { latitude, longitude },
    offices: point.properties,
    forecastUpdatedAt: forecast.properties.updated,
    hourlyUpdatedAt: hourly.properties.updated,
    forecast: forecast.properties.periods,
    hourly: hourly.properties.periods.slice(0, 24),
    alerts: alerts.features.map(feature => ({ id: feature.id, ...feature.properties })),
  };
}

export function weatherActivityImpact(period: NwsForecastPeriod | undefined) {
  if (!period) return { level: "unknown", points: 0, reason: "Weather unavailable" };
  const text = `${period.shortForecast} ${period.detailedForecast}`.toLowerCase();
  const precipitation = Number(period.probabilityOfPrecipitation?.value || 0);
  if (/tornado|hurricane|tropical storm|blizzard|ice storm/.test(text)) return { level: "severe", points: -35, reason: period.shortForecast };
  if (/thunderstorm|heavy rain|snow|sleet|freezing rain/.test(text) || precipitation >= 70) return { level: "disruptive", points: -18, reason: period.shortForecast };
  if (/rain|showers/.test(text) || precipitation >= 40) return { level: "wet", points: -8, reason: period.shortForecast };
  if (period.temperature >= 95 || period.temperature <= 32) return { level: "extreme_temperature", points: -8, reason: `${period.temperature}°${period.temperatureUnit}` };
  return { level: "favorable", points: 3, reason: period.shortForecast };
}
