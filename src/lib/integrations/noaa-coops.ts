const COOPS_DATA_URL = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";

export const HAMPTON_ROADS_COASTAL_STATIONS = [
  {
    id: "virginia-beach",
    stationId: "8638863",
    name: "Chesapeake Bay Bridge Tunnel, VA",
    city: "Virginia Beach",
    latitude: 36.9667,
    longitude: -76.1133,
    observationProducts: ["water_level", "wind", "water_temperature"] as const,
  },
  {
    id: "rudee-inlet",
    stationId: "8639208",
    name: "Virginia Beach, Rudee Inlet, VA",
    city: "Virginia Beach",
    latitude: 36.8317,
    longitude: -75.9667,
    observationProducts: [] as const,
  },
  {
    id: "norfolk",
    stationId: "8638610",
    name: "Sewells Point, VA",
    city: "Norfolk",
    latitude: 36.9467,
    longitude: -76.33,
    observationProducts: ["water_level", "wind", "water_temperature"] as const,
  },
  {
    id: "chesapeake",
    stationId: "8639348",
    name: "Money Point, VA",
    city: "Chesapeake",
    latitude: 36.7783,
    longitude: -76.3017,
    observationProducts: ["water_level", "wind", "water_temperature"] as const,
  },
] as const;

export type CoastalStation = (typeof HAMPTON_ROADS_COASTAL_STATIONS)[number];
export type CoopsProduct = "predictions" | "water_level" | "wind" | "water_temperature";

type CoopsMetadata = {
  id?: string;
  name?: string;
  lat?: string;
  lon?: string;
};

type CoopsPayload = {
  metadata?: CoopsMetadata;
  data?: Array<Record<string, string>>;
  predictions?: Array<Record<string, string>>;
  error?: { message?: string };
};

export type CoastalObservation = {
  time: string;
  value: number | null;
  unit: string;
};

export type CoastalWind = {
  time: string;
  speedMph: number | null;
  gustMph: number | null;
  directionDegrees: number | null;
  direction: string | null;
};

export type TidePrediction = {
  time: string;
  heightFeet: number | null;
  type: "high" | "low" | "unknown";
};

function dateStamp(date: Date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function latest<T>(items: T[]) {
  return items.length ? items[items.length - 1] : null;
}

export function buildCoopsUrl(
  stationId: string,
  product: CoopsProduct,
  now = new Date(),
) {
  const parameters = new URLSearchParams({
    station: stationId,
    product,
    time_zone: "lst_ldt",
    units: "english",
    application: "Buzz",
    format: "json",
  });

  if (product === "predictions") {
    const end = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    parameters.set("begin_date", dateStamp(now));
    parameters.set("end_date", dateStamp(end));
    parameters.set("datum", "MLLW");
    parameters.set("interval", "hilo");
  } else {
    parameters.set("date", "today");
    if (product === "water_level") {
      parameters.set("datum", "MLLW");
      parameters.set("interval", "6");
    } else {
      parameters.set("interval", "h");
    }
  }

  return `${COOPS_DATA_URL}?${parameters.toString()}`;
}

async function coopsJson(stationId: string, product: CoopsProduct): Promise<CoopsPayload> {
  const response = await fetch(buildCoopsUrl(stationId, product), {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "User-Agent": "Buzz/1.0 (https://lit757.vercel.app; contact: demetriusvharvey@gmail.com)",
    },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json() as CoopsPayload;
  if (!response.ok) throw new Error(`NOAA CO-OPS ${product} request failed (${response.status})`);
  if (payload.error?.message) throw new Error(`NOAA CO-OPS ${product}: ${payload.error.message}`);
  return payload;
}

export function normalizeTidePredictions(payload: CoopsPayload): TidePrediction[] {
  const predictions: TidePrediction[] = [];
  for (const item of payload.predictions || []) {
    const time = String(item.t || "");
    if (!time) continue;
    let type: TidePrediction["type"] = "unknown";
    if (item.type === "H") type = "high";
    if (item.type === "L") type = "low";
    predictions.push({ time, heightFeet: numeric(item.v), type });
  }
  return predictions;
}

export function normalizeWaterObservation(payload: CoopsPayload): CoastalObservation | null {
  const item = latest(payload.data || []);
  if (!item?.t) return null;
  return { time: item.t, value: numeric(item.v), unit: "feet MLLW" };
}

export function normalizeWaterTemperature(payload: CoopsPayload): CoastalObservation | null {
  const item = latest(payload.data || []);
  if (!item?.t) return null;
  return { time: item.t, value: numeric(item.v), unit: "°F" };
}

export function normalizeWind(payload: CoopsPayload): CoastalWind | null {
  const item = latest(payload.data || []);
  if (!item?.t) return null;
  return {
    time: item.t,
    speedMph: numeric(item.s),
    gustMph: numeric(item.g),
    directionDegrees: numeric(item.d),
    direction: item.dr || null,
  };
}

function fulfilled<T>(result: PromiseSettledResult<T>) {
  return result.status === "fulfilled" ? result.value : null;
}

function failure(result: PromiseSettledResult<unknown>) {
  return result.status === "rejected"
    ? result.reason instanceof Error ? result.reason.message : String(result.reason || "Request failed")
    : null;
}

export function coastalActivityImpact(wind: CoastalWind | null) {
  const gust = wind?.gustMph || 0;
  const speed = wind?.speedMph || 0;
  if (gust >= 40 || speed >= 30) {
    return { level: "disruptive", points: -18, reason: `Coastal winds ${speed || gust} mph` };
  }
  if (gust >= 30 || speed >= 22) {
    return { level: "windy", points: -10, reason: `Coastal winds ${speed || gust} mph` };
  }
  return { level: "neutral", points: 0, reason: "No major coastal wind disruption" };
}

export async function fetchCoastalConditions(station: CoastalStation) {
  const products = station.observationProducts as readonly string[];
  const wantsWaterLevel = products.includes("water_level");
  const wantsWind = products.includes("wind");
  const wantsWaterTemperature = products.includes("water_temperature");

  const [predictionResult, waterLevelResult, windResult, temperatureResult] = await Promise.allSettled([
    coopsJson(station.stationId, "predictions"),
    wantsWaterLevel ? coopsJson(station.stationId, "water_level") : Promise.resolve(null),
    wantsWind ? coopsJson(station.stationId, "wind") : Promise.resolve(null),
    wantsWaterTemperature ? coopsJson(station.stationId, "water_temperature") : Promise.resolve(null),
  ]);

  const predictionPayload = fulfilled(predictionResult);
  const waterPayload = fulfilled(waterLevelResult);
  const windPayload = fulfilled(windResult);
  const temperaturePayload = fulfilled(temperatureResult);
  const tidePredictions = predictionPayload ? normalizeTidePredictions(predictionPayload) : [];
  const wind = windPayload ? normalizeWind(windPayload) : null;

  return {
    generatedAt: new Date().toISOString(),
    provider: "NOAA CO-OPS",
    station,
    tidePredictions,
    nextTide: tidePredictions[0] || null,
    observedWaterLevel: waterPayload ? normalizeWaterObservation(waterPayload) : null,
    wind,
    waterTemperature: temperaturePayload ? normalizeWaterTemperature(temperaturePayload) : null,
    activityImpact: coastalActivityImpact(wind),
    availability: {
      predictions: tidePredictions.length > 0,
      waterLevel: Boolean(waterPayload),
      wind: Boolean(windPayload),
      waterTemperature: Boolean(temperaturePayload),
    },
    errors: {
      predictions: failure(predictionResult),
      waterLevel: wantsWaterLevel ? failure(waterLevelResult) : null,
      wind: wantsWind ? failure(windResult) : null,
      waterTemperature: wantsWaterTemperature ? failure(temperatureResult) : null,
    },
  };
}
