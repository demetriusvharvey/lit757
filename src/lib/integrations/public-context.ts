import { unstable_cache } from "next/cache";
import { ACTIVITY_DISTRICTS, distanceMiles } from "../buzz/districts";
import { fetchHrtRealtime, fetchHrtStatic } from "./hrt";
import {
  fetchNwsWeather,
  HAMPTON_ROADS_WEATHER_POINTS,
  weatherActivityImpact,
  type NwsForecastPeriod,
} from "./nws";

type WeatherImpact = ReturnType<typeof weatherActivityImpact>;

type WeatherContext = {
  city: string;
  latitude: number;
  longitude: number;
  generatedAt: string;
  updatedAt: string | null;
  alertCount: number;
  severeAlert: boolean;
  impact: WeatherImpact;
  current: NwsForecastPeriod | null;
  error: string | null;
};

type HrtStop = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
};

type HrtArrival = {
  stopId: string;
  arrivalTime: string | null;
  departureTime: string | null;
  arrivalDelaySeconds: number | null;
  departureDelaySeconds: number | null;
};

type HrtTripUpdate = {
  entityId: string;
  routeId: string;
  tripId: string;
  stops: HrtArrival[];
};

export type TransitDistrictContext = {
  districtId: string;
  nearbyStops: number;
  arrivals30Minutes: number;
  arrivals60Minutes: number;
  delayedArrivals: number;
  averageDelayMinutes: number | null;
  serviceAlerts: number;
  degraded: boolean;
  points: number;
  label: string | null;
};

export type PublicActivityContext = {
  generatedAt: string;
  weather: WeatherContext[];
  transitByDistrict: Record<string, TransitDistrictContext>;
  availability: {
    weather: boolean;
    hrtStatic: boolean;
    hrtRealtime: boolean;
    hrtVehiclePositions: boolean;
  };
  errors: {
    weather: string[];
    hrtStatic: string | null;
    hrtRealtime: string | null;
  };
};

export type SupportingEvidence = {
  available: boolean;
  points: number;
  cap: number | null;
  label: string | null;
  confidencePenalty: boolean;
  metadata: Record<string, unknown>;
};

const cachedWeather = unstable_cache(async () => {
  return Promise.all(HAMPTON_ROADS_WEATHER_POINTS.map(async point => {
    try {
      const data = await fetchNwsWeather(point.latitude, point.longitude);
      const current = data.hourly[0] || null;
      const severeAlert = data.alerts.some(alert => {
        const severity = String((alert as Record<string, unknown>).severity || "").toLowerCase();
        return severity === "extreme" || severity === "severe";
      });
      return {
        city: point.city,
        latitude: point.latitude,
        longitude: point.longitude,
        generatedAt: data.generatedAt,
        updatedAt: data.hourlyUpdatedAt || data.forecastUpdatedAt || null,
        alertCount: data.alerts.length,
        severeAlert,
        impact: weatherActivityImpact(current || undefined),
        current,
        error: null,
      } satisfies WeatherContext;
    } catch (error) {
      return {
        city: point.city,
        latitude: point.latitude,
        longitude: point.longitude,
        generatedAt: new Date().toISOString(),
        updatedAt: null,
        alertCount: 0,
        severeAlert: false,
        impact: { level: "unknown", points: 0, reason: "Weather unavailable" },
        current: null,
        error: error instanceof Error ? error.message : "Weather request failed",
      } satisfies WeatherContext;
    }
  }));
}, ["buzz-public-weather-v1"], { revalidate: 300 });

const cachedHrtStatic = unstable_cache(async () => fetchHrtStatic(), ["buzz-hrt-static-v1"], {
  revalidate: 21_600,
});

const cachedHrtRealtime = unstable_cache(async () => fetchHrtRealtime(), ["buzz-hrt-realtime-v1"], {
  revalidate: 30,
});

function nearestDistrict(latitude: number, longitude: number) {
  let nearest: { id: string; distance: number; radius: number } | null = null;
  for (const district of ACTIVITY_DISTRICTS) {
    const distance = distanceMiles(district.center.lat, district.center.lng, latitude, longitude);
    const radius = district.radiusMiles + 0.45;
    if (distance > radius) continue;
    if (!nearest || distance < nearest.distance) nearest = { id: district.id, distance, radius };
  }
  return nearest?.id || null;
}

function arrivalTimestamp(arrival: HrtArrival) {
  const value = arrival.arrivalTime || arrival.departureTime;
  const timestamp = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

function delaySeconds(arrival: HrtArrival) {
  const value = arrival.arrivalDelaySeconds ?? arrival.departureDelaySeconds;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export function buildTransitDistrictContext(args: {
  stops: HrtStop[];
  tripUpdates: HrtTripUpdate[];
  serviceAlerts: number;
  reference?: Date;
}) {
  const now = (args.reference || new Date()).getTime();
  const stopById = new Map(args.stops.map(stop => [stop.id, stop]));
  const nearbyStops = new Map<string, Set<string>>();
  const arrivals = new Map<string, Array<{ minutes: number; delaySeconds: number | null }>>();

  for (const stop of args.stops) {
    const districtId = nearestDistrict(stop.latitude, stop.longitude);
    if (!districtId) continue;
    const ids = nearbyStops.get(districtId) || new Set<string>();
    ids.add(stop.id);
    nearbyStops.set(districtId, ids);
  }

  for (const update of args.tripUpdates) {
    for (const arrival of update.stops || []) {
      const timestamp = arrivalTimestamp(arrival);
      if (timestamp === null) continue;
      const minutes = (timestamp - now) / 60_000;
      if (minutes < -2 || minutes > 60) continue;
      const stop = stopById.get(arrival.stopId);
      if (!stop) continue;
      const districtId = nearestDistrict(stop.latitude, stop.longitude);
      if (!districtId) continue;
      const rows = arrivals.get(districtId) || [];
      rows.push({ minutes, delaySeconds: delaySeconds(arrival) });
      arrivals.set(districtId, rows);
    }
  }

  return Object.fromEntries(ACTIVITY_DISTRICTS.map(district => {
    const rows = arrivals.get(district.id) || [];
    const arrivals30Minutes = rows.filter(row => row.minutes <= 30).length;
    const delayed = rows
      .map(row => row.delaySeconds)
      .filter((value): value is number => value !== null && value > 300);
    const allDelays = rows
      .map(row => row.delaySeconds)
      .filter((value): value is number => value !== null);
    const averageDelayMinutes = allDelays.length
      ? Number((allDelays.reduce((sum, value) => sum + value, 0) / allDelays.length / 60).toFixed(1))
      : null;

    let points = arrivals30Minutes >= 12 ? 4
      : arrivals30Minutes >= 6 ? 3
        : arrivals30Minutes >= 3 ? 2
          : arrivals30Minutes >= 1 ? 1
            : 0;
    const degraded = (averageDelayMinutes !== null && averageDelayMinutes >= 15) || args.serviceAlerts >= 5;
    if (degraded) points = Math.max(-1, points - 2);

    const label = degraded
      ? "HRT disruptions may reduce arrivals"
      : points >= 4
        ? "Frequent HRT arrivals nearby"
        : points >= 2
          ? "HRT arrivals are building nearby"
          : points === 1
            ? "Transit arrivals nearby"
            : null;

    return [district.id, {
      districtId: district.id,
      nearbyStops: nearbyStops.get(district.id)?.size || 0,
      arrivals30Minutes,
      arrivals60Minutes: rows.length,
      delayedArrivals: delayed.length,
      averageDelayMinutes,
      serviceAlerts: args.serviceAlerts,
      degraded,
      points,
      label,
    } satisfies TransitDistrictContext];
  }));
}

export function weatherEvidenceForVenue(
  context: PublicActivityContext,
  latitude: number,
  longitude: number,
  outdoor: boolean,
): SupportingEvidence {
  const weather = [...context.weather]
    .filter(item => !item.error)
    .sort((left, right) =>
      distanceMiles(latitude, longitude, left.latitude, left.longitude)
      - distanceMiles(latitude, longitude, right.latitude, right.longitude))[0];

  if (!weather) {
    return { available: false, points: 0, cap: null, label: null, confidencePenalty: false, metadata: {} };
  }

  const level = weather.severeAlert ? "severe" : weather.impact.level;
  let points = 0;
  let cap: number | null = null;
  let confidencePenalty = false;

  if (level === "severe") {
    points = outdoor ? -24 : -10;
    cap = outdoor ? 52 : 68;
    confidencePenalty = true;
  } else if (level === "disruptive") {
    points = outdoor ? -16 : -6;
    cap = outdoor ? 62 : 76;
    confidencePenalty = true;
  } else if (level === "wet") {
    points = outdoor ? -8 : -1;
    cap = outdoor ? 72 : null;
    confidencePenalty = outdoor;
  } else if (level === "extreme_temperature") {
    points = outdoor ? -7 : -1;
    confidencePenalty = outdoor;
  } else if (level === "favorable" && outdoor) {
    points = 3;
  }

  const label = points === 0 ? null
    : points > 0 ? `Favorable outdoor weather: ${weather.impact.reason}`
      : `${outdoor ? "Outdoor activity affected" : "Weather may affect arrivals"}: ${weather.impact.reason}`;

  return {
    available: true,
    points,
    cap,
    label,
    confidencePenalty,
    metadata: {
      city: weather.city,
      level,
      reason: weather.impact.reason,
      alertCount: weather.alertCount,
      severeAlert: weather.severeAlert,
      updatedAt: weather.updatedAt,
    },
  };
}

export function transitEvidenceForDistrict(
  context: PublicActivityContext,
  districtId: string | null,
): SupportingEvidence {
  const transit = districtId ? context.transitByDistrict[districtId] : null;
  if (!transit) {
    return { available: false, points: 0, cap: null, label: null, confidencePenalty: false, metadata: {} };
  }
  return {
    available: context.availability.hrtStatic && context.availability.hrtRealtime,
    points: transit.points,
    cap: null,
    label: transit.label,
    confidencePenalty: transit.degraded,
    metadata: transit,
  };
}

export async function loadPublicActivityContext(): Promise<PublicActivityContext> {
  const [weather, staticResult, realtimeResult] = await Promise.all([
    cachedWeather(),
    cachedHrtStatic().then(data => ({ data, error: null as string | null })).catch(error => ({
      data: null,
      error: error instanceof Error ? error.message : "HRT static request failed",
    })),
    cachedHrtRealtime().then(data => ({ data, error: null as string | null })).catch(error => ({
      data: null,
      error: error instanceof Error ? error.message : "HRT realtime request failed",
    })),
  ]);

  const transitByDistrict = staticResult.data && realtimeResult.data
    ? buildTransitDistrictContext({
      stops: staticResult.data.stops as HrtStop[],
      tripUpdates: realtimeResult.data.tripUpdates as HrtTripUpdate[],
      serviceAlerts: realtimeResult.data.alerts.length,
    })
    : {};

  return {
    generatedAt: new Date().toISOString(),
    weather,
    transitByDistrict,
    availability: {
      weather: weather.some(item => !item.error),
      hrtStatic: Boolean(staticResult.data),
      hrtRealtime: Boolean(realtimeResult.data),
      hrtVehiclePositions: Boolean(realtimeResult.data?.availability.vehiclePositions),
    },
    errors: {
      weather: weather.flatMap(item => item.error ? [`${item.city}: ${item.error}`] : []),
      hrtStatic: staticResult.error,
      hrtRealtime: realtimeResult.error,
    },
  };
}
