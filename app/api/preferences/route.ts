import { getSupabaseAdmin, jsonError, requireAuthenticatedUser } from "@/lib/supabase-admin";

type SavedVenueInput = { venueId: string; venueName?: string };
type VenueAlertInput = { venueId: string; venueName?: string; threshold?: number };

export async function GET(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const admin = getSupabaseAdmin();
    const [{ data: saved, error: savedError }, { data: alerts, error: alertsError }] = await Promise.all([
      admin.from("saved_venues").select("venue_id,venue_name,created_at").eq("user_id", user.id),
      admin.from("venue_alerts").select("venue_id,venue_name,threshold,enabled,last_score,last_notified_at").eq("user_id", user.id),
    ]);

    if (savedError) throw savedError;
    if (alertsError) throw alertsError;

    return Response.json({ saved: saved || [], alerts: alerts || [] });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const admin = getSupabaseAdmin();
    const body = (await request.json()) as { saved?: SavedVenueInput[]; alerts?: VenueAlertInput[] };
    const saved = Array.isArray(body.saved) ? body.saved.filter(item => item?.venueId) : [];
    const alerts = Array.isArray(body.alerts) ? body.alerts.filter(item => item?.venueId) : [];

    const { error: deleteSavedError } = await admin.from("saved_venues").delete().eq("user_id", user.id);
    if (deleteSavedError) throw deleteSavedError;
    if (saved.length) {
      const { error } = await admin.from("saved_venues").insert(saved.map(item => ({
        user_id: user.id,
        venue_id: String(item.venueId),
        venue_name: item.venueName || null,
      })));
      if (error) throw error;
    }

    const { data: existingAlerts, error: existingError } = await admin
      .from("venue_alerts")
      .select("venue_id,last_score,last_notified_at")
      .eq("user_id", user.id);
    if (existingError) throw existingError;
    const existingByVenue = new Map((existingAlerts || []).map(row => [String(row.venue_id), row]));

    const { error: deleteAlertsError } = await admin.from("venue_alerts").delete().eq("user_id", user.id);
    if (deleteAlertsError) throw deleteAlertsError;
    if (alerts.length) {
      const { error } = await admin.from("venue_alerts").insert(alerts.map(item => {
        const existing = existingByVenue.get(String(item.venueId));
        return {
          user_id: user.id,
          venue_id: String(item.venueId),
          venue_name: item.venueName || null,
          threshold: Math.max(50, Math.min(100, Number(item.threshold) || 80)),
          enabled: true,
          last_score: existing?.last_score ?? null,
          last_notified_at: existing?.last_notified_at ?? null,
        };
      }));
      if (error) throw error;
    }

    return Response.json({ success: true, savedCount: saved.length, alertCount: alerts.length });
  } catch (error) {
    return jsonError(error);
  }
}
