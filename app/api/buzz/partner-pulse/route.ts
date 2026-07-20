import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { recomputeBuzzScore, saveBuzzSignals } from "../../../../src/lib/buzz/repository";
import type { BuzzSignal, VenueForBuzz } from "../../../../src/lib/buzz/types";

export const dynamic = "force-dynamic";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const bands = new Set(["quiet", "steady", "busy", "packed"]);

function bandValue(band: string) {
  if (band === "packed") return 95;
  if (band === "busy") return 75;
  if (band === "steady") return 45;
  return 15;
}

function authorized(request: Request) {
  const secret = process.env.BUZZ_PARTNER_INGEST_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}` || request.headers.get("x-buzz-partner-secret") === secret;
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as {
    venueId?: string;
    occupancyBand?: string;
    occupancyPct?: number | null;
    waitMinutes?: number | null;
    reservationsStatus?: string | null;
    ticketsStatus?: string | null;
    submittedBy?: string | null;
  } | null;

  const venueId = String(body?.venueId || "");
  const occupancyBand = String(body?.occupancyBand || "").toLowerCase();
  const occupancyPct = body?.occupancyPct == null ? null : Math.max(0, Math.min(100, Number(body.occupancyPct)));
  const waitMinutes = body?.waitMinutes == null ? null : Math.max(0, Math.round(Number(body.waitMinutes)));
  if (!venueId || !bands.has(occupancyBand)) {
    return NextResponse.json({ success: false, error: "venueId and a valid occupancyBand are required" }, { status: 400 });
  }

  const { data: venue, error: venueError } = await db
    .from("venues")
    .select("id,name,address,city,type,category,ai_score")
    .eq("id", venueId)
    .maybeSingle();
  if (venueError || !venue) return NextResponse.json({ success: false, error: "Venue not found" }, { status: 404 });

  const observedAt = new Date();
  const expiresAt = new Date(observedAt.getTime() + 30 * 60 * 1000);
  const { error: pulseError } = await db.from("venue_partner_pulses").insert({
    venue_id: venueId,
    occupancy_band: occupancyBand,
    occupancy_pct: occupancyPct,
    wait_minutes: waitMinutes,
    reservations_status: body?.reservationsStatus || null,
    tickets_status: body?.ticketsStatus || null,
    submitted_by: body?.submittedBy || null,
    verified: true,
    observed_at: observedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  });
  if (pulseError) return NextResponse.json({ success: false, error: pulseError.message }, { status: 500 });

  const signal: BuzzSignal = {
    source: "venue_partner",
    family: "first_party_occupancy",
    type: "partner_pulse",
    value: occupancyPct ?? bandValue(occupancyBand),
    isLive: true,
    confidence: 0.9,
    observedAt: observedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    metadata: {
      occupancyBand,
      waitMinutes,
      reservationsStatus: body?.reservationsStatus || null,
      ticketStatus: body?.ticketsStatus || null,
      submittedBy: body?.submittedBy || null,
      verified: true,
    },
  };
  await saveBuzzSignals(db, venueId, [signal]);
  const score = await recomputeBuzzScore(db, venue as VenueForBuzz);
  return NextResponse.json({ success: true, expiresAt: expiresAt.toISOString(), buzz: score });
}
