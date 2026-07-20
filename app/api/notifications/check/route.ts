import webpush from "web-push";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AlertRow = {
  user_id: string;
  venue_id: string;
  venue_name: string | null;
  threshold: number;
  enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string | null;
  cooldown_minutes: number | null;
  last_score: number | null;
  last_notified_at: string | null;
};

type SubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type DiscoveryVenue = {
  id: string;
  name?: string;
  activity?: { score?: number };
  score?: number;
};

function minutesNow(timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());
    const hour = Number(parts.find(part => part.type === "hour")?.value || 0);
    const minute = Number(parts.find(part => part.type === "minute")?.value || 0);
    return hour * 60 + minute;
  } catch {
    return new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
  }
}

function parseMinutes(value: string | null, fallback: number) {
  if (!value) return fallback;
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return fallback;
  return hour * 60 + minute;
}

function isQuietHours(alert: AlertRow) {
  const current = minutesNow(alert.timezone || "America/New_York");
  const start = parseMinutes(alert.quiet_hours_start, 22 * 60);
  const end = parseMinutes(alert.quiet_hours_end, 8 * 60);
  return start <= end ? current >= start && current < end : current >= start || current < end;
}

function cooldownComplete(alert: AlertRow) {
  if (!alert.last_notified_at) return true;
  const cooldownMs = Math.max(60, alert.cooldown_minutes || 180) * 60_000;
  return Date.now() - new Date(alert.last_notified_at).getTime() >= cooldownMs;
}

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || "";
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || "";
  if (!vapidPublicKey || !vapidPrivateKey) {
    return Response.json({ error: "VAPID keys are not configured" }, { status: 503 });
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:hello@lit757.app",
    vapidPublicKey,
    vapidPrivateKey,
  );

  const admin = getSupabaseAdmin();
  const { data: alertData, error: alertError } = await admin
    .from("venue_alerts")
    .select("user_id,venue_id,venue_name,threshold,enabled,quiet_hours_start,quiet_hours_end,timezone,cooldown_minutes,last_score,last_notified_at")
    .eq("enabled", true);

  if (alertError) throw alertError;
  const alerts = (alertData || []) as AlertRow[];
  if (!alerts.length) return Response.json({ checked: 0, sent: 0 });

  const discoverUrl = new URL("/api/discover?city=All%20757&mode=all", request.url);
  const discoverResponse = await fetch(discoverUrl, { cache: "no-store" });
  if (!discoverResponse.ok) {
    return Response.json({ error: "Could not load current Buzz scores" }, { status: 502 });
  }

  const discovery = await discoverResponse.json() as { venues?: DiscoveryVenue[]; picks?: DiscoveryVenue[] };
  const venues = discovery.venues || discovery.picks || [];
  const venueById = new Map(venues.map(venue => [String(venue.id), venue]));
  const userIds = [...new Set(alerts.map(alert => alert.user_id))];

  const { data: subscriptionData, error: subscriptionError } = await admin
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth")
    .eq("enabled", true)
    .in("user_id", userIds);
  if (subscriptionError) throw subscriptionError;

  const subscriptionsByUser = new Map<string, SubscriptionRow[]>();
  for (const subscription of (subscriptionData || []) as SubscriptionRow[]) {
    const list = subscriptionsByUser.get(subscription.user_id) || [];
    list.push(subscription);
    subscriptionsByUser.set(subscription.user_id, list);
  }

  let sent = 0;
  let expired = 0;

  for (const alert of alerts) {
    const venue = venueById.get(String(alert.venue_id));
    if (!venue) continue;

    const currentScore = Math.round(Number(venue.activity?.score ?? venue.score ?? 0));
    const previousScore = alert.last_score;
    const crossedThreshold = previousScore !== null && previousScore < alert.threshold && currentScore >= alert.threshold;
    const shouldSend = crossedThreshold && cooldownComplete(alert) && !isQuietHours(alert);
    let notifiedAt: string | null = null;

    if (shouldSend) {
      const subscriptions = subscriptionsByUser.get(alert.user_id) || [];
      const venueName = venue.name || alert.venue_name || "A saved place";
      const payload = JSON.stringify({
        title: `🔥 ${venueName} is heating up`,
        body: `Buzz just reached ${currentScore}. This may be the right time to go.`,
        icon: "/icon.svg",
        badge: "/icon.svg",
        tag: `buzz-${alert.venue_id}`,
        url: `/?venue=${encodeURIComponent(alert.venue_id)}`,
        venueId: alert.venue_id,
      });

      for (const subscription of subscriptions) {
        try {
          await webpush.sendNotification({
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          }, payload, { TTL: 900, urgency: "high" });
          sent += 1;
          notifiedAt = new Date().toISOString();
        } catch (error) {
          const statusCode = typeof error === "object" && error && "statusCode" in error
            ? Number((error as { statusCode?: number }).statusCode)
            : 0;
          if (statusCode === 404 || statusCode === 410) {
            await admin.from("push_subscriptions").delete().eq("id", subscription.id);
            expired += 1;
          }
        }
      }
    }

    const update: { last_score: number; updated_at: string; last_notified_at?: string } = {
      last_score: currentScore,
      updated_at: new Date().toISOString(),
    };
    if (notifiedAt) update.last_notified_at = notifiedAt;

    await admin
      .from("venue_alerts")
      .update(update)
      .eq("user_id", alert.user_id)
      .eq("venue_id", alert.venue_id);
  }

  return Response.json({ checked: alerts.length, sent, expired });
}

export const POST = GET;
