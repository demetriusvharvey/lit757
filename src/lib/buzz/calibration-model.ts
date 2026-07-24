import { localCalendarIndices } from "./local-time";
import type { BuzzSignal, VenueForBuzz } from "./types";

/**
 * Batch-trained calibration model.
 *
 * This is deliberately separate from the online profile in `calibration.ts`.
 * The profile corrects a single venue's score from its own recent ground truth
 * as observations stream in. This model is trained offline across every venue
 * and stored as a versioned artifact so a candidate can be evaluated against
 * held-out observations before it is ever allowed to move a public score.
 */
export type BuzzCalibrationModel = {
  version: string;
  intercept: number;
  baseWeight: number;
  sourceFamilyWeights: Partial<Record<BuzzSignal["family"], number>>;
  sourceWeights: Record<string, number>;
  hourOffsets: number[];
  dayOfWeekOffsets: number[];
  monthOffsets: number[];
  venueOffsets: Record<string, number>;
  trainedAt: string | null;
  trainingRows: number;
  meanAbsoluteError: number | null;
};

export type BuzzCalibrationFeatures = {
  venueId: string;
  hour: number;
  dayOfWeek: number;
  month: number;
  baseScore: number;
  familyStrength: Partial<Record<BuzzSignal["family"], number>>;
  sourceStrength: Record<string, number>;
};

/** A model trained on fewer rows than this stays inert. */
export const MINIMUM_TRAINING_ROWS = 8;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function emptyCalibrationModel(now = new Date()): BuzzCalibrationModel {
  return {
    version: "buzz-ml-v1",
    intercept: 0,
    baseWeight: 1,
    sourceFamilyWeights: {},
    sourceWeights: {},
    hourOffsets: Array.from({ length: 24 }, () => 0),
    dayOfWeekOffsets: Array.from({ length: 7 }, () => 0),
    monthOffsets: Array.from({ length: 12 }, () => 0),
    venueOffsets: {},
    trainedAt: now.toISOString(),
    trainingRows: 0,
    meanAbsoluteError: null,
  };
}

export function buildCalibrationFeatures(
  venue: VenueForBuzz,
  signals: BuzzSignal[],
  baseScore: number,
  referenceTime = new Date(),
): BuzzCalibrationFeatures {
  const familyStrength: BuzzCalibrationFeatures["familyStrength"] = {};
  const sourceStrength: Record<string, number> = {};
  for (const signal of signals) {
    const strength = clamp((Number(signal.value) || 0) / 100, 0, 1.5) * clamp(signal.confidence, 0, 1);
    familyStrength[signal.family] = Math.max(familyStrength[signal.family] || 0, strength);
    const source = signal.source.toLowerCase();
    sourceStrength[source] = Math.max(sourceStrength[source] || 0, strength);
  }
  const { hour, dayOfWeek, month } = localCalendarIndices(referenceTime);
  return { venueId: venue.id, hour, dayOfWeek, month, baseScore, familyStrength, sourceStrength };
}

export function applyCalibration(model: BuzzCalibrationModel | null, features: BuzzCalibrationFeatures) {
  if (!model || model.trainingRows < MINIMUM_TRAINING_ROWS) {
    return { score: features.baseScore, adjustment: 0, applied: false };
  }
  let adjustment = model.intercept + (model.baseWeight - 1) * features.baseScore;
  adjustment += model.hourOffsets[features.hour] || 0;
  adjustment += model.dayOfWeekOffsets[features.dayOfWeek] || 0;
  adjustment += model.monthOffsets[features.month] || 0;
  adjustment += model.venueOffsets[features.venueId] || 0;
  for (const [family, strength] of Object.entries(features.familyStrength)) {
    adjustment += (model.sourceFamilyWeights[family as BuzzSignal["family"]] || 0) * Number(strength || 0);
  }
  for (const [source, strength] of Object.entries(features.sourceStrength)) {
    adjustment += (model.sourceWeights[source] || 0) * Number(strength || 0);
  }
  adjustment = clamp(adjustment, -20, 20);
  return {
    score: Math.round(clamp(features.baseScore + adjustment, 0, 100)),
    adjustment: Number(adjustment.toFixed(2)),
    applied: true,
  };
}
