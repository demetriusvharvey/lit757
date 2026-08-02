import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNightPlan,
  parseNightPlanPrompt,
  venueMatchesNightPlanInterest,
  type NightPlanVenue,
} from "./night-planner";

const now = new Date("2026-08-02T22:00:00.000Z");

function venue(overrides: Partial<NightPlanVenue> = {}): NightPlanVenue {
  return {
    id: "venue-1",
    name: "Example Place",
    city: "Norfolk",
    lat: 36.8508,
    lng: -76.2859,
    kind: "activity",
    kinds: ["activity"],
    type: "Entertainment",
    openNow: true,
    activity: {
      score: 62,
      label: "Active Forecast",
      trendLabel: "Steady",
      confidence: "medium",
      scoreMode: "forecast",
    },
    ...overrides,
  };
}

test("natural-language intent captures location, sequence, budget, timing, and access needs", () => {
  const intent = parseNightPlanPrompt(
    "Wheelchair accessible chill date night in Ghent under $100 total: dinner then cocktails, no clubs, at 7:30pm",
    now,
  );
  assert.equal(intent.city, "Norfolk");
  assert.equal(intent.area, "ghent");
  assert.equal(intent.group, "date");
  assert.equal(intent.energy, "quiet");
  assert.deepEqual(intent.interests.slice(0, 2), ["food", "drinks"]);
  assert.equal(intent.budget.amount, 100);
  assert.equal(intent.budget.perPerson, false);
  assert.equal(intent.startMinutes, 19 * 60 + 30);
  assert.equal(intent.constraints.accessibilityRequired, true);
  assert.equal(intent.constraints.noClubs, true);
  assert.ok(intent.understood.includes("date night"));
});

test("sober and family statements suppress adult nightlife defaults", () => {
  const intent = parseNightPlanPrompt("Something fun with kids, sober, no clubs, and no driving", now);
  assert.equal(intent.group, "family");
  assert.equal(intent.constraints.noAlcohol, true);
  assert.equal(intent.constraints.noClubs, true);
  assert.equal(intent.constraints.walkable, true);
  assert.doesNotMatch(intent.interests.join(" "), /drinks|dancing/);
});

test("unusual cuisine and activity words remain useful planning signals", () => {
  const intent = parseNightPlanPrompt("Karaoke then tacos in VB, no long lines", now);
  assert.equal(intent.city, "Virginia Beach");
  assert.deepEqual(intent.interests.slice(0, 2), ["activities", "food"]);
  assert.ok(intent.keywords.includes("karaoke"));
  assert.ok(intent.keywords.includes("tacos"));
  assert.equal(intent.constraints.avoidCrowds, true);
});

test("specific user words outrank generic activity without changing the score", () => {
  const generic = venue({ id: "generic", name: "Popular Restaurant", kind: "food", kinds: ["food"], type: "Restaurant", activity: { score: 98, scoreMode: "live" } });
  const vegan = venue({ id: "vegan", name: "Vegan Garden", kind: "food", kinds: ["food"], type: "Vegan Restaurant", activity: { score: 30, scoreMode: "forecast" } });
  const plan = buildNightPlan([generic, vegan], "One place for vegan dinner", { now });
  assert.equal(plan.stops[0]?.venue.id, "vegan");
  assert.equal(generic.activity?.score, 98);
  assert.equal(vegan.activity?.score, 30);
});

test("under 21 is an age constraint, not a dollar budget", () => {
  const adult = venue({ id: "adult", name: "21 Plus Arcade", ageLimit: "21+", activity: { score: 96, scoreMode: "live" } });
  const allAges = venue({ id: "all-ages", name: "All Ages Arcade", activity: { score: 48, scoreMode: "forecast" } });
  const intent = parseNightPlanPrompt("One fun place under 21", now);
  const plan = buildNightPlan([adult, allAges], "One fun place under 21", { now });
  assert.equal(intent.budget.amount, null);
  assert.equal(intent.constraints.allAgesRequired, true);
  assert.equal(plan.stops[0]?.venue.id, "all-ages");
  assert.ok(plan.caveats.some(caveat => /Age-policy coverage/i.test(caveat)));
});

test("interest matching handles mixed venue metadata and events", () => {
  const restaurantBar = venue({ kind: "food", kinds: ["food", "nightlife"], type: "Restaurant & Cocktail Bar" });
  const concert = venue({ event: { name: "Live Jazz Trio" }, kind: "events", kinds: ["events", "nightlife"] });
  assert.equal(venueMatchesNightPlanInterest(restaurantBar, "food"), true);
  assert.equal(venueMatchesNightPlanInterest(restaurantBar, "drinks"), true);
  assert.equal(venueMatchesNightPlanInterest(concert, "live_music"), true);
});

test("dinner then drinks creates an ordered, open plan without changing Buzz scores", () => {
  const dinner = venue({ id: "dinner", name: "Dinner House", kind: "food", kinds: ["food"], type: "Restaurant", activity: { score: 55, scoreMode: "forecast" } });
  const drinks = venue({ id: "drinks", name: "Granby Cocktail Bar", kind: "nightlife", kinds: ["nightlife"], type: "Cocktail Bar", activity: { score: 74, scoreMode: "live" } });
  const closed = venue({ id: "closed", name: "Closed Supper Club", kind: "food", kinds: ["food", "nightlife"], type: "Restaurant Bar", openNow: false, activity: { score: 99, scoreMode: "live" } });
  const originalScores = [dinner.activity?.score, drinks.activity?.score, closed.activity?.score];

  const plan = buildNightPlan([dinner, drinks, closed], "Dinner then drinks in Norfolk, two stops at 7pm", { now });
  assert.deepEqual(plan.stops.map(stop => stop.interest), ["food", "drinks"]);
  assert.deepEqual(plan.stops.map(stop => stop.venue.id), ["dinner", "drinks"]);
  assert.deepEqual(plan.stops.map(stop => stop.truthLabel), ["Activity forecast", "Live activity"]);
  assert.deepEqual([dinner.activity?.score, drinks.activity?.score, closed.activity?.score], originalScores);
});

test("avoid-crowds intent prefers moderate activity over a hot venue", () => {
  const moderate = venue({ id: "moderate", name: "Quiet Wine Bar", kind: "nightlife", kinds: ["nightlife"], type: "Wine Bar", activity: { score: 58, scoreMode: "forecast" } });
  const hot = venue({ id: "hot", name: "Packed Wine Bar", kind: "nightlife", kinds: ["nightlife"], type: "Wine Bar", activity: { score: 94, scoreMode: "live" } });
  const plan = buildNightPlan([hot, moderate], "One place for wine, not crowded", { now });
  assert.equal(plan.stops[0]?.venue.id, "moderate");
});

test("family planning rejects explicit age restrictions and pure nightlife", () => {
  const arcade = venue({ id: "arcade", name: "Family Arcade", kind: "activity", kinds: ["activity"], type: "Arcade" });
  const adultArcade = venue({ id: "adult", name: "Adults Arcade Bar", kind: "activity", kinds: ["activity", "nightlife"], type: "Arcade Bar", ageLimit: "21+" });
  const club = venue({ id: "club", name: "Night Club", kind: "nightlife", kinds: ["nightlife"], type: "Nightclub" });
  const plan = buildNightPlan([adultArcade, club, arcade], "One fun place with kids", { now });
  assert.equal(plan.stops[0]?.venue.id, "arcade");
});

test("later stops favor a geographically coherent route", () => {
  const dinner = venue({ id: "dinner", name: "Ghent Dinner", kind: "food", kinds: ["food"], type: "Restaurant" });
  const nearby = venue({ id: "near", name: "Nearby Cocktail Bar", lat: 36.851, lng: -76.286, kind: "nightlife", kinds: ["nightlife"], type: "Cocktail Bar", activity: { score: 65, scoreMode: "forecast" } });
  const far = venue({ id: "far", name: "Far Cocktail Bar", lat: 37.03, lng: -76.45, kind: "nightlife", kinds: ["nightlife"], type: "Cocktail Bar", activity: { score: 67, scoreMode: "forecast" } });
  const plan = buildNightPlan([dinner, far, nearby], "Dinner then drinks, two stops in Norfolk", { now });
  assert.equal(plan.stops[1]?.venue.id, "near");
  assert.ok((plan.stops[1]?.travelMinutesFromPrevious || 99) < 10);
});

test("future, budget, accessibility, and forecast limits stay explicit", () => {
  const museum = venue({ id: "museum", name: "Art Museum", type: "Museum", kind: "activity", kinds: ["activity"], activity: { score: 50, scoreMode: "forecast" }, openNow: null });
  const plan = buildNightPlan([museum], "Wheelchair accessible art tomorrow under $40, one place", { now });
  assert.equal(plan.stops.length, 1);
  assert.ok(plan.caveats.some(caveat => /not tomorrow/i.test(caveat)));
  assert.ok(plan.caveats.some(caveat => /under \$40/i.test(caveat)));
  assert.ok(plan.caveats.some(caveat => /Accessibility details/i.test(caveat)));
  assert.ok(plan.caveats.some(caveat => /forecast, not observed crowd size/i.test(caveat)));
});

test("impossible requests return an honest empty plan", () => {
  const closed = venue({ openNow: false });
  const plan = buildNightPlan([closed], "Surprise me tonight", { now });
  assert.equal(plan.stops.length, 0);
  assert.match(plan.summary, /broader request/i);
  assert.ok(plan.caveats.some(caveat => /No open, trustworthy match/i.test(caveat)));
});
