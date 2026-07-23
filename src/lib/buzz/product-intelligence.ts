export type ActivityState = "unknown" | "quiet" | "active" | "hot";
export type ActivityTrend = "falling" | "stable" | "rising" | "surging";
export type TruthMode = "live" | "recently_confirmed" | "predicted" | "insufficient";
export type ConfidenceLevel = "low" | "medium" | "high";
export type ArrivalOutlook = "cooler" | "similar" | "stronger" | "uncertain";

export type PublicActivitySignal = {
  source: string;
  family: string;
  observedAt: string;
  expiresAt: string;
  confidence: number;
  isLive: boolean;
  verifiedNearby?: boolean;
};

export type ArrivalPredictionInput = {
  currentScore: number;
  trend?: ActivityTrend;
  travelMinutes?: number | null;
  minutesUntilClose?: number | null;
  eventMinutesUntilStart?: number | null;
  eventMinutesUntilEnd?: number | null;
  historicalSlopePerHour?: number | null;
  parkingDelayMinutes?: number | null;
  confidence?: ConfidenceLevel;
};

export type ArrivalPrediction = {
  score: number;
  state: ActivityState;
  outlook: ArrivalOutlook;
  label: string;
  detail: string;
  travelMinutes: number | null;
};

export type UnifiedActivityInput = {
  score?: number | null;
  label?: string | null;
  confidence?: string | null;
  observedAt?: string | null;
  expiresAt?: string | null;
  isLive?: boolean;
  signalCount?: number;
  trendDelta?: number | null;
  reason?: string | null;
  sources?: PublicActivitySignal[];
  now?: Date;
};

export type UnifiedActivity = {
  score: number | null;
  state: ActivityState;
  trend: ActivityTrend;
  truthMode: TruthMode;
  confidence: ConfidenceLevel;
  observedAt: string | null;
  expiresAt: string | null;
  freshnessLabel: string;
  headline: string;
  reason: string;
  sources: string[];
};

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));

export function stateFromScore(score?: number | null): ActivityState {
  if (score == null || !Number.isFinite(score)) return "unknown";
  if (score >= 78) return "hot";
  if (score >= 45) return "active";
  return "quiet";
}

export function trendFromDelta(delta?: number | null): ActivityTrend {
  if (delta == null || !Number.isFinite(delta)) return "stable";
  if (delta >= 14) return "surging";
  if (delta >= 5) return "rising";
  if (delta <= -5) return "falling";
  return "stable";
}

export function normalizeConfidence(value?: string | number | null): ConfidenceLevel {
  if (typeof value === "number") {
    if (value >= 0.72) return "high";
    if (value >= 0.42) return "medium";
    return "low";
  }
  const normalized = String(value || "").toLowerCase();
  if (["high", "strong", "verified"].some(item => normalized.includes(item))) return "high";
  if (["medium", "moderate", "fair"].some(item => normalized.includes(item))) return "medium";
  return "low";
}

export function truthModeFor(input: UnifiedActivityInput): TruthMode {
  const now = input.now || new Date();
  const observed = input.observedAt ? new Date(input.observedAt) : null;
  const expires = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expires && expires.getTime() <= now.getTime()) return "insufficient";
  if (input.isLive && observed) {
    const ageMinutes = (now.getTime() - observed.getTime()) / 60_000;
    if (ageMinutes <= 20) return "live";
    if (ageMinutes <= 60) return "recently_confirmed";
  }
  if (observed && (now.getTime() - observed.getTime()) / 60_000 <= 90) return "recently_confirmed";
  if (input.score != null) return "predicted";
  return "insufficient";
}

export function relativeFreshness(value?: string | null, now = new Date()) {
  if (!value) return "No recent confirmation";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Freshness unavailable";
  const minutes = Math.max(0, Math.round((now.getTime() - parsed.getTime()) / 60_000));
  if (minutes <= 1) return "Confirmed just now";
  if (minutes < 60) return `Confirmed ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Updated ${hours} hr${hours === 1 ? "" : "s"} ago`;
  return "Based on older patterns";
}

export function buildUnifiedActivity(input: UnifiedActivityInput): UnifiedActivity {
  const truthMode = truthModeFor(input);
  const confidence = normalizeConfidence(input.confidence);
  const score = truthMode === "insufficient" ? null : input.score == null ? null : clamp(Number(input.score));
  const state = stateFromScore(score);
  const trend = trendFromDelta(input.trendDelta);
  const stateLabel = state === "unknown" ? "Not enough live data" : state === "hot" ? "Hot" : state === "active" ? "Active" : "Quiet";
  const trendLabel = trend === "surging" ? "surging" : trend === "rising" ? "rising" : trend === "falling" ? "cooling" : "steady";
  const truthLabel = truthMode === "live" ? "Live" : truthMode === "recently_confirmed" ? "Recently confirmed" : truthMode === "predicted" ? "Predicted" : "Unknown";
  const sources = Array.from(new Set((input.sources || []).map(signal => signal.family || signal.source).filter(Boolean)));
  return {
    score,
    state,
    trend,
    truthMode,
    confidence,
    observedAt: input.observedAt || null,
    expiresAt: input.expiresAt || null,
    freshnessLabel: relativeFreshness(input.observedAt, input.now),
    headline: state === "unknown" ? "Not enough recent evidence" : `${stateLabel} · ${trendLabel} · ${truthLabel}`,
    reason: input.reason || (state === "unknown" ? "Buzz is waiting for stronger or fresher evidence instead of guessing." : "Activity combines recent signals, venue patterns, events, and nearby movement."),
    sources,
  };
}

function trendSlope(trend: ActivityTrend) {
  if (trend === "surging") return 20;
  if (trend === "rising") return 10;
  if (trend === "falling") return -11;
  return 0;
}

export function predictArrivalActivity(input: ArrivalPredictionInput): ArrivalPrediction {
  const travelMinutes = input.travelMinutes == null ? null : Math.max(0, Math.round(input.travelMinutes));
  if (travelMinutes == null) {
    return {
      score: clamp(input.currentScore),
      state: stateFromScore(input.currentScore),
      outlook: "uncertain",
      label: "Set your location for arrival intelligence",
      detail: "Buzz will estimate what the venue should feel like when you get there.",
      travelMinutes: null,
    };
  }

  const horizonHours = Math.min(2, travelMinutes / 60);
  let delta = trendSlope(input.trend || "stable") * horizonHours;
  delta += (input.historicalSlopePerHour || 0) * horizonHours;

  if (input.eventMinutesUntilStart != null && input.eventMinutesUntilStart <= travelMinutes && input.eventMinutesUntilStart >= -45) delta += 10;
  if (input.eventMinutesUntilEnd != null && input.eventMinutesUntilEnd <= travelMinutes) delta -= 16;
  if (input.minutesUntilClose != null && input.minutesUntilClose <= travelMinutes + 20) delta -= 24;
  if ((input.parkingDelayMinutes || 0) >= 15) delta -= 3;

  const score = Math.round(clamp(input.currentScore + delta));
  const difference = score - input.currentScore;
  const outlook: ArrivalOutlook = difference >= 6 ? "stronger" : difference <= -6 ? "cooler" : "similar";
  const state = stateFromScore(score);
  const stateLabel = state === "hot" ? "Hot" : state === "active" ? "Active" : state === "quiet" ? "Quiet" : "Unknown";
  const label = outlook === "stronger"
    ? `Expected to be ${stateLabel} when you arrive`
    : outlook === "cooler"
      ? `May cool to ${stateLabel} before you arrive`
      : `Likely ${stateLabel} when you arrive`;
  const detailParts = [`About ${travelMinutes} min away`];
  if ((input.parkingDelayMinutes || 0) > 0) detailParts.push(`allow ${Math.round(input.parkingDelayMinutes || 0)} min for parking`);
  if (input.eventMinutesUntilEnd != null && input.eventMinutesUntilEnd <= travelMinutes) detailParts.push("nearby event activity may release or disperse");
  if (input.minutesUntilClose != null && input.minutesUntilClose <= travelMinutes + 20) detailParts.push("closing soon");

  return { score, state, outlook, label, detail: detailParts.join(" · "), travelMinutes };
}

export type WatchKind = "venue" | "area" | "category" | "event" | "plan";
export type AlertMode = "essential" | "balanced" | "live" | "scheduled" | "digest";

export type WatchRule = {
  id: string;
  kind: WatchKind;
  targetId: string;
  targetName: string;
  alertMode: AlertMode;
  minState?: ActivityState;
  requireRising?: boolean;
  maxDistanceMiles?: number | null;
  quietHours?: { start: number; end: number } | null;
  enabled: boolean;
  lastNotifiedAt?: string | null;
  lastNotifiedState?: ActivityState | null;
};

export type AlertDecisionInput = {
  watch: WatchRule;
  activity: UnifiedActivity;
  distanceMiles?: number | null;
  closesInMinutes?: number | null;
  userAlreadyVisited?: boolean;
  now?: Date;
};

const stateRank: Record<ActivityState, number> = { unknown: 0, quiet: 1, active: 2, hot: 3 };

export function shouldNotify(input: AlertDecisionInput) {
  const { watch, activity } = input;
  const now = input.now || new Date();
  if (!watch.enabled || activity.truthMode === "insufficient" || activity.confidence === "low") return false;
  if (input.userAlreadyVisited) return false;
  if (input.closesInMinutes != null && input.closesInMinutes < 30) return false;
  if (watch.maxDistanceMiles != null && input.distanceMiles != null && input.distanceMiles > watch.maxDistanceMiles) return false;
  if (watch.requireRising && !["rising", "surging"].includes(activity.trend)) return false;
  if (watch.minState && stateRank[activity.state] < stateRank[watch.minState]) return false;
  if (watch.quietHours) {
    const hour = now.getHours();
    const { start, end } = watch.quietHours;
    const inQuietHours = start > end ? hour >= start || hour < end : hour >= start && hour < end;
    if (inQuietHours) return false;
  }
  if (watch.lastNotifiedAt) {
    const minutes = (now.getTime() - new Date(watch.lastNotifiedAt).getTime()) / 60_000;
    const cooldown = watch.alertMode === "live" ? 45 : watch.alertMode === "balanced" ? 120 : 240;
    if (minutes < cooldown && watch.lastNotifiedState === activity.state) return false;
  }
  return activity.state === "hot" || activity.trend === "surging" || (activity.state === "active" && activity.trend === "rising");
}

export type IntentId = "best_now" | "high_energy" | "chill" | "short_line" | "easy_parking" | "food_now" | "date_night" | "group" | "family" | "free" | "open_late" | "ending_soon" | "different";

export const DISCOVERY_INTENTS: Array<{ id: IntentId; label: string; description: string }> = [
  { id: "best_now", label: "Best right now", description: "Strong activity, confidence, distance, and practical conditions." },
  { id: "high_energy", label: "High energy", description: "Hot or rapidly rising places." },
  { id: "chill", label: "Chill", description: "Active without feeling overcrowded." },
  { id: "short_line", label: "No long line", description: "Prioritizes manageable entry and waits." },
  { id: "easy_parking", label: "Easy parking", description: "Reduces parking friction." },
  { id: "food_now", label: "Food now", description: "Open food options that should still work on arrival." },
  { id: "date_night", label: "Date night", description: "Comfortable, active, and conversation-friendly." },
  { id: "group", label: "Group activity", description: "Good for crews and flexible plans." },
  { id: "family", label: "Family", description: "Age-appropriate and practical." },
  { id: "free", label: "Free", description: "No cover or free public activity." },
  { id: "open_late", label: "Open late", description: "Useful for late decisions." },
  { id: "ending_soon", label: "Ending soon", description: "Time-sensitive events and activity windows." },
  { id: "different", label: "Something different", description: "Surprising options outside routine choices." },
];
