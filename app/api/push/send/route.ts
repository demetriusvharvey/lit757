import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { PushSubscription } from "web-push";
import { isCronAuthorized } from "../../../../src/lib/cron-auth";
import {
  getPushConfiguration,
  pushStatusCode,
  sendWebPush,
  type PushPayload,
} from "../../../../src/lib/push-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

type StoredSubscription = {
  id: string;
  user_id: string;
  endpoint: string;
  expiration_time: string | null;
  p256dh: string;
  auth: string;
};

type SavedVenue = {
  id: string;
  name: string;
  city: string | null;
};

type EventRow = {
  id: string;
  name: string | null;
  venue_name: string | null;
  start_time: string | null;
};

type AlertCandidate = {
  key: string;
  priority: number;
  venueId: string;
  payload: PushPayload;
};

function canonicalName(value: string | null | undefined) {
  return (value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|at|venue|center|centre)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function eventMatchesVenue(event: EventRow, venue: SavedVenue) {
  const eventVenue = canonicalName(event.venue_name);
  const savedVenue = canonicalName(venue.name);
  if (!eventVenue || !savedVenue) return false;
  if (eventVenue === savedVenue) return true;
  if (Math.min(eventVenue.length, savedVenue.length) >= 8) {
    if (eventVenue.includes(savedVenue) || savedVenue.includes(eventVenue)) return true;
  }

  const eventTokens = new Set(eventVenue.split(" ").filter((token) => token.length > 2));
  const venueTokens = savedVenue.split(" ").filter((token) => token.length > 2);
  const shared = venueTokens.filter((token) => eventTokens.has(token)).length;
  return shared >= 2 && shared / Math.max(eventTokens.size, venueTokens.length) >= 0.55;
}

function easternTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function dayKey(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function bestCandidate(
  venueIds: string[],
  venues: Map<string, SavedVenue>,
  events: EventRow[],
  nearbyCounts: Map<string, number>,
  now: Date
) {
  const candidates: AlertCandidate[] = [];

  for (const venueId of venueIds) {
    const venue = venues.get(venueId);
    if (!venue) continue;

    const event = events.find((entry) => eventMatchesVenue(entry, venue));
    if (event?.start_time) {
      const hoursUntil = (new Date(event.start_time).getTime() - now.getTime()) / 3_600_000;
      if (hoursUntil >= 0 && hoursUntil <= 3) {
        candidates.push({
          key: `event:${event.id}:three-hours`,
          priority: hoursUntil <= 1.5 ? 100 : 72,
          venueId,
          payload: {
            title: `Starting soon at ${venue.name}`,
            body: `${event.name || "A saved event"} begins ${easternTime(event.start_time)}.`,
            tag: `event-${event.id}`,
            url: `/?venue=${encodeURIComponent(venueId)}&source=push`,
          },
        });
      }
    }

    const nearbyCount = nearbyCounts.get(venueId) || 0;
    if (nearbyCount >= 2) {
      const hot = nearbyCount >= 4;
      candidates.push({
        key: `heat:${venueId}:${hot ? "hot" : "active"}:${dayKey(now)}`,
        priority: hot ? 90 : 68,
        venueId,
        payload: {
          title: hot ? `Hot right now: ${venue.name}` : `Activity at ${venue.name}`,
          body: hot
            ? `People are gathering around this spot${venue.city ? ` in ${venue.city}` : ""}.`
            : `This spot is starting to pick up${venue.city ? ` in ${venue.city}` : ""}.`,
          tag: `heat-${venueId}`,
          url: `/?venue=${encodeURIComponent(venueId)}&source=push`,
        },
      });
    }
  }

  return candidates.sort((left, right) => right.priority - left.priority)[0] || null;
}

function databaseError(message: string) {
  const missingTable = message.includes("push_subscriptions") || message.includes("schema cache");
  return NextResponse.json(
    {
      error: missingTable
        ? "Push storage is not installed yet. Apply the included Supabase migration."
        : "The push alert scan failed.",
    },
    { status: missingTable ? 503 : 500 }
  );
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!getPushConfiguration().configured) {
    return NextResponse.json({ error: "Web Push credentials are missing" }, { status: 503 });
  }

  const now = new Date();
  const presenceStart = new Date(now.getTime() - 45 * 60 * 1000).toISOString();
  const eventEnd = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString();
  const [subscriptionsResult, likesResult, venuesResult, eventsResult, presenceResult] =
    await Promise.all([
      supabaseAdmin
        .from("push_subscriptions")
        .select("id,user_id,endpoint,expiration_time,p256dh,auth")
        .eq("enabled", true)
        .limit(2000),
      supabaseAdmin
        .from("venue_live_reports")
        .select("device_id,venue_id")
        .eq("report_type", "member_like")
        .limit(5000),
      supabaseAdmin.from("venues").select("id,name,city").limit(1000),
      supabaseAdmin
        .from("events")
        .select("id,name,venue_name,start_time")
        .gte("start_time", now.toISOString())
        .lte("start_time", eventEnd)
        .order("start_time", { ascending: true })
        .limit(1000),
      supabaseAdmin
        .from("venue_live_reports")
        .select("venue_id,device_id")
        .eq("report_type", "nearby_presence")
        .gte("created_at", presenceStart)
        .limit(5000),
    ]);

  const firstError = [
    subscriptionsResult.error,
    likesResult.error,
    venuesResult.error,
    eventsResult.error,
    presenceResult.error,
  ].find(Boolean);
  if (firstError) return databaseError(firstError.message);

  const subscriptions = (subscriptionsResult.data || []) as StoredSubscription[];
  const likesByUser = new Map<string, string[]>();
  for (const like of likesResult.data || []) {
    if (!like.device_id || !like.venue_id) continue;
    const venueIds = likesByUser.get(like.device_id) || [];
    if (!venueIds.includes(like.venue_id)) venueIds.push(like.venue_id);
    likesByUser.set(like.device_id, venueIds);
  }

  const venues = new Map(
    ((venuesResult.data || []) as SavedVenue[]).map((venue) => [venue.id, venue])
  );
  const nearbyMembers = new Map<string, Set<string>>();
  for (const report of presenceResult.data || []) {
    if (!report.venue_id || !report.device_id) continue;
    const members = nearbyMembers.get(report.venue_id) || new Set<string>();
    members.add(report.device_id);
    nearbyMembers.set(report.venue_id, members);
  }
  const nearbyCounts = new Map(
    [...nearbyMembers].map(([venueId, members]) => [venueId, members.size])
  );
  const events = (eventsResult.data || []) as EventRow[];
  const deliveryKeysBySubscription = new Map<string, Set<string>>();
  const subscriptionIds = subscriptions.map((subscription) => subscription.id);

  if (subscriptionIds.length) {
    const { data: deliveries, error } = await supabaseAdmin
      .from("push_deliveries")
      .select("subscription_id,alert_key")
      .in("subscription_id", subscriptionIds)
      .gte("delivered_at", new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString())
      .limit(10000);
    if (error) return databaseError(error.message);

    for (const delivery of deliveries || []) {
      const keys = deliveryKeysBySubscription.get(delivery.subscription_id) || new Set<string>();
      keys.add(delivery.alert_key);
      deliveryKeysBySubscription.set(delivery.subscription_id, keys);
    }
  }

  const totals = { sent: 0, skipped: 0, removed: 0, failed: 0 };

  async function processSubscription(subscription: StoredSubscription) {
    if (subscription.expiration_time && new Date(subscription.expiration_time) <= now) {
      await supabaseAdmin.from("push_subscriptions").delete().eq("id", subscription.id);
      totals.removed += 1;
      return;
    }

    const candidate = bestCandidate(
      likesByUser.get(subscription.user_id) || [],
      venues,
      events,
      nearbyCounts,
      now
    );
    if (!candidate || deliveryKeysBySubscription.get(subscription.id)?.has(candidate.key)) {
      totals.skipped += 1;
      return;
    }

    const { error: reservationError } = await supabaseAdmin.from("push_deliveries").insert({
      subscription_id: subscription.id,
      user_id: subscription.user_id,
      venue_id: candidate.venueId,
      alert_key: candidate.key,
    });
    if (reservationError?.code === "23505") {
      totals.skipped += 1;
      return;
    }
    if (reservationError) {
      console.error("Could not reserve Web Push delivery", reservationError.code || "unknown");
      totals.failed += 1;
      return;
    }

    const pushSubscription: PushSubscription = {
      endpoint: subscription.endpoint,
      expirationTime: subscription.expiration_time
        ? new Date(subscription.expiration_time).getTime()
        : null,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    };

    try {
      await sendWebPush(pushSubscription, candidate.payload);
      totals.sent += 1;
    } catch (error) {
      const statusCode = pushStatusCode(error);
      if (statusCode === 404 || statusCode === 410) {
        await supabaseAdmin.from("push_subscriptions").delete().eq("id", subscription.id);
        totals.removed += 1;
      } else {
        await supabaseAdmin
          .from("push_deliveries")
          .delete()
          .eq("subscription_id", subscription.id)
          .eq("alert_key", candidate.key);
        console.error("Web Push delivery failed", statusCode || "unknown");
        totals.failed += 1;
      }
    }
  }

  const concurrency = 10;
  for (let index = 0; index < subscriptions.length; index += concurrency) {
    await Promise.all(subscriptions.slice(index, index + concurrency).map(processSubscription));
  }

  return NextResponse.json(
    {
      success: totals.failed === 0,
      checkedAt: now.toISOString(),
      subscriptions: subscriptions.length,
      ...totals,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  return GET(request);
}
