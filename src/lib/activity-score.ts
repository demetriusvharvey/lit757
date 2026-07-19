export type ActivityLevel = "very_busy" | "busy" | "getting_busier" | "moderate" | "quiet";
export type ActivityTrend = "rising" | "steady" | "falling";

export type ActivitySignals = {
  recentReports?: number;
  confirmedVisitors?: number;
  interestedCount?: number;
  goingCount?: number;
  ticketsSold?: number | null;
  capacity?: number | null;
  favorites?: number;
  minutesSinceLatestSignal?: number | null;
  openNow?: boolean | null;
};

export type ActivityScore = {
  score: number;
  level: ActivityLevel;
  label: string;
  trend: ActivityTrend;
  trendLabel: string;
  confidence: "high" | "medium" | "limited";
};

const clamp = (value: number, minimum = 0, maximum = 100) =>
  Math.min(maximum, Math.max(minimum, value));

function levelFor(score: number): Pick<ActivityScore, "level" | "label"> {
  if (score >= 85) return { level: "very_busy", label: "Very Busy" };
  if (score >= 70) return { level: "busy", label: "Busy" };
  if (score >= 52) return { level: "getting_busier", label: "Getting Busier" };
  if (score >= 30) return { level: "moderate", label: "Moderate" };
  return { level: "quiet", label: "Quiet" };
}

export function calculateActivityScore(signals: ActivitySignals): ActivityScore {
  const reports = clamp(signals.recentReports ?? 0, 0, 20);
  const visitors = clamp(signals.confirmedVisitors ?? 0, 0, 100);
  const interested = clamp(signals.interestedCount ?? 0, 0, 250);
  const going = clamp(signals.goingCount ?? 0, 0, 250);
  const favorites = clamp(signals.favorites ?? 0, 0, 500);

  const ticketRatio =
    signals.capacity && signals.capacity > 0 && signals.ticketsSold != null
      ? clamp(signals.ticketsSold / signals.capacity, 0, 1)
      : 0;

  const freshness =
    signals.minutesSinceLatestSignal == null
      ? 0.35
      : clamp(1 - signals.minutesSinceLatestSignal / 240, 0, 1);

  const rawScore =
    reports * 1.6 +
    visitors * 0.28 +
    interested * 0.035 +
    going * 0.09 +
    favorites * 0.015 +
    ticketRatio * 18;

  const openMultiplier = signals.openNow === false ? 0.35 : 1;
  const score = Math.round(clamp(rawScore * (0.55 + freshness * 0.45) * openMultiplier));
  const activityLevel = levelFor(score);

  const strongRecentSignal = freshness >= 0.72 && (reports >= 3 || visitors >= 15 || going >= 12);
  const staleSignal = freshness <= 0.25;
  const trend: ActivityTrend = strongRecentSignal ? "rising" : staleSignal ? "falling" : "steady";
  const trendLabel = trend === "rising" ? "Getting Busier" : trend === "falling" ? "Slowing Down" : "Steady";

  const signalCount = reports + Math.min(visitors, 20) + Math.min(going, 20);
  const confidence = signalCount >= 20 ? "high" : signalCount >= 5 ? "medium" : "limited";

  return {
    score,
    ...activityLevel,
    trend,
    trendLabel,
    confidence,
  };
}
