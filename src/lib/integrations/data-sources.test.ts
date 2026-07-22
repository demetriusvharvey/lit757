import assert from "node:assert/strict";
import test from "node:test";
import { weatherActivityImpact } from "./nws";
import { normalizeTripUpdates, normalizeVehiclePositions, parseCsv } from "./hrt";

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

test("vehicle positions normalize coordinates when a feed becomes available", () => {
  const vehicles = normalizeVehiclePositions({ entity: [{ id: "v1", vehicle: {
    vehicle: { id: "bus-12", label: "12" }, trip: { tripId: "t1", routeId: "1" },
    position: { latitude: 36.85, longitude: -76.28, bearing: 90, speed: 8 }, timestamp: 1784736000,
  } }] });
  assert.equal(vehicles.length, 1);
  assert.equal(vehicles[0].vehicleId, "bus-12");
  assert.equal(vehicles[0].latitude, 36.85);
});
