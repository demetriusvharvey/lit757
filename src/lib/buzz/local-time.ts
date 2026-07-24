// Buzz operates in Hampton Roads. Every calendar bucket (hour of night, day of
// week, month) must be derived in local time, because the servers run in UTC and
// a raw getHours() would shift a Friday 11pm observation into Saturday.
export const BUZZ_TIME_ZONE = "America/New_York";

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BUZZ_TIME_ZONE,
  weekday: "short",
  month: "numeric",
  hour: "numeric",
  hour12: false,
});

export function localParts(date: Date) {
  const parts = formatter.formatToParts(date);
  return {
    weekday: parts.find(part => part.type === "weekday")?.value || "Mon",
    month: Number(parts.find(part => part.type === "month")?.value || 1),
    hour: Number(parts.find(part => part.type === "hour")?.value || 0) % 24,
  };
}

/**
 * Zero-based calendar indices for array-backed calibration offsets:
 * hour 0-23, dayOfWeek 0-6 (Sunday first), month 0-11.
 */
export function localCalendarIndices(date: Date) {
  const { weekday, month, hour } = localParts(date);
  return {
    hour,
    dayOfWeek: WEEKDAY_INDEX[weekday] ?? 1,
    month: Math.min(11, Math.max(0, month - 1)),
  };
}

/**
 * A nightlife night runs past midnight, so 2am Saturday belongs to Friday
 * night. Anything before this local hour is attributed to the previous day.
 */
export const NIGHT_ROLLOVER_HOUR = 6;

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUZZ_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Stable identifier for the local night an instant belongs to, as YYYY-MM-DD.
 * Used to group observations so a held-out split never puts two observations
 * from the same night on opposite sides of the divide.
 */
export function localNightKey(date: Date) {
  const shifted = new Date(date.getTime() - NIGHT_ROLLOVER_HOUR * 3_600_000);
  return dayFormatter.format(shifted);
}
