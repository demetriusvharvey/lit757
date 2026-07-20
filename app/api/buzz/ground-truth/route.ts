import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const bands = new Set(["quiet", "steady", "busy", "packed"]);

function authorized(request: Request) {
  const secret = process.env.BUZZ_GROUND_TRUTH_SECRET || process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}` || request.headers.get("x-buzz-ground-truth-secret") === secret;
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as {
    venueId?: string;
    occupancyBand?: string;
    occupancyPct?: number | null;
    queueMinutes?: number | null;
    observedAt?: string;
    observerType?: string;
    notes?: string | null;
    metadata?: Record<string, unknown>;
  } | null;
  const venueId = String(body?.venueId || "");
  const occupancyBand = String(body?.occupancyBand || "").toLowerCase();
  if (!venueId || !bands.has(occupancyBand)) {
    return NextResponse.json({ success: false, error: "venueId and occupancyBand are required" }, { status: 400 });
  }
  const observedAt = body?.observedAt ? new Date(body.observedAt) : new Date();
  if (Number.isNaN(observedAt.getTime())) return NextResponse.json({ success: false, error: "Invalid observedAt" }, { status: 400 });

  const { data, error } = await db.from("buzz_ground_truth").insert({
    venue_id: venueId,
    observed_at: observedAt.toISOString(),
    occupancy_band: occupancyBand,
    occupancy_pct: body?.occupancyPct == null ? null : Math.max(0, Math.min(100, Math.round(Number(body.occupancyPct)))),
    queue_minutes: body?.queueMinutes == null ? null : Math.max(0, Math.round(Number(body.queueMinutes))),
    observer_type: body?.observerType || "field_observer",
    notes: body?.notes || null,
    metadata: body?.metadata || {},
  }).select("id").single();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, id: data.id });
}
