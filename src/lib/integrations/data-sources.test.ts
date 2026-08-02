import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { weatherActivityImpact } from "./nws";
import { normalizeTripUpdates, normalizeVehiclePositions, parseCsv, readZipEntry } from "./hrt";

function dataDescriptorZip(fileNameValue: string, contentValue: string) {
  const fileName = Buffer.from(fileNameValue, "utf8");
  const content = Buffer.from(contentValue, "utf8");
  const compressed = deflateRawSync(content);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x08, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(fileName.length, 26);

  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(0, 4);
  descriptor.writeUInt32LE(compressed.length, 8);
  descriptor.writeUInt32LE(content.length, 12);

  const centralOffset = local.length + fileName.length + compressed.length + descriptor.length;
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x08, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(0, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  central.writeUInt32LE(0, 42);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + fileName.length, 12);
  end.writeUInt32LE(centralOffset, 16);

  return Buffer.concat([local, fileName, compressed, descriptor, central, fileName, end]);
}

test("weather activity impact distinguishes storms and favorable weather", () => {
  const storm = weatherActivityImpact({
    number: 1, name: "Tonight", startTime: "2026-07-22T18:00:00-04:00", endTime: "2026-07-23T06:00:00-04:00",
    isDaytime: false, temperature: 78, temperatureUnit: "F", probabilityOfPrecipitation: { value: 80 },
    windSpeed: "10 mph", windDirection: "SW", shortForecast: "Thunderstorms", detailedForecast: "Heavy rain possible",
  });
  assert.equal(storm.level, "disruptive");
  assert.ok(storm.points < 0);

  const clear = weatherActivityImpact({
    number: 2, name: "Friday", startTime: "2026-07-24T06:00:00-04:00", endTime: "2026-07-24T18:00:00-04:00",
    isDaytime: true, temperature: 82, temperatureUnit: "F", probabilityOfPrecipitation: { value: 5 },
    windSpeed: "5 mph", windDirection: "E", shortForecast: "Sunny", detailedForecast: "Sunny and comfortable",
  });
  assert.equal(clear.level, "favorable");
  assert.ok(clear.points > 0);
});

test("GTFS CSV parser supports quoted commas and escaped quotes", () => {
  const rows = parseCsv('stop_id,stop_name,stop_lat,stop_lon\r\n1,"Main St, East",36.8,-76.2\r\n2,"The ""Hub""",36.9,-76.3\r\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].stop_name, "Main St, East");
  assert.equal(rows[1].stop_name, 'The "Hub"');
});

test("GTFS ZIP reader supports data descriptors using central-directory sizes", () => {
  const content = "route_id,route_short_name\r\n20,Virginia Beach\r\n";
  const archive = dataDescriptorZip("routes.txt", content);
  assert.equal(readZipEntry(archive, "routes.txt"), content);
});

test("trip updates normalize arrival predictions", () => {
  const updates = normalizeTripUpdates({ entity: [{ id: "one", tripUpdate: {
    trip: { tripId: "trip-1", routeId: "20", startDate: "20260722" }, vehicle: { id: "bus-4" }, timestamp: 1784736000,
    stopTimeUpdate: [{ stopId: "stop-1", stopSequence: 3, arrival: { time: 1784736300, delay: 120 }, departure: { time: 1784736360 } }],
  } }] });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].routeId, "20");
  assert.equal(updates[0].stops[0].stopId, "stop-1");
  assert.equal(updates[0].stops[0].arrivalDelaySeconds, 120);
});

test("trip updates normalize HRT's current snake-case JSON feed", () => {
  const updates = normalizeTripUpdates({ entity: [{ id: "two", trip_update: {
    trip: { trip_id: "trip-2", route_id: "105", start_date: "20260801" },
    vehicle: { id: "bus-55" },
    timestamp: 1785636028,
    stop_time_update: [{
      stop_id: "stop-9",
      stop_sequence: 4,
      arrival: { time: 1785636300, delay: 60 },
      departure: { time: 1785636360 },
      schedule_relationship: 0,
    }],
  } }] });

  assert.equal(updates.length, 1);
  assert.equal(updates[0].tripId, "trip-2");
  assert.equal(updates[0].routeId, "105");
  assert.equal(updates[0].stops[0].stopId, "stop-9");
  assert.equal(updates[0].stops[0].stopSequence, 4);
});

test("vehicle positions normalize coordinates when a feed becomes available", () => {
  const vehicles = normalizeVehiclePositions({ entity: [{ id: "v1", vehicle: {
    vehicle: { id: "bus-12", label: "12" }, trip: { tripId: "t1", routeId: "1" },
    position: { latitude: 36.85, longitude: -76.28, bearing: 90, speed: 8 }, timestamp: 1784736000,
  } }] });
  assert.equal(vehicles.length, 1);
  assert.equal(vehicles[0].vehicleId, "bus-12");
  assert.equal(vehicles[0].latitude, 36.85);
});
