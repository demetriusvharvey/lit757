import type { BuzzSignal } from "../types";

type PredictHQEvent = {
  id: string;
  title?: string;
  category?: string;
  rank?: number;
  local_rank?: number;
  phq_attendance?: number;
  start?: string;
  end?: string;
  location?: { geopoint?: { lat?: number; lon?: number } };
  entities?: Array<{ entity_id?: string; name?: string; type?: string; formatted_address?: string }>;
};

type PredictHQResponse = {
  count?: number;
  overflow?: boolean;
  results?: PredictHQEvent[];
};

export function isPredictHQConfigured() {
  return Boolean(process.env.PREDICTHQ_ACCESS_TOKEN);
}

export async function fetchPredictedEvents(input: {
  latitude: number;
  longitude: number;
  radiusMiles?: number;
  start: string;
  end: string;
  limit?: number;
}) {
  const token = process.env.PREDICTHQ_ACCESS_TOKEN;
  if (!token) throw new Error("PREDICTHQ_ACCESS_TOKEN is not configured");
  const params = new URLSearchParams({
    within: `${input.radiusMiles || 1}mi@${input.latitude},${input.longitude}`,
    "active.gte": input.start,
    "active.lte": input.end,
    limit: String(Math.min(100, Math.max(1, input.limit || 20))),
    sort: "-local_rank",
  });
  const response = await fetch(`https://api.predicthq.com/v1/events/?${params.toString()}`, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`PredictHQ events failed (${response.status})`);
  return response.json() as Promise<PredictHQResponse>;
}

export function predictedAttendanceSignal(event: PredictHQEvent, observedAt = new Date()): BuzzSignal {
  const rank = Number(event.local_rank ?? event.rank ?? 0);
  const eventStart = event.start ? new Date(event.start).getTime() : observedAt.getTime() + 24 * 60 * 60 * 1000;
  return {
    source: "predicthq",
    family: "event_forecast",
    type: "predicted_attendance",
    value: Math.max(0, Math.min(100, rank)),
    isLive: false,
    confidence: event.phq_attendance ? 0.68 : 0.52,
    observedAt: observedAt.toISOString(),
    expiresAt: new Date(Math.max(observedAt.getTime() + 60 * 60 * 1000, eventStart + 2 * 60 * 60 * 1000)).toISOString(),
    metadata: {
      eventId: event.id,
      title: event.title || null,
      category: event.category || null,
      rank: event.rank ?? null,
      localRank: event.local_rank ?? null,
      predictedAttendance: event.phq_attendance ?? null,
      start: event.start || null,
      end: event.end || null,
      venue: event.entities?.find(entity => entity.type === "venue") || null,
    },
  };
}
