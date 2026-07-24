import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { hasBearerSecret } from "../../../../src/lib/server/request-guards";
import {
  confidenceCalibration,
  coverage,
  evaluateSample,
  groupBy,
  leaveOneNightOut,
  summarize,
  timeBasedSplit,
  type EvaluatedSample,
} from "../../../../src/lib/buzz/evaluation";
import { ablationReport } from "../../../../src/lib/buzz/ablation";
import {
  evidenceBucket,
  horizonBucket,
  loadPairs,
  type GroundTruthRow,
} from "../../../../src/lib/buzz/evaluation-source";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Offline accuracy report.
 *
 * Grades predictions exactly as they were published, using the values frozen
 * into each observation at ingest. Nothing here recomputes a score.
 */

function authorized(request: Request) {
  // Exposes raw prediction quality per venue. Same trust boundary as
  // ground-truth ingestion; CRON_SECRET is not accepted.
  return hasBearerSecret(request, process.env.BUZZ_GROUND_TRUTH_SECRET);
}

/** Minimum evidence before any headline metric should be quoted publicly. */
const RELEASE_GATE = {
  minimumSamples: 100,
  minimumVenues: 20,
  minimumNights: 14,
  maximumMeanAbsoluteError: 10,
  maximumFalseHotRate: 0.05,
  minimumBandAccuracy: 0.85,
};

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") || 30)));
  const holdoutFraction = Math.min(0.9, Math.max(0.1, Number(url.searchParams.get("holdout") || 0.3)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("buzz_ground_truth")
    .select("venue_id,observed_at,occupancy_band,occupancy_pct,observer_type,metadata")
    .gte("observed_at", since)
    .order("observed_at", { ascending: true })
    .limit(5000);

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const { pairs, summary: source } = loadPairs((data || []) as GroundTruthRow[]);
  const samples = pairs.flatMap(pair => {
    const sample = evaluateSample(pair.prediction, pair.observation);
    return sample ? [sample] : [];
  });

  if (!samples.length) {
    return NextResponse.json({
      success: true,
      generatedAt: new Date().toISOString(),
      windowDays: days,
      source,
      message: "No observations in this window carried a frozen prediction, so nothing can be graded yet.",
      readiness: notReady(["no graded observations"]),
    }, { headers: { "Cache-Control": "private, no-store" } });
  }

  const split = timeBasedSplit(samples, holdoutFraction);
  const folds = leaveOneNightOut(samples);
  const overall = summarize(samples);
  const holdout = summarize(split.holdout);

  return NextResponse.json({
    success: true,
    generatedAt: new Date().toISOString(),
    windowDays: days,
    source,
    coverage: coverage(samples),

    // Reported first because it is the only number that speaks to future
    // performance. The overall figure includes nights the model has seen.
    heldOut: {
      strategy: "most recent nights withheld",
      holdoutFraction,
      training: coverage(split.training),
      holdout: coverage(split.holdout),
      metrics: holdout,
    },
    leaveOneNightOut: {
      folds: folds.length,
      // Averaging fold errors keeps a single busy night from dominating.
      meanAbsoluteError: averageOf(folds.map(fold => summarize(fold.holdout).meanAbsoluteError)),
    },

    overall,
    confidenceCalibration: confidenceCalibration(samples),

    breakdowns: {
      byVenue: groupBy(samples, sample => sample.venueId),
      byLocalHour: groupBy(samples, sample => sample.localHour),
      byDayOfWeek: groupBy(samples, sample => sample.localDayOfWeek),
      byMode: groupBy(samples, sample => sample.mode),
      byConfidence: groupBy(samples, sample => sample.confidence),
      byScoreVersion: groupBy(samples, sample => sample.scoreVersion),
      byForecastHorizon: groupBy(samples, sample => horizonBucket(sample.forecastHorizonMinutes)),
      byEvidenceAvailability: groupBy(samples, sample => evidenceBucket(sample.sourceFamilyCount)),
    },

    ablation: source.withFrozenFactors > 0
      ? ablationReport(pairs)
      : { skipped: "No graded observation carried frozen factors, so no signal contribution can be isolated." },

    releaseGate: RELEASE_GATE,
    readiness: assessReadiness(samples, holdout),
    truthNote: "Held-out metrics describe the nights withheld from tuning and are the only figures that speak to future performance. Overall metrics include nights the model has already seen and will read better than reality.",
  }, { headers: { "Cache-Control": "private, no-store" } });
}

function averageOf(values: (number | null)[]) {
  const usable = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (!usable.length) return null;
  return Number((usable.reduce((sum, value) => sum + value, 0) / usable.length).toFixed(2));
}

function notReady(blockers: string[]) {
  return { readyToPublishAccuracyClaims: false, blockers, met: [] as string[] };
}

/**
 * Deliberately conservative. Every gate must pass on held-out data, and a
 * metric that cannot be computed counts as a blocker rather than a pass.
 */
function assessReadiness(
  samples: EvaluatedSample[],
  holdout: ReturnType<typeof summarize>,
) {
  const spread = coverage(samples);
  const blockers: string[] = [];
  const met: string[] = [];

  const check = (passed: boolean, label: string) => {
    if (passed) met.push(label);
    else blockers.push(label);
  };

  check(spread.samples >= RELEASE_GATE.minimumSamples, `at least ${RELEASE_GATE.minimumSamples} graded observations`);
  check(spread.venues >= RELEASE_GATE.minimumVenues, `at least ${RELEASE_GATE.minimumVenues} venues covered`);
  check(spread.nights >= RELEASE_GATE.minimumNights, `at least ${RELEASE_GATE.minimumNights} distinct nights`);
  check(
    holdout.meanAbsoluteError !== null && holdout.meanAbsoluteError <= RELEASE_GATE.maximumMeanAbsoluteError,
    `held-out mean absolute error at or below ${RELEASE_GATE.maximumMeanAbsoluteError}`,
  );
  check(
    holdout.falseHotRate !== null && holdout.falseHotRate <= RELEASE_GATE.maximumFalseHotRate,
    `held-out false-Hot rate at or below ${RELEASE_GATE.maximumFalseHotRate}`,
  );
  check(
    holdout.bandAccuracy !== null && holdout.bandAccuracy >= RELEASE_GATE.minimumBandAccuracy,
    `held-out activity-state accuracy at or above ${RELEASE_GATE.minimumBandAccuracy}`,
  );

  return { readyToPublishAccuracyClaims: blockers.length === 0, blockers, met };
}
