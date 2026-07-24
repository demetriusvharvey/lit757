import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getRequestUser } from "../../../../src/lib/server-auth";
import {
  exceedsRequestRate,
  guardErrorResponse,
  readBoundedJson,
  requestClientKey,
} from "../../../../src/lib/server/request-guards";

export const dynamic = "force-dynamic";

const supabaseAdmin = getSupabaseAdmin();

const VALID_STATUSES = new Set([
  "active",
  "packed",
  "quiet",
  "line_short",
  "line_medium",
  "line_long",
  "parking_easy",
  "parking_hard",
]);

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to report activity." }, { status: 401 });
  if (exceedsRequestRate(`activity:${user.id}:${requestClientKey(request)}`, 12, 60_000)) {
    return NextResponse.json({ error: "Too many activity updates." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await readBoundedJson(request, 4_096);
  } catch (error) {
    return guardErrorResponse(error);
  }

  const venueId = typeof body.venueId === "string" ? body.venueId.trim() : "";
  const status = typeof body.status === "string" ? body.status.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(venueId) || !VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: "Choose a valid activity update." }, { status: 400 });
  }

  const cooldownStart = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const { data: recent } = await supabaseAdmin
    .from("activity_reports")
    .select("id,created_at")
    .eq("user_id", user.id)
    .eq("venue_id", venueId)
    .gte("created_at", cooldownStart)
    .limit(1)
    .maybeSingle();

  if (recent) {
    return NextResponse.json(
      { error: "You already updated this place recently. Check back in a little while." },
      { status: 429 }
    );
  }

  // Proximity is established only by /api/presence. A browser-provided boolean
  // must never increase reputation or points.
  const verifiedNearby = false;
  const { data: report, error: reportError } = await supabaseAdmin
    .from("activity_reports")
    .insert({
      user_id: user.id,
      venue_id: venueId,
      status,
      verified_nearby: verifiedNearby,
    })
    .select("id,created_at")
    .single();

  if (reportError) {
    return NextResponse.json({ error: reportError.message }, { status: 500 });
  }

  const awarded = 3;
  const { error: pointsError } = await supabaseAdmin.from("points_ledger").insert({
    user_id: user.id,
    action: "activity_report",
    points: awarded,
    reference_key: `activity:${report.id}`,
    metadata: { venueId, status, verifiedNearby: false },
  });

  if (pointsError) console.error("Could not award Points", pointsError.message);
  await supabaseAdmin.rpc("refresh_member_points", { target_user: user.id });

  return NextResponse.json({
    success: true,
    awarded,
    message: `Activity updated. +${awarded} Points`,
    report,
  });
}
