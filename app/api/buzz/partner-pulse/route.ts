import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { recomputeBuzzScore, saveBuzzSignals } from "../../../../src/lib/buzz/repository";
import type { BuzzSignal, VenueForBuzz } from "../../../../src/lib/buzz/types";
import {
  exceedsRequestRate,
  guardErrorResponse,
  hasBearerSecret,
  readBoundedJson,
  requestClientKey,
} from "../../../../src/lib/server/request-guards";

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

export async function POST(request: Request) {
  if (!hasBearerSecret(request, process.env.BUZZ_PARTNER_INGEST_SECRET)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (exceedsRequestRate(`partner-pulse:${requestClientKey(request)}`, 30, 60_000)) {
    return NextResponse.json({ success: false, error: "Too many requests" }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await readBoundedJson(request, 16_384);
  } catch (error) {
    return guardErrorResponse(error);
  }

  const venueId = typeof body.venueId === "string" ? body.venueId.trim() : "";
  const occupancyBand = typeof body.occupancyBand === "string" ? body.occupancyBand.toLowerCase() : "";
  const occupancyPct = body.occupancyPct == null ? null : Number(body.occupancyPct);
  const waitMinutes = body.waitMinutes == null ? null : Number(body.waitMinutes);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(venueId) || !bands.has(occupancyBand)) {
    return NextResponse.json({ success: false, error: "venueId and a valid occupancyBand are required" }, { status: 400 });
  }
  if ((occupancyPct != null && (!Number.isFinite(occupancyPct) || occupancyPct < 0 || occupancyPct > 100))
    || (waitMinutes != null && (!Number.isFinite(waitMinutes) || waitMinutes < 0 || waitMinutes > 360))) {
    return NextResponse.json({ success: false, error: "Invalid occupancy or wait time" }, { status: 400 });
  }

  const reservationsStatus = typeof body.reservationsStatus === "string"
    ? body.reservationsStatus.trim().slice(0, 120)
    : null;
  const ticketsStatus = typeof body.ticketsStatus === "string"
    ? body.ticketsStatus.trim().slice(0, 120)
    : null;
  const submittedBy = typeof body.submittedBy === "string"
    ? body.submittedBy.trim().slice(0, 120)
    : null;

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
    occupancy_pct: occupancyPct == null ? null : Math.round(occupancyPct),
    wait_minutes: waitMinutes == null ? null : Math.round(waitMinutes),
    reservations_status: reservationsStatus,
    tickets_status: ticketsStatus,
    submitted_by: submittedBy,
    verified: true,
    observed_at: observedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  });
  if (pulseError) return NextResponse.json({ success: false, error: pulseError.message }, { status: 500 });

  const signal: BuzzSignal = {
    source: "venue_partner",
    family: "first_party_occupancy",
    type: "partner_pulse",
    value: occupancyPct == null ? bandValue(occupancyBand) : Math.round(occupancyPct),
    isLive: true,
    confidence: 0.9,
    observedAt: observedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    metadata: {
      occupancyBand,
      waitMinutes: waitMinutes == null ? null : Math.round(waitMinutes),
      reservationsStatus,
      ticketStatus: ticketsStatus,
      submittedBy,
      verified: true,
    },
  };
  await saveBuzzSignals(db, venueId, [signal]);
  const score = await recomputeBuzzScore(db, venue as VenueForBuzz);
  return NextResponse.json({ success: true, expiresAt: expiresAt.toISOString(), buzz: score });
}
