import assert from "node:assert/strict";
import test from "node:test";
import { priorityNightlifeScopeIds } from "./priority-nightlife-scopes";

test("priority nightlife scopes identify the Oceanfront and Downtown Norfolk", () => {
  assert.deepEqual(priorityNightlifeScopeIds({
    city: "Virginia Beach",
    lat: 36.8529,
    lng: -75.978,
  }), ["virginia-beach-oceanfront"]);
  assert.deepEqual(priorityNightlifeScopeIds({
    city: "Norfolk",
    lat: 36.8505,
    lng: -76.2900,
  }), ["downtown-norfolk"]);
});

test("nearest district prevents Norfolk points from leaking into Portsmouth", () => {
  assert.deepEqual(priorityNightlifeScopeIds({
    city: null,
    lat: 36.8505,
    lng: -76.2900,
  }), ["downtown-norfolk"]);
  assert.deepEqual(priorityNightlifeScopeIds({
    city: null,
    lat: 36.8336,
    lng: -76.3019,
  }), ["portsmouth-city"]);
});

test("all explicitly tagged Portsmouth locations remain in the city scope", () => {
  assert.deepEqual(priorityNightlifeScopeIds({
    city: "Portsmouth",
    lat: 36.864,
    lng: -76.39,
  }), ["portsmouth-city"]);
  const contradictoryNorfolkLocation = priorityNightlifeScopeIds({
    city: "Norfolk",
    lat: 36.8336,
    lng: -76.3019,
  });
  assert.equal(contradictoryNorfolkLocation.includes("portsmouth-city"), false);
});

test("a street-address city overrides an incorrect stored city", () => {
  assert.deepEqual(priorityNightlifeScopeIds({
    city: "Portsmouth",
    address: "332 Granby St, Norfolk, VA 23510",
    lat: 36.8505,
    lng: -76.2900,
  }), ["downtown-norfolk"]);
});
