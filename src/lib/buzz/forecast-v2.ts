export type GoogleHours = {
  periods?: Array<{
    open?: { day?: number; hour?: number; minute?: number };
    close?: { day?: number; hour?: number; minute?: number };
  }>;
};

export type TrafficMetadata = {
  baselineReady?: boolean;
  baselineCongestion?: number;
  anomaly?: number;
  percentile?: number;
  sampleSize?: number;
};

const WEEK_MINUTES = 7 * 24 * 60;
const DAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function easternClock(reference: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(reference);
  const weekday = parts.find(part => part.type === "weekday")?.value || "Mon";
  const hour = Number(parts.find(part => part.type === "hour")?.value || 0) % 24;
  const minute = Number(parts.find(part => part.type === "minute")?.value || 0);
  return { day: DAY_INDEX[weekday] ?? 1, hour, minute };
}

export function venueOpenStatus(hours: unknown, reference = new Date()) {
  const periods = (hours as GoogleHours | null)?.periods;
  if (!Array.isArray(periods) || !periods.length) {
    return { open: null as boolean | null, minutesToClose: null as number | null };
  }

  const clock = easternClock(reference);
  const current = clock.day * 1440 + clock.hour * 60 + clock.minute;
  let recognized = false;

  for (const period of periods) {
    const openDay = Number(period.open?.day);
    const openHour = Number(period.open?.hour || 0);
    const openMinute = Number(period.open?.minute || 0);
    if (!Number.isInteger(openDay) || openDay < 0 || openDay > 6) continue;
    recognized = true;

    const start = openDay * 1440 + openHour * 60 + openMinute;
    if (!period.close) return { open: true, minutesToClose: null };

    const closeDay = Number(period.close.day);
    const closeHour = Number(period.close.hour || 0);
    const closeMinute = Number(period.close.minute || 0);
    if (!Number.isInteger(closeDay) || closeDay < 0 || closeDay > 6) continue;

    let end = closeDay * 1440 + closeHour * 60 + closeMinute;
    if (end <= start) end += WEEK_MINUTES;

    for (const candidate of [current, current + WEEK_MINUTES]) {
      if (candidate >= start && candidate < end) {
        return { open: true, minutesToClose: Math.max(0, end - candidate) };
      }
    }
  }

  return { open: recognized ? false : null, minutesToClose: null };
}

export function openHoursAdjustment(args: {
  hours: unknown;
  eventActive: boolean;
  eventSoon: boolean;
  reference?: Date;
}) {
  const status = venueOpenStatus(args.hours, args.reference);
  if (status.open === true) {
    if (status.minutesToClose !== null && status.minutesToClose <= 30) {
      return { ...status, points: -3, cap: null as number | null, label: "Closing soon" };
    }
    return { ...status, points: 3, cap: null as number | null, label: "Open now" };
  }
  if (status.open === false) {
    if (args.eventActive) return { ...status, points: -4, cap: 78, label: "Event timing conflicts with listed hours" };
    if (args.eventSoon) return { ...status, points: -14, cap: 58, label: "Currently closed; event starts later" };
    return { ...status, points: -34, cap: 36, label: "Closed now" };
  }
  return { ...status, points: 0, cap: null as number | null, label: null as string | null };
}

export function trafficEvidence(rawValue: number, metadata: unknown) {
  const raw = clamp(Number(rawValue || 0), 0, 100);
  const row = (metadata && typeof metadata === "object" ? metadata : {}) as TrafficMetadata;
  const baseline = Number(row.baselineCongestion);
  const anomaly = Number(row.anomaly);
  const percentile = Number(row.percentile);
  const sampleSize = Math.max(0, Number(row.sampleSize || 0));
  const baselineReady = row.baselineReady === true && Number.isFinite(baseline) && Number.isFinite(anomaly) && sampleSize >= 6;

  if (!baselineReady) {
    const points = raw >= 65 ? 5 : raw >= 40 ? 3 : raw >= 20 ? 1 : 0;
    return {
      raw,
      baseline: null as number | null,
      anomaly: null as number | null,
      percentile: null as number | null,
      sampleSize,
      baselineReady: false,
      points,
      label: raw >= 40 ? "Area traffic is elevated while the local baseline learns" : null as string | null,
    };
  }

  let points = 0;
  if (anomaly >= 22 && raw >= 30) points = 12;
  else if (anomaly >= 14 && raw >= 25) points = 9;
  else if (anomaly >= 8 && raw >= 20) points = 6;
  else if (anomaly >= 4 && raw >= 18) points = 3;
  else if (anomaly <= -12) points = -2;

  return {
    raw,
    baseline: Number(baseline.toFixed(1)),
    anomaly: Number(anomaly.toFixed(1)),
    percentile: Number.isFinite(percentile) ? Number(percentile.toFixed(2)) : null,
    sampleSize,
    baselineReady: true,
    points,
    label: points >= 9
      ? "Area traffic is far above normal for this time"
      : points >= 6
        ? "Area traffic is above normal for this time"
        : points >= 3
          ? "Area arrivals are building above normal"
          : null,
  };
}

export function passivePresenceEvidence(args: { passiveDevices: number; verifiedDevices: number }) {
  const passive = Math.max(0, Math.round(args.passiveDevices));
  const verified = Math.max(0, Math.round(args.verifiedDevices));
  const points = Math.min(24, passive * 4 + verified * 7);
  const live = passive >= 3 || verified >= 2 || (passive >= 2 && verified >= 1);
  const confidence = live && passive + verified >= 5 ? "high" : live ? "medium" : "low";
  const label = live
    ? `${passive + verified} independent phones nearby`
    : passive + verified > 0
      ? "Early nearby phone activity"
      : null;
  return { passive, verified, points, live, confidence, label };
}
