import assert from "node:assert/strict";
import test from "node:test";
import { INSTITUTION_CALENDAR_SOURCES } from "./institution-calendars";
import { VISIT_NEWPORT_NEWS_SOURCE } from "./all-institution-calendars";

test("official tourism registry includes Norfolk, Hampton, and Newport News", () => {
  const tourism = [
    ...INSTITUTION_CALENDAR_SOURCES.filter(source => source.kind === "tourism"),
    VISIT_NEWPORT_NEWS_SOURCE,
  ];
  const ids = new Set(tourism.map(source => source.id));
  assert.ok(ids.has("visit_norfolk_official"));
  assert.ok(ids.has("visit_hampton_official"));
  assert.ok(ids.has("visit_newport_news_official"));
  assert.ok(tourism.every(source => source.enabled));
  assert.ok(tourism.every(source => new URL(source.url).protocol === "https:"));
});
