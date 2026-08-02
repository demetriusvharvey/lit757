export type ActivityTruthMode = "live" | "forecast";

export function activityTruthMode(value: unknown): ActivityTruthMode {
  return String(value || "").toLowerCase() === "live" ? "live" : "forecast";
}

export function activityStatusLabel(scoreValue: unknown, modeValue: unknown) {
  const score = Math.max(0, Math.min(100, Number(scoreValue) || 0));
  const mode = activityTruthMode(modeValue);

  if (mode === "live") {
    if (score >= 88) return "Strong Live Activity";
    if (score >= 76) return "High Live Activity";
    if (score >= 60) return "Live Activity";
    return "Light Live Activity";
  }

  if (score >= 76) return "High Activity Forecast";
  if (score >= 60) return "Active Forecast";
  if (score >= 35) return "Moderate Forecast";
  return "Low Forecast";
}

export function districtActivityLabel(scoreValue: unknown, modeValue: unknown) {
  const score = Math.max(0, Math.min(100, Number(scoreValue) || 0));
  const mode = activityTruthMode(modeValue);

  if (mode === "live") {
    if (score >= 84) return "Strong Live Activity";
    if (score >= 70) return "High Live Activity";
    if (score >= 54) return "Live Activity Building";
    return "Light Live Activity";
  }

  if (score >= 76) return "High Forecast";
  if (score >= 60) return "Elevated Forecast";
  if (score >= 45) return "Moderate Forecast";
  return "Low Forecast";
}

export function districtTruthMode(scoreModes: Iterable<unknown>): ActivityTruthMode {
  for (const mode of scoreModes) {
    if (activityTruthMode(mode) === "live") return "live";
  }
  return "forecast";
}
