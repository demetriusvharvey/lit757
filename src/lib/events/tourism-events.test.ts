import assert from "node:assert/strict";
import test from "node:test";
import {
  extractTourismEventRows,
  parseVisitNorfolkEvents,
} from "./tourism-events";

const source = {
  id: "visit_norfolk_official",
  name: "VisitNorfolk Events",
  city: "Norfolk",
  url: "https://www.visitnorfolk.com/events/",
};

const listing = `<html><script>window.events = [{"title":"25th Annual Norfolk Latino Music Festival","label":"Featured Event","img":"/wp-content/event.jpg","desc":"Salsa, music and food.","id":44944,"type":"event","url":"/event/latino-music-festival/","dates":[1784332800],"time":"2:00 p.m. - 11:00 p.m."},{"title":"Downtown Norfolk Restaurant Week","label":"Multi-Day Event","img":null,"desc":null,"id":53874,"type":"event","url":"/event/restaurant-week/","dates":[1784505600,1784592000],"time":"All day"}];</script></html>`;

test("extracts the largest embedded official tourism event array", () => {
  const rows = extractTourismEventRows(listing);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, "25th Annual Norfolk Latino Music Festival");
});

test("normalizes embedded VisitNorfolk events and repeated dates", () => {
  const events = parseVisitNorfolkEvents(listing, source);
  assert.equal(events.length, 3);
  const festival = events.find(event => event.name.includes("Latino"));
  assert.ok(festival);
  assert.equal(festival.city, "Norfolk");
  assert.equal(festival.start_time, "2026-07-18T14:00:00-04:00");
  assert.equal(festival.end_time, "2026-07-18T23:00:00-04:00");
  assert.equal(festival.source_url, "https://www.visitnorfolk.com/event/latino-music-festival/");
  assert.equal(festival.image_url, "https://www.visitnorfolk.com/wp-content/event.jpg");
  assert.equal(events.filter(event => event.name.includes("Restaurant Week")).length, 2);
});

test("all-day tourism events use a stable local-noon representation", () => {
  const event = parseVisitNorfolkEvents(listing, source).find(item => item.name.includes("Restaurant Week"));
  assert.ok(event);
  assert.equal(event.start_time, "2026-07-20T12:00:00-04:00");
  assert.equal(event.end_time, null);
});

test("ignores unrelated JavaScript arrays", () => {
  const html = `<script>const colors = ["red","blue"];</script>${listing}`;
  assert.equal(extractTourismEventRows(html).length, 2);
});
