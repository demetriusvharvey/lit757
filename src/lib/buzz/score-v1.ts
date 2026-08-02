import type { BuzzConfidence, BuzzScoreFactor, BuzzScoreResult, BuzzSignal, BuzzSignalFamily, VenueForBuzz } from "./types";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const FAMILY_CAPS: Record<BuzzSignalFamily, number> = {
  foot_traffic: 46,
  verified_users: 30,
  first_party_occupancy: 44,
  commercial_demand: 22,
  event_forecast: 10,
  mobility: 7,
  historical_learning: 18,
};

const SOURCE_RELIABILITY: Record<string, number> = {
  venue_partner: 1,
  lit757_users: 0.95,
  besttime: 0.9,
  ticketmaster: 0.82,
  seatgeek: 0.76,
  predicthq: 0.72,
  tomtom: 0.7,
  buzz_ml: 0.9,
};

function freshness(signal: BuzzSignal, now: number) {
  const observed = new Date(signal.observedAt).getTime();
  const expires = new Date(signal.expiresAt).getTime();
  if (!Number.isFinite(observed) || !Number.isFinite(expires) || observed > now + 5 * 60_000 || expires <= now) return 0;
  const lifetime = Math.max(1, expires - observed);
  const age = Math.max(0, now - observed);
  const progress = age / lifetime;
  if (progress <= 0.35) return 1;
  return clamp(1 - (progress - 0.35) / 0.65, 0.08, 1);
}

function scarcity(metadata?: Record<string, unknown>) {
  const status = String(metadata?.status || metadata?.ticketStatus || metadata?.reservationsStatus || "").toLowerCase();
  if (status.includes("sold out") || status.includes("unavailable") || status.includes("full")) return 100;
  if (status.includes("few") || status.includes("limited") || status.includes("low") || status.includes("waitlist")) return 70;
  if (status.includes("available") || status.includes("open")) return 12;
  return 0;
}

function sourceReliability(signal: BuzzSignal) {
  if (typeof signal.metadata?.sourceReliability === "number") {
    return clamp(signal.metadata.sourceReliability, 0.2, 1);
  }
  return SOURCE_RELIABILITY[signal.source.toLowerCase()] ?? 0.75;
}

function signalPoints(signal: BuzzSignal) {
  const value = Number(signal.value) || 0;
  switch (signal.type) {
    case "besttime_live": return clamp(value / 100, 0, 1) * 45;
    case "besttime_forecast": return clamp(value / 100, 0, 1) * 14;
    case "verified_presence": return Math.min(24, Math.max(0, Number(signal.metadata?.uniqueDevices ?? value)) * 5);
    case "crowd_report": {
      const uniqueUsers = Number(signal.metadata?.uniqueUsers ?? signal.metadata?.uniqueDevices ?? 0);
      return uniqueUsers >= 2
        ? clamp(value / 100, 0, 1) * 25 * clamp(Number(signal.metadata?.consensus ?? signal.confidence), 0, 1)
        : 0;
    }
    case "partner_pulse": return Math.min(42, clamp(value / 100, 0, 1) * 35 + Math.min(4, Number(signal.metadata?.waitMinutes || 0) / 15) + scarcity(signal.metadata) * 0.05);
    case "reservation_inventory": return Math.max(clamp(value / 100, 0, 1) * 18, scarcity(signal.metadata) * 0.18);
    case "ticket_inventory": return Math.max(clamp(value / 100, 0, 1) * 16, scarcity(signal.metadata) * 0.16);
    case "ticket_scans": return clamp(value / 100, 0, 1) * 58;
    case "predicted_attendance": return clamp(value / 100, 0, 1) * 8;
    case "traffic_congestion": return clamp(value / 100, 0, 1) * 6;
    case "calibration_adjustment": return clamp(value, -18, 18);
    default: return 0;
  }
}

function signalLabel(signal: BuzzSignal) {
  const labels: Record<BuzzSignal["type"], string> = {
    besttime_live: "Live foot traffic",
    besttime_forecast: "Expected foot traffic",
    verified_presence: "Verified people nearby",
    crowd_report: "User crowd reports",
    partner_pulse: "Venue-reported activity",
    reservation_inventory: "Reservation scarcity",
    ticket_inventory: "Ticket scarcity",
    ticket_scans: "Entry scans",
    predicted_attendance: "Predicted attendance",
    traffic_congestion: "Nearby traffic congestion",
    calibration_adjustment: "Learned venue calibration",
  };
  return labels[signal.type];
}

function labelFor(score: number): BuzzScoreResult["label"] {
  if (score >= 88) return "On Fire";
  if (score >= 76) return "Heating Up";
  if (score >= 60) return "Active";
  return "Chill";
}

function confidenceFor(
  liveFamilies: Set<BuzzSignalFamily>,
  liveSources: Set<string>,
  activeFamilies: Set<BuzzSignalFamily>,
  directEvidence: boolean,
  liveAge: number | null,
  calibrationEffectiveSamples: number,
  calibrationError: number,
): BuzzConfidence {
  const matureCalibration = calibrationEffectiveSamples >= 10 && calibrationError <= 12;
  const usefulCalibration = calibrationEffectiveSamples >= 5 && calibrationError <= 20;
  if (directEvidence && liveFamilies.size >= 2 && liveSources.size >= 2 && (liveAge ?? 999) <= 20 && matureCalibration) return "high";
  if (directEvidence || (liveFamilies.size >= 2 && liveSources.size >= 2) || activeFamilies.size >= 3 || usefulCalibration) return "medium";
  return "low";
}

function directEvidence(signal: BuzzSignal) {
  if (!signal.isLive) return false;
  if (signal.type === "verified_presence") {
    return Number(signal.metadata?.uniqueDevices ?? signal.value) >= 2;
  }
  if (signal.type === "crowd_report") {
    return Number(signal.metadata?.uniqueUsers ?? signal.metadata?.uniqueDevices ?? 0) >= 2;
  }
  return ["besttime_live", "partner_pulse", "ticket_scans"].includes(signal.type);
}

export function calculateBuzzScore(venue: VenueForBuzz, signals: BuzzSignal[], referenceTime = new Date()): BuzzScoreResult {
  const now = referenceTime.getTime();
  const active = signals
    .map(signal => ({ signal, weight: freshness(signal, now) }))
    .filter(item => item.weight > 0);

  const priorPoints = 5 + clamp(Number(venue.ai_score ?? 40), 0, 100) * 0.08;
  const factors: BuzzScoreFactor[] = [{
    family: "prior",
    label: "Venue baseline",
    points: Number(priorPoints.toFixed(1)),
    source: "lit757",
  }];

  const strongestByType = new Map<string, BuzzScoreFactor>();
  for (const { signal, weight } of active) {
    const raw = signalPoints(signal);
    const points = raw * clamp(signal.confidence, 0, 1) * weight * sourceReliability(signal);
    const factor: BuzzScoreFactor = {
      family: signal.family,
      label: signalLabel(signal),
      points: Number(points.toFixed(1)),
      source: signal.source,
      observedAt: signal.observedAt,
    };
    const key = `${signal.family}:${signal.type}`;
    const existing = strongestByType.get(key);
    if (!existing || Math.abs(factor.points) > Math.abs(existing.points)) strongestByType.set(key, factor);
  }

  const familyFactors = new Map<BuzzSignalFamily, BuzzScoreFactor[]>();
  for (const factor of strongestByType.values()) {
    if (factor.family === "prior" || factor.family === "corroboration") continue;
    familyFactors.set(factor.family, [...(familyFactors.get(factor.family) || []), factor]);
  }

  for (const [family, candidates] of familyFactors) {
    const ordered = candidates.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
    let remaining = FAMILY_CAPS[family];
    ordered.forEach((factor, index) => {
      const correlationWeight = index === 0 ? 1 : index === 1 ? 0.35 : 0.15;
      const rawCredited = factor.points * correlationWeight;
      const credited = rawCredited >= 0 ? Math.min(remaining, rawCredited) : Math.max(-remaining, rawCredited);
      remaining -= Math.abs(credited);
      if (Math.abs(credited) >= 0.5) factors.push({ ...factor, points: Number(credited.toFixed(1)) });
    });
  }

  const live = active.filter(item => directEvidence(item.signal));
  const liveFamilies = new Set(live.map(item => item.signal.family));
  const liveSources = new Set(live.map(item => item.signal.source));
  const activeFamilies = new Set(active.map(item => item.signal.family));
  const verifiedFirstParty = live.some(({ signal }) =>
    (signal.type === "ticket_scans" || signal.type === "partner_pulse")
    && signal.confidence >= 0.85
    && signal.value >= 70,
  );
  const independentCorroboration = liveFamilies.size >= 2 && liveSources.size >= 2;

  if (independentCorroboration) {
    factors.push({ family: "corroboration", label: "Independent live corroboration", points: 6, source: "buzz-v3" });
  }

  let score = Math.round(factors.reduce((sum, factor) => sum + factor.points, 0));
  if (liveFamilies.size === 0) score = Math.min(score, 64);
  else if (!independentCorroboration && !verifiedFirstParty) score = Math.min(score, 74);
  else if (!independentCorroboration) score = Math.min(score, 84);
  if (score >= 88 && !(independentCorroboration && (verifiedFirstParty || liveFamilies.size >= 3))) score = 87;
  score = clamp(score, 0, 100);

  const liveAges = live
    .map(({ signal }) => Math.max(0, (now - new Date(signal.observedAt).getTime()) / 60_000))
    .filter(Number.isFinite);
  const evidenceAgeMinutes = liveAges.length ? Math.round(Math.min(...liveAges)) : null;
  const liveExpiries = live
    .map(({ signal }) => new Date(signal.expiresAt).getTime())
    .filter(value => Number.isFinite(value) && value > now);
  const expiresAt = new Date(liveExpiries.length ? Math.min(...liveExpiries) : now + 45 * 60_000).toISOString();
  const leading = factors
    .filter(factor => factor.family !== "prior" && Math.abs(factor.points) >= 1)
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    .slice(0, 3);
  const calibration = active.find(item => item.signal.type === "calibration_adjustment")?.signal;
  const calibrationEffectiveSamples = Number(calibration?.metadata?.effectiveSampleSize ?? calibration?.metadata?.sampleCount ?? 0);
  const calibrationError = Number(calibration?.metadata?.meanAbsoluteError || 999);

  return {
    version: "buzz-v3",
    score,
    label: labelFor(score),
    mode: liveFamilies.size ? "live" : "forecast",
    confidence: confidenceFor(liveFamilies, liveSources, activeFamilies, verifiedFirstParty, evidenceAgeMinutes, calibrationEffectiveSamples, calibrationError),
    computedAt: referenceTime.toISOString(),
    expiresAt,
    evidenceAgeMinutes,
    sourceFamilies: [...activeFamilies],
    explanation: leading.length
      ? leading.map(factor => factor.label.toLowerCase()).join(", ")
      : "No timely crowd evidence yet; showing a conservative forecast.",
    factors: factors.sort((a, b) => Math.abs(b.points) - Math.abs(a.points)),
  };
}
