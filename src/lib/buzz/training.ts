import { localCalendarIndices } from "./local-time";
import type { BuzzCalibrationModel } from "./calibration-model";

export type CalibrationTrainingRow = {
  venueId: string;
  predictedScore: number;
  actualScore: number;
  observedAt: string;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

// Shrink a bucket's mean residual toward zero by how little evidence backs it.
// A bucket with two observations must not move a public score as much as one
// with two hundred.
function shrink(offset: number, count: number, prior = 8) {
  return offset * (count / (count + prior));
}

export function trainCalibrationModel(rows: CalibrationTrainingRow[], now = new Date()): BuzzCalibrationModel {
  const clean = rows.filter(row =>
    Number.isFinite(row.predictedScore)
    && Number.isFinite(row.actualScore)
    && !Number.isNaN(new Date(row.observedAt).getTime()),
  );
  const errors = clean.map(row => clamp(row.actualScore, 0, 100) - clamp(row.predictedScore, 0, 100));
  const globalError = average(errors);
  const venueGroups = new Map<string, number[]>();
  const hourGroups = Array.from({ length: 24 }, () => [] as number[]);
  const dayGroups = Array.from({ length: 7 }, () => [] as number[]);
  const monthGroups = Array.from({ length: 12 }, () => [] as number[]);

  clean.forEach((row, index) => {
    const error = errors[index] - globalError;
    const { hour, dayOfWeek, month } = localCalendarIndices(new Date(row.observedAt));
    venueGroups.set(row.venueId, [...(venueGroups.get(row.venueId) || []), error]);
    hourGroups[hour].push(error);
    dayGroups[dayOfWeek].push(error);
    monthGroups[month].push(error);
  });

  const model: BuzzCalibrationModel = {
    version: "buzz-ml-v1",
    intercept: Number(clamp(globalError, -12, 12).toFixed(3)),
    baseWeight: 1,
    sourceFamilyWeights: {},
    sourceWeights: {},
    hourOffsets: hourGroups.map(group => Number(clamp(shrink(average(group), group.length, 12), -6, 6).toFixed(3))),
    dayOfWeekOffsets: dayGroups.map(group => Number(clamp(shrink(average(group), group.length, 10), -6, 6).toFixed(3))),
    monthOffsets: monthGroups.map(group => Number(clamp(shrink(average(group), group.length, 16), -5, 5).toFixed(3))),
    venueOffsets: {},
    trainedAt: now.toISOString(),
    trainingRows: clean.length,
    meanAbsoluteError: clean.length ? Number(average(errors.map(Math.abs)).toFixed(3)) : null,
  };

  for (const [venueId, group] of venueGroups) {
    if (group.length < 2) continue;
    model.venueOffsets[venueId] = Number(clamp(shrink(average(group), group.length, 6), -10, 10).toFixed(3));
  }
  return model;
}
