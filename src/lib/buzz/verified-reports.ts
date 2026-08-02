export const VERIFIED_REPORT_LEVELS = new Set(["quiet", "steady", "busy", "packed"]);

export type VerifiedCrowdReport = {
  user_id?: string | null;
  device_hash?: string | null;
  crowd_level: string;
  observed_at: string;
  expires_at: string;
};

function reportIdentity(report: VerifiedCrowdReport) {
  if (report.user_id) return `user:${report.user_id}`;
  if (report.device_hash) return `device:${report.device_hash}`;
  return null;
}

function timestamp(value: string) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function crowdLevelValue(level: string) {
  if (level === "packed") return 95;
  if (level === "busy") return 75;
  if (level === "steady") return 45;
  return 15;
}

export function latestReportPerPerson<T extends VerifiedCrowdReport>(reports: readonly T[]) {
  const seen = new Set<string>();
  return [...reports]
    .filter(report => VERIFIED_REPORT_LEVELS.has(report.crowd_level))
    .sort((left, right) => timestamp(right.observed_at) - timestamp(left.observed_at))
    .filter(report => {
      const identity = reportIdentity(report);
      if (!identity || seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
}

export function summarizeVerifiedCrowdReports<T extends VerifiedCrowdReport>(reports: readonly T[]) {
  const uniqueReports = latestReportPerPerson(reports);
  if (!uniqueReports.length) return null;

  const values = uniqueReports.map(report => crowdLevelValue(report.crowd_level));
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  const consensus = Math.max(0.35, Math.min(1, 1 - Math.sqrt(variance) / 100));
  const validExpiries = uniqueReports
    .map(report => timestamp(report.expires_at))
    .filter(value => Number.isFinite(value));
  if (!validExpiries.length) return null;

  return {
    reports: uniqueReports,
    uniqueReporterCount: uniqueReports.length,
    average,
    consensus,
    latestObservedAt: uniqueReports[0].observed_at,
    expiresAt: new Date(Math.min(...validExpiries)).toISOString(),
  };
}

export function verifiedVenueDistanceLimit(accuracyMeters: number) {
  if (!Number.isFinite(accuracyMeters) || accuracyMeters <= 0 || accuracyMeters > 150) return null;
  return Math.min(180, Math.max(75, accuracyMeters * 1.2));
}

export function verifiesVenueProximity(distanceMeters: number, accuracyMeters: number) {
  const distanceLimit = verifiedVenueDistanceLimit(accuracyMeters);
  return distanceLimit !== null && Number.isFinite(distanceMeters) && distanceMeters <= distanceLimit;
}
