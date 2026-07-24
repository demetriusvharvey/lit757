import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { hasBearerSecret } from "../../../../src/lib/server/request-guards";

export const dynamic = "force-dynamic";

const db = getSupabaseAdmin();

type TruthRow = {
  id: string;
  venue_id: string;
  observed_at: string;
  occupancy_band: "quiet" | "steady" | "busy" | "packed";
  occupancy_pct?: number | null;
  queue_minutes?: number | null;
};

type ScoreRow = {
  venue_id: string;
  score: number;
  score_mode: "live" | "forecast";
  confidence: "low" | "medium" | "high";
  computed_at: string;
  version: string;
};

function authorized(request: Request) {
  // Calibration can expose raw prediction quality. Keep it on the same
  // dedicated trust boundary as ground-truth ingestion; CRON_SECRET is not a
  // substitute and must not broaden access.
  return hasBearerSecret(request, process.env.BUZZ_GROUND_TRUTH_SECRET);
}

function truthValue(row: TruthRow) {
  if (row.occupancy_pct != null) return Number(row.occupancy_pct);
  if (row.occupancy_band === "packed") return 95;
  if (row.occupancy_band === "busy") return 75;
  if (row.occupancy_band === "steady") return 45;
  return 15;
}

const ratio = (numerator: number, denominator: number) => denominator ? Number((numerator / denominator).toFixed(3)) : null;

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days") || 30)));
  const threshold = Math.min(95, Math.max(50, Number(url.searchParams.get("threshold") || 76)));
  const windowMinutes = Math.min(60, Math.max(5, Number(url.searchParams.get("windowMinutes") || 30)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: truthData, error: truthError }, { data: scoreData, error: scoreError }] = await Promise.all([
    db.from("buzz_ground_truth").select("id,venue_id,observed_at,occupancy_band,occupancy_pct,queue_minutes").gte("observed_at", since).order("observed_at", { ascending: true }).limit(5000),
    db.from("buzz_score_history").select("venue_id,score,score_mode,confidence,computed_at,version").gte("computed_at", since).order("computed_at", { ascending: true }).limit(20000),
  ]);
  if (truthError || scoreError) return NextResponse.json({ success: false, error: truthError?.message || scoreError?.message }, { status: 500 });

  const truth = (truthData || []) as TruthRow[];
  const scores = (scoreData || []) as ScoreRow[];
  const byVenue = new Map<string, ScoreRow[]>();
  for (const row of scores) byVenue.set(row.venue_id, [...(byVenue.get(row.venue_id) || []), row]);

  const matches = truth.flatMap(observation => {
    const observedAt = new Date(observation.observed_at).getTime();
    const candidates = (byVenue.get(observation.venue_id) || [])
      .map(score => ({ score, deltaMinutes: Math.abs(new Date(score.computed_at).getTime() - observedAt) / 60_000 }))
      .filter(item => item.deltaMinutes <= windowMinutes)
      .sort((left, right) => left.deltaMinutes - right.deltaMinutes);
    const match = candidates[0];
    if (!match) return [];
    const actual = truthValue(observation);
    const predictedPositive = Number(match.score.score) >= threshold;
    const actualPositive = actual >= 70 || observation.occupancy_band === "busy" || observation.occupancy_band === "packed";
    return [{
      observationId: observation.id,
      venueId: observation.venue_id,
      observedAt: observation.observed_at,
      occupancyBand: observation.occupancy_band,
      actual,
      predicted: Number(match.score.score),
      mode: match.score.score_mode,
      confidence: match.score.confidence,
      deltaMinutes: Number(match.deltaMinutes.toFixed(1)),
      predictedPositive,
      actualPositive,
      absoluteError: Math.abs(Number(match.score.score) - actual),
    }];
  });

  const truePositive = matches.filter(match => match.predictedPositive && match.actualPositive).length;
  const falsePositive = matches.filter(match => match.predictedPositive && !match.actualPositive).length;
  const trueNegative = matches.filter(match => !match.predictedPositive && !match.actualPositive).length;
  const falseNegative = matches.filter(match => !match.predictedPositive && match.actualPositive).length;
  const meanAbsoluteError = matches.length
    ? Number((matches.reduce((sum, match) => sum + match.absoluteError, 0) / matches.length).toFixed(2))
    : null;

  const byMode = (["live", "forecast"] as const).map(mode => {
    const rows = matches.filter(match => match.mode === mode);
    const positives = rows.filter(match => match.predictedPositive);
    const correctPositives = positives.filter(match => match.actualPositive).length;
    return {
      mode,
      observations: rows.length,
      positivePredictions: positives.length,
      precision: ratio(correctPositives, positives.length),
      meanAbsoluteError: rows.length ? Number((rows.reduce((sum, row) => sum + row.absoluteError, 0) / rows.length).toFixed(2)) : null,
    };
  });

  return NextResponse.json({
    success: true,
    generatedAt: new Date().toISOString(),
    parameters: { days, threshold, matchingWindowMinutes: windowMinutes },
    coverage: {
      groundTruthObservations: truth.length,
      matchedObservations: matches.length,
      unmatchedObservations: truth.length - matches.length,
      uniqueVenues: new Set(matches.map(match => match.venueId)).size,
    },
    confusionMatrix: { truePositive, falsePositive, trueNegative, falseNegative },
    metrics: {
      precision: ratio(truePositive, truePositive + falsePositive),
      recall: ratio(truePositive, truePositive + falseNegative),
      falsePositiveRate: ratio(falsePositive, falsePositive + trueNegative),
      accuracy: ratio(truePositive + trueNegative, matches.length),
      meanAbsoluteError,
    },
    byMode,
    releaseGate: {
      enoughObservations: matches.length >= 100,
      enoughVenues: new Set(matches.map(match => match.venueId)).size >= 20,
      precisionTargetMet: (ratio(truePositive, truePositive + falsePositive) ?? 0) >= 0.85,
      falsePositiveTargetMet: (ratio(falsePositive, falsePositive + trueNegative) ?? 1) <= 0.1,
      readyToMarketAsAuthoritative: matches.length >= 100 && new Set(matches.map(match => match.venueId)).size >= 20 && (ratio(truePositive, truePositive + falsePositive) ?? 0) >= 0.85 && (ratio(falsePositive, falsePositive + trueNegative) ?? 1) <= 0.1,
    },
    recentMatches: matches.slice(-50).reverse(),
  });
}
