import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestUser } from "../../../../src/lib/server-auth";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

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

  const body = await request.json().catch(() => null) as {
    venueId?: string;
    status?: string;
    verifiedNearby?: boolean;
  } | null;

  const venueId = body?.venueId?.trim();
  const status = body?.status?.trim();
  if (!venueId || !status || !VALID_STATUSES.has(status)) {
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

  const verifiedNearby = Boolean(body?.verifiedNearby);
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

  const awarded = verifiedNearby ? 10 : 3;
  const { error: pointsError } = await supabaseAdmin.from("points_ledger").insert({
    user_id: user.id,
    action: verifiedNearby ? "verified_activity_report" : "activity_report",
    points: awarded,
    reference_key: `activity:${report.id}`,
    metadata: { venueId, status, verifiedNearby },
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
