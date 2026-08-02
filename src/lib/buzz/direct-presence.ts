export const DIRECT_PRESENCE_WINDOW_MINUTES = 15;
export const DIRECT_PRESENCE_PRIVACY_FLOOR = 3;

export type DirectPresenceType = "passive_presence" | "nearby_presence";

export type DirectPresenceRow = {
  venue_id?: string | null;
  device_id?: string | null;
  report_type?: string | null;
  created_at?: string | null;
};

export type DirectPresenceGroup = {
  passive: Set<string>;
  verified: Set<string>;
};

type PresenceCandidate = {
  venueId: string;
  deviceId: string;
  reportType: DirectPresenceType;
  observedAt: string;
  timestamp: number;
};

function parsedTimestamp(value: unknown) {
  const timestamp = new Date(String(value || "")).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function presenceType(value: unknown): DirectPresenceType | null {
  if (value === "passive_presence" || value === "nearby_presence") return value;
  return null;
}

export function presenceMeetsLiveThreshold(args: { passiveDevices: number; verifiedDevices: number }) {
  const passive = Math.max(0, Math.round(args.passiveDevices));
  const verified = Math.max(0, Math.round(args.verifiedDevices));
  return passive >= 3 || verified >= 2 || (passive >= 2 && verified >= 1);
}

export function directPresenceBand(count: number) {
  const safeCount = Math.max(0, Math.floor(count));
  if (safeCount === 0) return "none";
  if (safeCount < 3) return "1–2";
  if (safeCount < 10) return "3–9";
  if (safeCount < 25) return "10–24";
  if (safeCount < 50) return "25–49";
  return "50+";
}

export function privacySafeDirectPresenceCount(count: number) {
  const safeCount = Math.max(0, Math.floor(count));
  return safeCount === 0 || safeCount >= DIRECT_PRESENCE_PRIVACY_FLOOR ? safeCount : null;
}

export function groupDirectPresence(
  rows: readonly DirectPresenceRow[],
  reference = new Date(),
  windowMinutes = DIRECT_PRESENCE_WINDOW_MINUTES
) {
  const referenceTimestamp = reference.getTime();
  const safeReference = Number.isFinite(referenceTimestamp) ? referenceTimestamp : Date.now();
  const safeWindowMinutes = Math.max(1, Math.min(60, Math.round(windowMinutes)));
  const cutoff = safeReference - safeWindowMinutes * 60_000;
  const latestByDevice = new Map<string, PresenceCandidate>();
  const ambiguousDevices = new Set<string>();

  for (const row of rows) {
    const venueId = String(row.venue_id || "").trim();
    const deviceId = String(row.device_id || "").trim();
    const reportType = presenceType(row.report_type);
    const timestamp = parsedTimestamp(row.created_at);
    if (!venueId || !deviceId || !reportType || timestamp === null) continue;
    if (timestamp < cutoff || timestamp > safeReference + 60_000) continue;

    const candidate: PresenceCandidate = {
      venueId,
      deviceId,
      reportType,
      observedAt: new Date(timestamp).toISOString(),
      timestamp,
    };
    const current = latestByDevice.get(deviceId);
    if (!current || timestamp > current.timestamp) {
      latestByDevice.set(deviceId, candidate);
      ambiguousDevices.delete(deviceId);
      continue;
    }
    if (timestamp !== current.timestamp) continue;
    if (venueId !== current.venueId) {
      ambiguousDevices.add(deviceId);
      continue;
    }
    if (reportType === "nearby_presence" && current.reportType === "passive_presence") {
      latestByDevice.set(deviceId, candidate);
    }
  }

  const byVenue = new Map<string, DirectPresenceGroup>();
  let passiveDevices = 0;
  let verifiedDevices = 0;
  let latestObservedAt: string | null = null;
  let latestObservedTimestamp = Number.NEGATIVE_INFINITY;

  for (const [deviceId, candidate] of latestByDevice) {
    if (ambiguousDevices.has(deviceId)) continue;
    const group = byVenue.get(candidate.venueId) || { passive: new Set<string>(), verified: new Set<string>() };
    if (candidate.reportType === "passive_presence") {
      group.passive.add(deviceId);
      passiveDevices += 1;
    } else {
      group.verified.add(deviceId);
      verifiedDevices += 1;
    }
    byVenue.set(candidate.venueId, group);
    if (candidate.timestamp > latestObservedTimestamp) {
      latestObservedTimestamp = candidate.timestamp;
      latestObservedAt = candidate.observedAt;
    }
  }

  const activeDevices = passiveDevices + verifiedDevices;
  const venuesMeetingLiveThreshold = [...byVenue.values()].filter(group => presenceMeetsLiveThreshold({
    passiveDevices: group.passive.size,
    verifiedDevices: group.verified.size,
  })).length;

  return {
    byVenue,
    activeDevices,
    passiveDevices,
    verifiedDevices,
    venuesWithEvidence: byVenue.size,
    venuesMeetingLiveThreshold,
    venuesBelowLiveThreshold: byVenue.size - venuesMeetingLiveThreshold,
    latestObservedAt,
    ambiguousDevicesSkipped: ambiguousDevices.size,
    windowMinutes: safeWindowMinutes,
  };
}
