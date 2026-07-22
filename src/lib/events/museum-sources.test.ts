import assert from "node:assert/strict";
import test from "node:test";
import { INSTITUTION_CALENDAR_SOURCES } from "./institution-calendars";

test("institution registry includes official Chrysler and Mariners museum sources", () => {
  const sources = new Map(INSTITUTION_CALENDAR_SOURCES.map(source => [source.id, source]));
  assert.equal(sources.get("chrysler_museum_official")?.kind, "museum");
  assert.equal(sources.get("chrysler_museum_official")?.format, "tribe-api");
  assert.equal(sources.get("mariners_museum_official")?.kind, "museum");
  assert.equal(sources.get("mariners_museum_official")?.format, "tribe-api");
});
