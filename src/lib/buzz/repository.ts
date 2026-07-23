import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCalibrationProfile, calibrationSignal, type BuzzGroundTruthSample } from "./calibration";
import { calculateBuzzScore } from "./score-v1";
import type { BuzzSignal, VenueForBuzz } from "./types";

type SignalRow = {
  source: string;
  signal_family: BuzzSignal["family"];
  signal_type: BuzzSignal["type"];
  value: number;
  is_live: boolean;
  confidence: number;
  observed_at: string;
  expires_at: string;
  metadata?: Record<string, unknown> | null;
};

type GroundTruthRow = {
  observed_at: string;
  occupancy_pct?: number | null;
  observer_type?: string | null;
  metadata?: Record<string, unknown> | null;
};

export function signalToRow(venueId: string, signal: BuzzSignal) {
  return {
    venue_id: venueId,
    source: signal.source,
    signal_family: signal.family,
    signal_type: signal.type,
    value: signal.value,
    is_live: signal.isLive,
    confidence: signal.confidence,
    observed_at: signal.observedAt,
    expires_at: signal.expiresAt,
    metadata: signal.metadata || {},
  };
}

export function rowToSignal(row: SignalRow): BuzzSignal {
  return {
    source: row.source,
    family: row.signal_family,
    type: row.signal_type,
    value: Number(row.value),
    isLive: Boolean(row.is_live),
    confidence: Number(row.confidence),
    observedAt: row.observed_at,
    expiresAt: row.expires_at,
    metadata: row.metadata || {},
  };
}

export async function saveBuzzSignals(db: SupabaseClient, venueId: string, signals: BuzzSignal[]) {
  if (!signals.length) return;
  const { error } = await db.from("buzz_signal_snapshots").upsert(
    signals.map(signal => signalToRow(venueId, signal)),
    { onConflict: "venue_id,source,signal_type,observed_at", ignoreDuplicates: true },
  );
  if (error) throw new Error(`Could not save Buzz signals: ${error.message}`);
}

export async function loadActiveSignals(db: SupabaseClient, venueId: string, now = new Date()) {
  const { data, error } = await db
    .from("buzz_signal_snapshots")
    .select("source,signal_family,signal_type,value,is_live,confidence,observed_at,expires_at,metadata")
    .eq("venue_id", venueId)
    .gt("expires_at", now.toISOString())
    .order("observed_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Could not load Buzz signals: ${error.message}`);
  return (data || []).map(row => rowToSignal(row as SignalRow));
}

function groundTruthWeight(row: GroundTruthRow) {
  const observer = String(row.observer_type || "").toLowerCase();
  const consensus = Number(row.metadata?.consensus || 0);
  const uniqueUsers = Number(row.metadata?.uniqueUsers || 0);
  if (/sensor|ticket_scan|partner|door_counter|pos/.test(observer)) return 1.25;
  if (observer === "verified_user_consensus") {
    return Math.min(1.15, 0.72 + Math.max(0, consensus) * 0.25 + Math.min(0.18, uniqueUsers * 0.03));
  }
  if (observer === "verified_user_observation") return 0.38;
  if (/field_observer|admin/.test(observer)) return 0.82;
  return 0.5;
}

async function loadCalibrationSignal(db: SupabaseClient, venue: VenueForBuzz, now: Date) {
  const since = new Date(now.getTime() - 180 * 24 * 60 * 60_000).toISOString();
  const { data, error } = await db
    .from("buzz_ground_truth")
    .select("observed_at,occupancy_pct,observer_type,metadata")
    .eq("venue_id", venue.id)
    .gte("observed_at", since)
    .order("observed_at", { ascending: false })
    .limit(300);
  if (error) {
    console.error(`Could not load Buzz calibration samples for ${venue.id}: ${error.message}`);
    return null;
  }

  const samples = ((data || []) as GroundTruthRow[]).flatMap(row => {
    const predictedScore = Number(row.metadata?.predictedScore);
    const actualScore = Number(row.occupancy_pct ?? row.metadata?.averageCrowdValue);
    if (!Number.isFinite(predictedScore) || !Number.isFinite(actualScore)) return [];
    return [{
      predictedScore,
      actualScore,
      observedAt: row.observed_at,
      weight: groundTruthWeight(row),
    } satisfies BuzzGroundTruthSample];
  });
  return calibrationSignal(buildCalibrationProfile(venue, samples, now), now);
}

export async function recomputeBuzzScore(db: SupabaseClient, venue: VenueForBuzz, now = new Date()) {
  const activeSignals = await loadActiveSignals(db, venue.id, now);
  const learned = await loadCalibrationSignal(db, venue, now);
  const signals = learned ? [...activeSignals.filter(signal => signal.type !== "calibration_adjustment"), learned] : activeSignals;
  if (learned) await saveBuzzSignals(db, venue.id, [learned]);

  const score = calculateBuzzScore(venue, signals, now);
  const snapshot = {
    venue_id: venue.id,
    score: score.score,
    label: score.label,
    score_mode: score.mode,
    confidence: score.confidence,
    version: score.version,
    computed_at: score.computedAt,
    expires_at: score.expiresAt,
    evidence_age_minutes: score.evidenceAgeMinutes,
    source_families: score.sourceFamilies,
    explanation: score.explanation,
    factors: score.factors,
  };

  const [{ error: snapshotError }, { error: historyError }] = await Promise.all([
    db.from("buzz_score_snapshots").upsert({ ...snapshot, updated_at: now.toISOString() }, { onConflict: "venue_id" }),
    db.from("buzz_score_history").upsert(snapshot, { onConflict: "venue_id,computed_at", ignoreDuplicates: true }),
  ]);
  if (snapshotError) throw new Error(`Could not save Buzz score: ${snapshotError.message}`);
  if (historyError) throw new Error(`Could not save Buzz score history: ${historyError.message}`);
  return score;
}
