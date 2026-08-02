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

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const MAX_ZIP_COMMENT_BYTES = 0xffff;

function endOfCentralDirectory(buffer: Buffer) {
  const minimum = Math.max(0, buffer.length - 22 - MAX_ZIP_COMMENT_BYTES);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  throw new Error("HRT GTFS archive has no ZIP central directory");
}

export function readZipEntry(buffer: Buffer, wantedName: string) {
  const end = endOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(end + 10);
  const centralSize = buffer.readUInt32LE(end + 12);
  const centralOffset = buffer.readUInt32LE(end + 16);
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error("ZIP64 GTFS archives are not supported");
  }
  if (centralOffset + centralSize > buffer.length) {
    throw new Error("HRT GTFS central directory is truncated");
  }

  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_HEADER) {
      throw new Error("HRT GTFS central directory entry is invalid");
    }

    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    if (nameEnd > buffer.length) throw new Error("HRT GTFS ZIP filename is truncated");
    const fileName = buffer.subarray(nameStart, nameEnd).toString("utf8");

    if (fileName === wantedName) {
      if (flags & 0x01) throw new Error("Encrypted GTFS ZIP entries are not supported");
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
        throw new Error("ZIP64 GTFS entries are not supported");
      }
      if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) {
        throw new Error(`Local ZIP header is invalid for ${wantedName}`);
      }
      const localFileNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localFileNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > buffer.length) throw new Error(`${wantedName} is truncated in the HRT GTFS archive`);
      const compressed = buffer.subarray(dataStart, dataEnd);
      const output = method === 0
        ? compressed
        : method === 8
          ? inflateRawSync(compressed)
          : null;
      if (!output) throw new Error(`Unsupported ZIP compression method ${method}`);
      if (uncompressedSize && output.length !== uncompressedSize) {
        throw new Error(`${wantedName} did not match its declared uncompressed size`);
      }
      return output.toString("utf8");
    }

    offset = nameEnd + extraLength + commentLength;
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
  const routes = parseCsv(readZipEntry(archive, "routes.txt")).map(route => ({
    id: route.route_id,
    shortName: route.route_short_name,
    longName: route.route_long_name,
    description: route.route_desc || null,
    type: Number(route.route_type),
    color: route.route_color || null,
    textColor: route.route_text_color || null,
  }));
  const stops = parseCsv(readZipEntry(archive, "stops.txt")).map(stop => ({
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

function objectField(record: Record<string, unknown>, camelCase: string, snakeCase: string) {
  const value = record[camelCase] ?? record[snakeCase];
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function arrayField(record: Record<string, unknown>, camelCase: string, snakeCase: string) {
  const value = record[camelCase] ?? record[snakeCase];
  return Array.isArray(value) ? value as Array<Record<string, unknown>> : [];
}

function scalarField(record: Record<string, unknown>, camelCase: string, snakeCase: string) {
  return record[camelCase] ?? record[snakeCase];
}

export function normalizeTripUpdates(payload: Record<string, unknown>) {
  return entities(payload).flatMap(entity => {
    const update = objectField(entity, "tripUpdate", "trip_update");
    if (!Object.keys(update).length) return [];
    const trip = objectField(update, "trip", "trip");
    const vehicle = objectField(update, "vehicle", "vehicle");
    const stopTimeUpdate = arrayField(update, "stopTimeUpdate", "stop_time_update");
    return [{
      entityId: String(entity.id || ""),
      tripId: String(scalarField(trip, "tripId", "trip_id") || ""),
      routeId: String(scalarField(trip, "routeId", "route_id") || ""),
      startDate: String(scalarField(trip, "startDate", "start_date") || ""),
      vehicleId: vehicle.id ? String(vehicle.id) : null,
      timestamp: update.timestamp ? new Date(Number(update.timestamp) * 1000).toISOString() : null,
      stops: stopTimeUpdate.map(stop => {
        const arrival = objectField(stop, "arrival", "arrival");
        const departure = objectField(stop, "departure", "departure");
        const arrivalTime = Number(arrival.time || 0);
        const departureTime = Number(departure.time || 0);
        return {
          stopId: String(scalarField(stop, "stopId", "stop_id") || ""),
          stopSequence: Number(scalarField(stop, "stopSequence", "stop_sequence") || 0),
          arrivalTime: arrivalTime ? new Date(arrivalTime * 1000).toISOString() : null,
          departureTime: departureTime ? new Date(departureTime * 1000).toISOString() : null,
          arrivalDelaySeconds: Number.isFinite(Number(arrival.delay)) ? Number(arrival.delay) : null,
          departureDelaySeconds: Number.isFinite(Number(departure.delay)) ? Number(departure.delay) : null,
          scheduleRelationship: scalarField(stop, "scheduleRelationship", "schedule_relationship") ?? null,
        };
      }),
    }];
  });
}

export function normalizeVehiclePositions(payload: Record<string, unknown>) {
  return entities(payload).flatMap(entity => {
    const vehicle = objectField(entity, "vehicle", "vehicle");
    if (!Object.keys(vehicle).length) return [];
    const position = objectField(vehicle, "position", "position");
    const descriptor = objectField(vehicle, "vehicle", "vehicle");
    const trip = objectField(vehicle, "trip", "trip");
    const latitude = Number(position.latitude);
    const longitude = Number(position.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
    return [{
      entityId: String(entity.id || ""), vehicleId: String(descriptor.id || ""), label: descriptor.label ? String(descriptor.label) : null,
      tripId: scalarField(trip, "tripId", "trip_id") ? String(scalarField(trip, "tripId", "trip_id")) : null,
      routeId: scalarField(trip, "routeId", "route_id") ? String(scalarField(trip, "routeId", "route_id")) : null,
      latitude, longitude, bearing: Number.isFinite(Number(position.bearing)) ? Number(position.bearing) : null,
      speedMetersPerSecond: Number.isFinite(Number(position.speed)) ? Number(position.speed) : null,
      currentStopSequence: Number.isFinite(Number(scalarField(vehicle, "currentStopSequence", "current_stop_sequence")))
        ? Number(scalarField(vehicle, "currentStopSequence", "current_stop_sequence"))
        : null,
      stopId: scalarField(vehicle, "stopId", "stop_id") ? String(scalarField(vehicle, "stopId", "stop_id")) : null,
      timestamp: vehicle.timestamp ? new Date(Number(vehicle.timestamp) * 1000).toISOString() : null,
      occupancyStatus: scalarField(vehicle, "occupancyStatus", "occupancy_status") ?? null,
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
