import type { BuzzConfidence, BuzzScoreFactor, BuzzScoreResult, BuzzSignal, BuzzSignalFamily, VenueForBuzz } from "./types";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function freshness(signal: BuzzSignal, now: number) {
  const observed = new Date(signal.observedAt).getTime();
  const expires = new Date(signal.expiresAt).getTime();
  if (!Number.isFinite(observed) || !Number.isFinite(expires) || expires <= now) return 0;
  const progress = Math.max(0, now - observed) / Math.max(1, expires - observed);
  return clamp(1 - Math.max(0, progress - 0.55) / 0.45, 0.15, 1);
}

function scarcity(metadata?: Record<string, unknown>) {
  const status = String(metadata?.status || metadata?.ticketStatus || metadata?.reservationsStatus || "").toLowerCase();
  if (status.includes("sold out") || status.includes("unavailable") || status.includes("full")) return 100;
  if (status.includes("few") || status.includes("limited") || status.includes("low") || status.includes("waitlist")) return 72;
  if (status.includes("available") || status.includes("open")) return 18;
  return 0;
}

function signalPoints(signal: BuzzSignal) {
  const value = clamp(Number(signal.value) || 0, 0, 200);
  switch (signal.type) {
    case "besttime_live": return clamp(value / 100, 0, 1.2) * 55;
    case "besttime_forecast": return clamp(value / 100, 0, 1) * 22;
    case "verified_presence": return Math.min(32, Math.max(0, Number(signal.metadata?.uniqueDevices ?? value)) * 7);
    case "crowd_report": return clamp(value / 100, 0, 1) * 28 * clamp(Number(signal.metadata?.consensus ?? signal.confidence), 0, 1);
    case "partner_pulse": return Math.min(48, clamp(value / 100, 0, 1) * 40 + Math.min(6, Number(signal.metadata?.waitMinutes || 0) / 10) + scarcity(signal.metadata) * 0.08);
    case "reservation_inventory": return Math.max(clamp(value / 100, 0, 1) * 24, scarcity(signal.metadata) * 0.24);
    case "ticket_inventory": return Math.max(clamp(value / 100, 0, 1) * 20, scarcity(signal.metadata) * 0.2);
    case "ticket_scans": return clamp(value / 100, 0, 1) * 65;
    case "predicted_attendance": return clamp(value / 100, 0, 1) * 10;
    case "traffic_congestion": return clamp(value / 100, 0, 1) * 8;
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
  };
  return labels[signal.type];
}

function labelFor(score: number): BuzzScoreResult["label"] {
  if (score >= 88) return "On Fire";
  if (score >= 76) return "Heating Up";
  if (score >= 60) return "Active";
  return "Chill";
}

function confidenceFor(liveFamilies: Set<BuzzSignalFamily>, activeFamilies: Set<BuzzSignalFamily>, strongFirstParty: boolean, liveAge: number | null): BuzzConfidence {
  if (strongFirstParty || (liveFamilies.size >= 2 && (liveAge ?? 999) <= 30)) return "high";
  if (liveFamilies.size >= 1 || activeFamilies.size >= 2) return "medium";
  return "low";
}

export function calculateBuzzScore(venue: VenueForBuzz, signals: BuzzSignal[], referenceTime = new Date()): BuzzScoreResult {
  const now = referenceTime.getTime();
  const active = signals.map(signal => ({ signal, weight: freshness(signal, now) })).filter(item => item.weight > 0);
  const priorPoints = 10 + clamp(Number(venue.ai_score ?? 45), 0, 100) * 0.15;
  const factors: BuzzScoreFactor[] = [{ family: "prior", label: "Venue baseline", points: Number(priorPoints.toFixed(1)), source: "lit757" }];
  const strongest = new Map<BuzzSignalFamily, BuzzScoreFactor>();

  for (const { signal, weight } of active) {
    const factor: BuzzScoreFactor = {
      family: signal.family,
      label: signalLabel(signal),
      points: Number((signalPoints(signal) * clamp(signal.confidence, 0, 1) * weight).toFixed(1)),
      source: signal.source,
      observedAt: signal.observedAt,
    };
    const existing = strongest.get(signal.family);
    if (!existing || factor.points > existing.points) strongest.set(signal.family, factor);
  }
  factors.push(...strongest.values());

  const live = active.filter(item => item.signal.isLive);
  const liveFamilies = new Set(live.map(item => item.signal.family));
  const activeFamilies = new Set(active.map(item => item.signal.family));
  const strongFirstParty = active.some(({ signal }) =>
    (signal.type === "ticket_scans" || signal.type === "partner_pulse") && signal.confidence >= 0.8 && signal.value >= 70
  );

  let score = Math.round(factors.reduce((sum, factor) => sum + factor.points, 0));
  if (liveFamilies.size === 0) score = Math.min(score, 69);
  else if (liveFamilies.size === 1 && !strongFirstParty) score = Math.min(score, 84);
  if (score >= 85 && liveFamilies.size < 2 && !strongFirstParty) score = 84;
  score = clamp(score, 0, 100);

  const liveAges = live.map(({ signal }) => Math.max(0, (now - new Date(signal.observedAt).getTime()) / 60000)).filter(Number.isFinite);
  const evidenceAgeMinutes = liveAges.length ? Math.round(Math.min(...liveAges)) : null;
  const liveExpiries = live.map(({ signal }) => new Date(signal.expiresAt).getTime()).filter(value => Number.isFinite(value) && value > now);
  const expiresAt = new Date(liveExpiries.length ? Math.min(...liveExpiries) : now + 3600000).toISOString();
  const leading = factors.filter(factor => factor.family !== "prior" && factor.points >= 1).sort((a, b) => b.points - a.points).slice(0, 3);

  return {
    version: "buzz-v1",
    score,
    label: labelFor(score),
    mode: liveFamilies.size ? "live" : "forecast",
    confidence: confidenceFor(liveFamilies, activeFamilies, strongFirstParty, evidenceAgeMinutes),
    computedAt: referenceTime.toISOString(),
    expiresAt,
    evidenceAgeMinutes,
    sourceFamilies: [...activeFamilies],
    explanation: leading.length ? leading.map(factor => factor.label.toLowerCase()).join(", ") : "No timely crowd evidence yet; showing a conservative forecast.",
    factors: factors.sort((a, b) => b.points - a.points),
  };
}
