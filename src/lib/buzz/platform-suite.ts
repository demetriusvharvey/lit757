import { buildUnifiedActivity, predictArrivalActivity, type ActivityState, type ActivityTrend, type ConfidenceLevel, type IntentId, type UnifiedActivity } from "./product-intelligence";

export type RawVenue = {
  id: string;
  name: string;
  city: string;
  address?: string | null;
  lat: number;
  lng: number;
  type?: string | null;
  category?: string | null;
  kind?: string | null;
  score?: number | null;
  confidence?: string | null;
  reason?: string | null;
  timing?: string | null;
  openNow?: boolean | null;
  parking?: string | null;
  cover?: string | null;
  ageLimit?: string | null;
  dressCode?: string | null;
  photoUrl?: string | null;
  website?: string | null;
  phone?: string | null;
  interestTags?: string[];
  heat?: { level?: string; label?: string; detail?: string; source?: string } | null;
  event?: { id?: string; name?: string; startTime?: string | null; endTime?: string | null; timeLabel?: string; sourceUrl?: string | null; ticketStatus?: string | null } | null;
};

export type SignalProvenance = {
  source: string;
  family: "verified_presence" | "community_report" | "official_venue" | "traffic" | "parking" | "event" | "historical" | "model";
  observedAt: string;
  expiresAt: string;
  confidence: number;
  direct: boolean;
  verifiedNearby?: boolean;
  corroborations?: number;
};

export type LiveVenue = RawVenue & {
  activity: UnifiedActivity;
  arrival: ReturnType<typeof predictArrivalActivity>;
  fit: string[];
  whyNow: string[];
  practical: {
    line: "short" | "long" | "unknown";
    parking: "easy" | "hard" | "unknown";
    cover: string;
    age: string;
    open: string;
  };
  trust: {
    signalCount: number;
    directCount: number;
    verifiedCount: number;
    manipulationRisk: "low" | "medium" | "high";
  };
};

export type CityPulse = {
  headline: string;
  risingAreas: string[];
  coolingAreas: string[];
  strongestArea: string | null;
  changes: string[];
};

export type DynamicCollection = { id: string; label: string; description: string; venueIds: string[] };

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const minutesBetween = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 60_000);

export function defaultTtlMinutes(family: SignalProvenance["family"]) {
  if (family === "verified_presence") return 20;
  if (family === "community_report") return 35;
  if (family === "traffic" || family === "parking") return 15;
  if (family === "event") return 180;
  if (family === "official_venue") return 360;
  if (family === "historical" || family === "model") return 90;
  return 30;
}

export function normalizeSignals(venue: RawVenue, generatedAt = new Date()): SignalProvenance[] {
  const observedAt = generatedAt.toISOString();
  const signals: SignalProvenance[] = [];
  const add = (family: SignalProvenance["family"], source: string, confidence: number, direct: boolean, ttl = defaultTtlMinutes(family)) => {
    signals.push({ source, family, observedAt, expiresAt: new Date(generatedAt.getTime() + ttl * 60_000).toISOString(), confidence, direct, verifiedNearby: family === "verified_presence", corroborations: direct ? 1 : 0 });
  };
  if (venue.heat) add("verified_presence", venue.heat.source || "verified_nearby", venue.heat.level === "hot" ? 0.9 : 0.78, true);
  if (venue.event) add("event", "official_event", 0.82, true);
  if (venue.parking && !/unknown/i.test(venue.parking)) add("parking", "venue_parking", 0.52, false);
  if (venue.score != null) add("model", "buzz_score", venue.confidence?.toLowerCase().includes("high") ? 0.78 : 0.58, false);
  add("historical", "venue_baseline", 0.46, false);
  return signals;
}

export function sourceWeight(signal: SignalProvenance, now = new Date()) {
  if (new Date(signal.expiresAt).getTime() <= now.getTime()) return 0;
  const familyWeight: Record<SignalProvenance["family"], number> = {
    verified_presence: 1,
    community_report: 0.82,
    official_venue: 0.52,
    traffic: 0.62,
    parking: 0.58,
    event: 0.7,
    historical: 0.38,
    model: 0.44,
  };
  const age = Math.max(0, minutesBetween(now, new Date(signal.observedAt)));
  const ttl = Math.max(1, minutesBetween(new Date(signal.expiresAt), new Date(signal.observedAt)));
  const freshness = Math.max(0.1, 1 - age / ttl);
  const verification = signal.verifiedNearby ? 1.15 : 1;
  const corroboration = 1 + Math.min(0.25, (signal.corroborations || 0) * 0.05);
  return familyWeight[signal.family] * signal.confidence * freshness * verification * corroboration;
}

export function detectManipulation(signals: SignalProvenance[]) {
  const direct = signals.filter(signal => signal.direct);
  const sources = new Set(direct.map(signal => signal.source));
  if (direct.length >= 5 && sources.size <= 1) return "high" as const;
  if (direct.length >= 3 && sources.size <= 1) return "medium" as const;
  return "low" as const;
}

function inferTrend(venue: RawVenue): { trend: ActivityTrend; delta: number } {
  const reason = `${venue.reason || ""} ${venue.heat?.detail || ""}`.toLowerCase();
  if (/surging|spike|rapid|filling fast/.test(reason)) return { trend: "surging", delta: 16 };
  if (/rising|picking up|growing|starting/.test(reason)) return { trend: "rising", delta: 8 };
  if (/cooling|slowing|ending|clearing/.test(reason)) return { trend: "falling", delta: -8 };
  return { trend: "stable", delta: 0 };
}

function travelMinutes(distanceMiles?: number | null) {
  if (distanceMiles == null) return null;
  return Math.max(4, Math.round(distanceMiles * 2.4 + 4));
}

function fitLabels(venue: RawVenue, activity: UnifiedActivity) {
  const labels: string[] = [];
  const category = `${venue.kind || ""} ${venue.type || ""} ${venue.category || ""}`.toLowerCase();
  if (activity.state === "hot") labels.push("High-energy night out");
  if (activity.state === "active" && activity.trend !== "surging") labels.push("Active without overcrowding");
  if (/food|restaurant|cafe|bar/.test(category)) labels.push("Food and drinks");
  if (/activity|museum|park|family|arcade|bowling/.test(category)) labels.push("Groups and activities");
  if (/easy|garage|lot/.test(venue.parking || "")) labels.push("Lower parking friction");
  if (!venue.cover || /free|none|unknown/i.test(venue.cover)) labels.push("Budget-friendly");
  return labels.slice(0, 3);
}

function whyNow(venue: RawVenue, activity: UnifiedActivity) {
  const reasons: string[] = [];
  if (activity.trend === "surging") reasons.push("Activity is accelerating faster than nearby places.");
  else if (activity.trend === "rising") reasons.push("Activity is building now.");
  if (activity.truthMode === "live") reasons.push("Recent direct evidence supports this status.");
  if (venue.event) reasons.push(`${venue.event.name || "A scheduled event"} is influencing demand.`);
  if (/easy/i.test(venue.parking || "")) reasons.push("Parking appears easier than many nearby options.");
  if (!reasons.length) reasons.push(venue.reason || "Buzz combined current patterns, timing, and nearby activity.");
  return reasons.slice(0, 3);
}

export function enrichVenue(venue: RawVenue, options: { generatedAt?: Date; distanceMiles?: number | null; horizonMinutes?: number; intent?: IntentId } = {}): LiveVenue {
  const now = options.generatedAt || new Date();
  const signals = normalizeSignals(venue, now);
  const trend = inferTrend(venue);
  const bestObserved = signals.filter(signal => signal.direct).sort((a, b) => sourceWeight(b, now) - sourceWeight(a, now))[0];
  const totalWeight = signals.reduce((sum, signal) => sum + sourceWeight(signal, now), 0);
  const confidence: ConfidenceLevel = totalWeight >= 1.5 ? "high" : totalWeight >= 0.75 ? "medium" : "low";
  const activity = buildUnifiedActivity({
    score: venue.score,
    confidence,
    observedAt: bestObserved?.observedAt || now.toISOString(),
    expiresAt: bestObserved?.expiresAt || new Date(now.getTime() + 90 * 60_000).toISOString(),
    isLive: Boolean(bestObserved),
    signalCount: signals.length,
    trendDelta: trend.delta,
    reason: venue.heat?.detail || venue.reason,
    sources: signals,
    now,
  });
  const trip = travelMinutes(options.distanceMiles);
  const arrival = predictArrivalActivity({
    currentScore: activity.score ?? 0,
    trend: activity.trend,
    travelMinutes: trip == null ? options.horizonMinutes ?? null : trip + (options.horizonMinutes || 0),
    historicalSlopePerHour: trend.delta * 0.35,
    parkingDelayMinutes: /hard|difficult|tough/i.test(venue.parking || "") ? 15 : /easy/i.test(venue.parking || "") ? 3 : 7,
    confidence,
  });
  return {
    ...venue,
    activity,
    arrival,
    fit: fitLabels(venue, activity),
    whyNow: whyNow(venue, activity),
    practical: {
      line: /short/i.test(venue.reason || "") ? "short" : /long line|wait/i.test(venue.reason || "") ? "long" : "unknown",
      parking: /easy/i.test(venue.parking || "") ? "easy" : /hard|difficult|tough/i.test(venue.parking || "") ? "hard" : "unknown",
      cover: venue.cover || "Not reported",
      age: venue.ageLimit || "Not reported",
      open: venue.openNow === true ? "Open now" : venue.openNow === false ? "Closed" : venue.timing || "Hours not confirmed",
    },
    trust: {
      signalCount: signals.length,
      directCount: signals.filter(signal => signal.direct).length,
      verifiedCount: signals.filter(signal => signal.verifiedNearby).length,
      manipulationRisk: detectManipulation(signals),
    },
  };
}

export function scoreForIntent(venue: LiveVenue, intent: IntentId) {
  let score = venue.activity.score || 0;
  const energy = venue.activity.state === "hot" ? 24 : venue.activity.state === "active" ? 12 : -8;
  const rising = ["rising", "surging"].includes(venue.activity.trend) ? 12 : 0;
  const confidence = venue.activity.confidence === "high" ? 10 : venue.activity.confidence === "medium" ? 4 : -8;
  if (intent === "best_now") score += energy + rising + confidence;
  if (intent === "high_energy") score += energy * 1.8 + rising;
  if (intent === "chill") score += venue.activity.state === "active" ? 28 : venue.activity.state === "hot" ? -16 : 4;
  if (intent === "short_line") score += venue.practical.line === "short" ? 30 : venue.practical.line === "long" ? -30 : 0;
  if (intent === "easy_parking") score += venue.practical.parking === "easy" ? 30 : venue.practical.parking === "hard" ? -24 : 0;
  if (intent === "food_now") score += /food|restaurant|cafe|bar/i.test(`${venue.kind} ${venue.type} ${venue.category}`) ? 28 : -18;
  if (intent === "date_night") score += venue.activity.state === "active" ? 20 : 0;
  if (intent === "group") score += /activity|bowling|arcade|event|bar/i.test(`${venue.kind} ${venue.type} ${venue.category}`) ? 20 : 0;
  if (intent === "family") score += /family|museum|park|activity/i.test(`${venue.kind} ${venue.type} ${venue.category}`) ? 28 : -12;
  if (intent === "free") score += /free|none/i.test(venue.cover || "") ? 28 : 0;
  if (intent === "open_late") score += /late|am|midnight/i.test(venue.timing || "") ? 24 : 0;
  if (intent === "ending_soon") score += venue.event ? 26 : 0;
  if (intent === "different") score += Math.abs(hash(venue.id)) % 24;
  return score;
}

function hash(value: string) {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) result = ((result << 5) - result + value.charCodeAt(index)) | 0;
  return result;
}

export function rankVenues(venues: LiveVenue[], intent: IntentId) {
  return [...venues].sort((a, b) => scoreForIntent(b, intent) - scoreForIntent(a, intent));
}

export function buildCollections(venues: LiveVenue[]): DynamicCollection[] {
  const ids = (filter: (venue: LiveVenue) => boolean, limit = 8) => venues.filter(filter).slice(0, limit).map(venue => venue.id);
  return [
    { id: "rising", label: "Rising fastest", description: "Places gaining energy now.", venueIds: ids(venue => ["rising", "surging"].includes(venue.activity.trend)) },
    { id: "arrival", label: "Worth leaving now", description: "Expected to work when you arrive.", venueIds: ids(venue => ["active", "hot"].includes(venue.arrival.state)) },
    { id: "easy", label: "Active with easy parking", description: "Good activity with less friction.", venueIds: ids(venue => venue.practical.parking === "easy" && venue.activity.state !== "quiet") },
    { id: "comfortable", label: "Active, not overcrowded", description: "Energy without maximum crowding.", venueIds: ids(venue => venue.activity.state === "active") },
    { id: "events", label: "Event-driven right now", description: "Scheduled activity shaping the area.", venueIds: ids(venue => Boolean(venue.event)) },
    { id: "backup", label: "Strong backup options", description: "Reliable alternatives if your first choice changes.", venueIds: ids(venue => venue.activity.confidence !== "low" && venue.arrival.outlook !== "cooler") },
  ].filter(collection => collection.venueIds.length > 0);
}

export function buildCityPulse(venues: LiveVenue[]): CityPulse {
  const byCity = new Map<string, LiveVenue[]>();
  for (const venue of venues) byCity.set(venue.city, [...(byCity.get(venue.city) || []), venue]);
  const cityScores = [...byCity.entries()].map(([city, items]) => ({ city, score: items.reduce((sum, item) => sum + (item.activity.score || 0), 0) / items.length, rising: items.filter(item => ["rising", "surging"].includes(item.activity.trend)).length, cooling: items.filter(item => item.activity.trend === "falling").length })).sort((a, b) => b.score - a.score);
  const strongestArea = cityScores[0]?.city || null;
  const risingAreas = cityScores.filter(item => item.rising > 0).sort((a, b) => b.rising - a.rising).map(item => item.city).slice(0, 3);
  const coolingAreas = cityScores.filter(item => item.cooling > 0).sort((a, b) => b.cooling - a.cooling).map(item => item.city).slice(0, 3);
  const changes: string[] = [];
  if (risingAreas[0]) changes.push(`${risingAreas[0]} has the strongest upward movement.`);
  const liveCount = venues.filter(venue => venue.activity.truthMode === "live").length;
  if (liveCount) changes.push(`${liveCount} place${liveCount === 1 ? " has" : "s have"} fresh direct evidence.`);
  const eventCount = venues.filter(venue => venue.event).length;
  if (eventCount) changes.push(`${eventCount} scheduled event${eventCount === 1 ? " is" : "s are"} influencing activity.`);
  return { headline: strongestArea ? `${strongestArea} is leading the 757 right now${risingAreas[0] ? ` while ${risingAreas[0]} is building` : ""}.` : "Buzz is waiting for enough fresh citywide evidence.", risingAreas, coolingAreas, strongestArea, changes };
}

export type GroupPreference = { energy: "chill" | "balanced" | "high"; parkingImportant: boolean; budget: "free" | "moderate" | "any"; maxDistanceMiles?: number | null };

export function chooseForGroup(venues: LiveVenue[], preference: GroupPreference) {
  const scored = venues.map(venue => {
    let score = venue.activity.score || 0;
    if (preference.energy === "high") score += venue.activity.state === "hot" ? 24 : 0;
    if (preference.energy === "chill") score += venue.activity.state === "active" ? 22 : venue.activity.state === "hot" ? -14 : 0;
    if (preference.parkingImportant) score += venue.practical.parking === "easy" ? 20 : venue.practical.parking === "hard" ? -20 : 0;
    if (preference.budget === "free") score += /free|none/i.test(venue.cover || "") ? 22 : -12;
    score += venue.activity.confidence === "high" ? 8 : 0;
    score += venue.arrival.outlook === "stronger" ? 8 : venue.arrival.outlook === "cooler" ? -10 : 0;
    return { venue, score };
  }).sort((a, b) => b.score - a.score);
  return { bestOverall: scored[0]?.venue || null, mostActive: [...venues].sort((a, b) => (b.activity.score || 0) - (a.activity.score || 0))[0] || null, easiest: [...venues].sort((a, b) => (b.practical.parking === "easy" ? 1 : 0) - (a.practical.parking === "easy" ? 1 : 0))[0] || null, backups: scored.slice(1, 4).map(item => item.venue) };
}

export function privacySafeAreaActivity(venues: LiveVenue[], minimumCount = 3) {
  const cells = new Map<string, LiveVenue[]>();
  for (const venue of venues) {
    const key = `${venue.lat.toFixed(2)}:${venue.lng.toFixed(2)}`;
    cells.set(key, [...(cells.get(key) || []), venue]);
  }
  return [...cells.entries()].filter(([, items]) => items.length >= minimumCount).map(([id, items]) => ({ id, countBand: items.length >= 12 ? "12+" : items.length >= 6 ? "6-11" : "3-5", averageScore: Math.round(items.reduce((sum, item) => sum + (item.activity.score || 0), 0) / items.length), center: { lat: items.reduce((sum, item) => sum + item.lat, 0) / items.length, lng: items.reduce((sum, item) => sum + item.lng, 0) / items.length } }));
}

export function officialAndIndependentTruth(venue: LiveVenue) {
  return {
    official: {
      hours: venue.timing || null,
      event: venue.event?.name || null,
      cover: venue.cover || null,
      parkingInstructions: venue.parking || null,
    },
    independent: {
      state: venue.activity.state,
      trend: venue.activity.trend,
      truthMode: venue.activity.truthMode,
      confidence: venue.activity.confidence,
      updated: venue.activity.freshnessLabel,
    },
    prediction: {
      stateOnArrival: venue.arrival.state,
      outlook: venue.arrival.outlook,
      detail: venue.arrival.detail,
    },
  };
}

export function productMetrics(venues: LiveVenue[]) {
  const known = venues.filter(venue => venue.activity.truthMode !== "insufficient");
  const live = venues.filter(venue => venue.activity.truthMode === "live");
  const highConfidence = venues.filter(venue => venue.activity.confidence === "high");
  const arrivalUseful = venues.filter(venue => venue.arrival.outlook !== "uncertain");
  return {
    coveragePct: venues.length ? Math.round((known.length / venues.length) * 100) : 0,
    livePct: venues.length ? Math.round((live.length / venues.length) * 100) : 0,
    highConfidencePct: venues.length ? Math.round((highConfidence.length / venues.length) * 100) : 0,
    arrivalCoveragePct: venues.length ? Math.round((arrivalUseful.length / venues.length) * 100) : 0,
    unknownCount: venues.length - known.length,
    manipulationRiskCount: venues.filter(venue => venue.trust.manipulationRisk !== "low").length,
  };
}
