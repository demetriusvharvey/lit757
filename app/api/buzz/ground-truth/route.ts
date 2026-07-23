import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { recomputeBuzzScore } from "../../../../src/lib/buzz/repository";
import type { VenueForBuzz } from "../../../../src/lib/buzz/types";

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

function bandScore(band: string) {
  if (band === "packed") return 95;
  if (band === "busy") return 75;
  if (band === "steady") return 45;
  return 15;
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

  const [{ data: snapshot }, { data: venue, error: venueError }] = await Promise.all([
    db.from("buzz_score_snapshots")
      .select("score,label,score_mode,confidence,version,computed_at")
      .eq("venue_id", venueId)
      .maybeSingle(),
    db.from("venues")
      .select("id,name,address,city,type,category,ai_score")
      .eq("id", venueId)
      .maybeSingle(),
  ]);
  if (venueError || !venue) return NextResponse.json({ success: false, error: "Venue not found" }, { status: 404 });

  const actualScore = body?.occupancyPct == null
    ? bandScore(occupancyBand)
    : Math.max(0, Math.min(100, Math.round(Number(body.occupancyPct))));
  const metadata = {
    ...(body?.metadata || {}),
    predictedScore: snapshot?.score == null ? null : Number(snapshot.score),
    predictedLabel: snapshot?.label || null,
    predictedMode: snapshot?.score_mode || null,
    predictedConfidence: snapshot?.confidence || null,
    predictedVersion: snapshot?.version || null,
    predictedAt: snapshot?.computed_at || null,
  };

  const { data, error } = await db.from("buzz_ground_truth").insert({
    venue_id: venueId,
    observed_at: observedAt.toISOString(),
    occupancy_band: occupancyBand,
    occupancy_pct: actualScore,
    queue_minutes: body?.queueMinutes == null ? null : Math.max(0, Math.round(Number(body.queueMinutes))),
    observer_type: body?.observerType || "field_observer",
    notes: body?.notes || null,
    metadata,
  }).select("id").single();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const buzz = await recomputeBuzzScore(db, venue as VenueForBuzz, observedAt).catch(error => {
    console.error("Could not recompute calibrated Buzz score", error instanceof Error ? error.message : error);
    return null;
  });
  return NextResponse.json({ success: true, id: data.id, actualScore, modelUpdated: Boolean(buzz), buzz });
}
