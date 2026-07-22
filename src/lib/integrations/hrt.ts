import { inflateRawSync } from "node:zlib";

export const HRT_FEEDS = {
  static: "https://gtfs.gohrt.com/gtfs/google_transit.zip",
  tripUpdates: "https://gtfs.gohrt.com/gtfs-rt/TripUpdates.json",
  alerts: "https://gtfs.gohrt.com/gtfs-rt/Alerts.json",
} as const;

export type CsvRow = Record<string, string>;

export function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field); field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some(value => value.length)) rows.push(row);
      row = [];
    } else field += character;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const headers = (rows.shift() || []).map(value => value.replace(/^\uFEFF/, "").trim());
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function zipEntry(buffer: Buffer, wantedName: string) {
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) { offset += 1; continue; }
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const fileName = buffer.subarray(offset + 30, offset + 30 + fileNameLength).toString("utf8");
    const dataStart = offset + 30 + fileNameLength + extraLength;
    if (flags & 0x08) throw new Error("HRT ZIP uses unsupported data descriptors");
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    if (fileName === wantedName) {
      if (method === 0) return compressed.toString("utf8");
      if (method === 8) return inflateRawSync(compressed).toString("utf8");
      throw new Error(`Unsupported ZIP compression method ${method}`);
    }
    offset = dataStart + compressedSize;
  }
  throw new Error(`${wantedName} was not found in the HRT GTFS archive`);
}

async function fetchBuffer(url: string) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`HRT request failed (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json", "User-Agent": "Buzz/1.0 (https://lit757.vercel.app)" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`HRT request failed (${response.status})`);
  return response.json() as Promise<Record<string, unknown>>;
}

export async function fetchHrtStatic() {
  const archive = await fetchBuffer(HRT_FEEDS.static);
  const routes = parseCsv(zipEntry(archive, "routes.txt")).map(route => ({
    id: route.route_id,
    shortName: route.route_short_name,
    longName: route.route_long_name,
    description: route.route_desc || null,
    type: Number(route.route_type),
    color: route.route_color || null,
    textColor: route.route_text_color || null,
  }));
  const stops = parseCsv(zipEntry(archive, "stops.txt")).map(stop => ({
    id: stop.stop_id,
    code: stop.stop_code || null,
    name: stop.stop_name,
    description: stop.stop_desc || null,
    latitude: Number(stop.stop_lat),
    longitude: Number(stop.stop_lon),
    locationType: Number(stop.location_type || 0),
    wheelchairBoarding: Number(stop.wheelchair_boarding || 0),
  })).filter(stop => Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude));
  return { generatedAt: new Date().toISOString(), source: HRT_FEEDS.static, routeCount: routes.length, stopCount: stops.length, routes, stops };
}

function entities(payload: Record<string, unknown>) {
  return Array.isArray(payload.entity) ? payload.entity as Array<Record<string, unknown>> : [];
}

export function normalizeTripUpdates(payload: Record<string, unknown>) {
  return entities(payload).flatMap(entity => {
    const update = entity.tripUpdate as Record<string, unknown> | undefined;
    if (!update) return [];
    const trip = (update.trip || {}) as Record<string, unknown>;
    const vehicle = (update.vehicle || {}) as Record<string, unknown>;
    const stopTimeUpdate = Array.isArray(update.stopTimeUpdate) ? update.stopTimeUpdate as Array<Record<string, unknown>> : [];
    return [{
      entityId: String(entity.id || ""),
      tripId: String(trip.tripId || ""),
      routeId: String(trip.routeId || ""),
      startDate: String(trip.startDate || ""),
      vehicleId: vehicle.id ? String(vehicle.id) : null,
      timestamp: update.timestamp ? new Date(Number(update.timestamp) * 1000).toISOString() : null,
      stops: stopTimeUpdate.map(stop => {
        const arrival = (stop.arrival || {}) as Record<string, unknown>;
        const departure = (stop.departure || {}) as Record<string, unknown>;
        const arrivalTime = Number(arrival.time || 0);
        const departureTime = Number(departure.time || 0);
        return {
          stopId: String(stop.stopId || ""),
          stopSequence: Number(stop.stopSequence || 0),
          arrivalTime: arrivalTime ? new Date(arrivalTime * 1000).toISOString() : null,
          departureTime: departureTime ? new Date(departureTime * 1000).toISOString() : null,
          arrivalDelaySeconds: Number.isFinite(Number(arrival.delay)) ? Number(arrival.delay) : null,
          departureDelaySeconds: Number.isFinite(Number(departure.delay)) ? Number(departure.delay) : null,
          scheduleRelationship: stop.scheduleRelationship ?? null,
        };
      }),
    }];
  });
}

export function normalizeVehiclePositions(payload: Record<string, unknown>) {
  return entities(payload).flatMap(entity => {
    const vehicle = entity.vehicle as Record<string, unknown> | undefined;
    if (!vehicle) return [];
    const position = (vehicle.position || {}) as Record<string, unknown>;
    const descriptor = (vehicle.vehicle || {}) as Record<string, unknown>;
    const trip = (vehicle.trip || {}) as Record<string, unknown>;
    const latitude = Number(position.latitude);
    const longitude = Number(position.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
    return [{
      entityId: String(entity.id || ""), vehicleId: String(descriptor.id || ""), label: descriptor.label ? String(descriptor.label) : null,
      tripId: trip.tripId ? String(trip.tripId) : null, routeId: trip.routeId ? String(trip.routeId) : null,
      latitude, longitude, bearing: Number.isFinite(Number(position.bearing)) ? Number(position.bearing) : null,
      speedMetersPerSecond: Number.isFinite(Number(position.speed)) ? Number(position.speed) : null,
      currentStopSequence: Number.isFinite(Number(vehicle.currentStopSequence)) ? Number(vehicle.currentStopSequence) : null,
      stopId: vehicle.stopId ? String(vehicle.stopId) : null,
      timestamp: vehicle.timestamp ? new Date(Number(vehicle.timestamp) * 1000).toISOString() : null,
      occupancyStatus: vehicle.occupancyStatus ?? null,
    }];
  });
}

export async function fetchHrtRealtime() {
  const [tripPayload, alertsPayload] = await Promise.all([fetchJson(HRT_FEEDS.tripUpdates), fetchJson(HRT_FEEDS.alerts)]);
  const optionalVehicleUrl = process.env.HRT_GTFS_RT_VEHICLE_POSITIONS_JSON_URL;
  let vehiclePayload: Record<string, unknown> | null = null;
  let vehicleError: string | null = null;
  if (optionalVehicleUrl) {
    try { vehiclePayload = await fetchJson(optionalVehicleUrl); }
    catch (error) { vehicleError = error instanceof Error ? error.message : "Vehicle feed failed"; }
  }
  return {
    generatedAt: new Date().toISOString(),
    tripUpdates: normalizeTripUpdates(tripPayload),
    alerts: entities(alertsPayload),
    vehicles: vehiclePayload ? normalizeVehiclePositions(vehiclePayload) : [],
    availability: {
      tripUpdates: true,
      alerts: true,
      vehiclePositions: Boolean(vehiclePayload),
      vehiclePositionsConfigured: Boolean(optionalVehicleUrl),
      vehiclePositionsNote: vehiclePayload ? null : vehicleError || "HRT does not currently list a public vehicle-position feed on its official GTFS page.",
    },
  };
}
