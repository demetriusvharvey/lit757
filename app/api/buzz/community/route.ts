import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const allowedLevels = new Set(["quiet", "steady", "busy", "packed"]);

function levelValue(level: string) {
  if (level === "packed") return 95;
  if (level === "busy") return 75;
  if (level === "steady") return 45;
  return 15;
}

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
      .select("user_id,crowd_level,observed_at")
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

  const validReports = (reports || []).filter(report => allowedLevels.has(String(report.crowd_level)));
  const uniqueUsers = new Set(validReports.map(report => report.user_id).filter(Boolean));
  const values = validReports.map(report => levelValue(String(report.crowd_level)));
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const variance = average == null ? 0 : values.reduce((sum, value) => sum + (value - average) ** 2, 0) / Math.max(1, values.length);
  const consensus = values.length < 2 ? null : Math.max(0, Math.min(1, 1 - Math.sqrt(variance) / 100));
  const latestObservedAt = [validReports[0]?.observed_at, partner?.observed_at].filter(Boolean).sort().reverse()[0] || null;

  return NextResponse.json({
    success: true,
    venueId,
    generatedAt: now.toISOString(),
    community: {
      verifiedReportCount: validReports.length,
      uniqueReporterCount: uniqueUsers.size,
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
