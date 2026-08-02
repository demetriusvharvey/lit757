import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { summarizeVerifiedCrowdReports } from "../../../../src/lib/buzz/verified-reports";

export const dynamic = "force-dynamic";

const db = getSupabaseAdmin();

function labelFor(value: number) {
  if (value >= 85) return "Packed";
  if (value >= 65) return "Busy";
  if (value >= 30) return "Steady";
  return "Quiet";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const venueId = String(url.searchParams.get("venueId") || "");
  if (!venueId) return NextResponse.json({ success: false, error: "venueId is required" }, { status: 400 });

  const now = new Date();
  const since = new Date(now.getTime() - 45 * 60 * 1000).toISOString();
  const [{ data: reports, error: reportError }, { data: partner, error: partnerError }] = await Promise.all([
    db
      .from("buzz_user_reports")
      .select("user_id,crowd_level,observed_at,expires_at")
      .eq("venue_id", venueId)
      .eq("verified_nearby", true)
      .gte("observed_at", since)
      .order("observed_at", { ascending: false })
      .limit(100),
    db
      .from("venue_partner_pulses")
      .select("occupancy_band,occupancy_pct,wait_minutes,reservations_status,tickets_status,verified,observed_at,expires_at")
      .eq("venue_id", venueId)
      .gt("expires_at", now.toISOString())
      .order("observed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (reportError) return NextResponse.json({ success: false, error: reportError.message }, { status: 500 });
  if (partnerError) console.error("Partner pulse unavailable", partnerError.message);

  const summary = summarizeVerifiedCrowdReports(reports || []);
  const average = summary?.average ?? null;
  const consensus = (summary?.uniqueReporterCount || 0) < 2 ? null : summary?.consensus ?? null;
  const latestObservedAt = [summary?.latestObservedAt, partner?.observed_at].filter(Boolean).sort().reverse()[0] || null;

  return NextResponse.json({
    success: true,
    venueId,
    generatedAt: now.toISOString(),
    community: {
      verifiedReportCount: summary?.uniqueReporterCount || 0,
      uniqueReporterCount: summary?.uniqueReporterCount || 0,
      crowdLevel: average == null ? null : labelFor(average),
      crowdValue: average == null ? null : Math.round(average),
      consensus: consensus == null ? null : Number(consensus.toFixed(2)),
      latestObservedAt,
    },
    partner: partner ? {
      occupancyBand: partner.occupancy_band,
      occupancyPct: partner.occupancy_pct,
      waitMinutes: partner.wait_minutes,
      reservationsStatus: partner.reservations_status,
      ticketsStatus: partner.tickets_status,
      verified: Boolean(partner.verified),
      observedAt: partner.observed_at,
      expiresAt: partner.expires_at,
    } : null,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
