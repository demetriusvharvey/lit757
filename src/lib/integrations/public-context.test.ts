import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTransitDistrictContext,
  transitEvidenceForDistrict,
  weatherEvidenceForVenue,
  type PublicActivityContext,
} from "./public-context";

const baseContext: PublicActivityContext = {
  generatedAt: "2026-07-22T14:00:00.000Z",
  weather: [{
    city: "Virginia Beach",
    latitude: 36.8529,
    longitude: -75.978,
    generatedAt: "2026-07-22T14:00:00.000Z",
    updatedAt: "2026-07-22T14:00:00.000Z",
    alertCount: 0,
    severeAlert: false,
    impact: { level: "favorable", points: 3, reason: "Sunny" },
    current: null,
    error: null,
  }],
  transitByDistrict: {},
  availability: {
    weather: true,
    hrtStatic: true,
    hrtRealtime: true,
    hrtVehiclePositions: false,
  },
  errors: { weather: [], hrtStatic: null, hrtRealtime: null },
};

test("favorable weather only gives a small outdoor boost", () => {
  const outdoor = weatherEvidenceForVenue(baseContext, 36.8529, -75.978, true);
  const indoor = weatherEvidenceForVenue(baseContext, 36.8529, -75.978, false);
  assert.equal(outdoor.points, 3);
  assert.equal(outdoor.cap, null);
  assert.equal(indoor.points, 0);
});

test("severe weather suppresses outdoor forecasts more than indoor forecasts", () => {
  const context: PublicActivityContext = {
    ...baseContext,
    weather: [{
      ...baseContext.weather[0],
      severeAlert: true,
      alertCount: 1,
      impact: { level: "wet", points: -8, reason: "Heavy rain" },
    }],
  };
  const outdoor = weatherEvidenceForVenue(context, 36.8529, -75.978, true);
  const indoor = weatherEvidenceForVenue(context, 36.8529, -75.978, false);
  assert.equal(outdoor.points, -24);
  assert.equal(outdoor.cap, 52);
  assert.equal(indoor.points, -10);
  assert.equal(indoor.cap, 68);
  assert.equal(outdoor.confidencePenalty, true);
});

test("HRT arrivals become low-weight district support and never direct live proof", () => {
  const reference = new Date("2026-07-22T14:00:00.000Z");
  const transit = buildTransitDistrictContext({
    reference,
    serviceAlerts: 0,
    stops: [{
      id: "oceanfront-stop",
      name: "Oceanfront",
      latitude: 36.8529,
      longitude: -75.978,
    }],
    tripUpdates: Array.from({ length: 7 }, (_, index) => ({
      entityId: String(index),
      routeId: "20",
      tripId: `trip-${index}`,
      stops: [{
        stopId: "oceanfront-stop",
        arrivalTime: new Date(reference.getTime() + (10 + index) * 60_000).toISOString(),
        departureTime: null,
        arrivalDelaySeconds: 60,
        departureDelaySeconds: null,
      }],
    })),
  });

  const context: PublicActivityContext = { ...baseContext, transitByDistrict: transit };
  const evidence = transitEvidenceForDistrict(context, "virginia-beach-oceanfront");
  assert.equal(evidence.available, true);
  assert.equal(evidence.points, 3);
  assert.equal(evidence.cap, null);
  assert.match(String(evidence.label), /HRT arrivals/);
});

test("major HRT delays remove most transit support", () => {
  const reference = new Date("2026-07-22T14:00:00.000Z");
  const transit = buildTransitDistrictContext({
    reference,
    serviceAlerts: 6,
    stops: [{
      id: "downtown-stop",
      name: "Downtown Norfolk",
      latitude: 36.8468,
      longitude: -76.292,
    }],
    tripUpdates: Array.from({ length: 8 }, (_, index) => ({
      entityId: String(index),
      routeId: "1",
      tripId: `delayed-${index}`,
      stops: [{
        stopId: "downtown-stop",
        arrivalTime: new Date(reference.getTime() + (5 + index) * 60_000).toISOString(),
        departureTime: null,
        arrivalDelaySeconds: 1_200,
        departureDelaySeconds: null,
      }],
    })),
  });

  const row = transit["downtown-norfolk-waterside"];
  assert.equal(row.degraded, true);
  assert.equal(row.points, 1);
  assert.match(String(row.label), /disruptions/);
});
