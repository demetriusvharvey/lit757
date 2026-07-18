import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestUser } from "../../../../src/lib/server-auth";
import { getPushConfiguration } from "../../../../src/lib/push-server";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

type SubscriptionBody = {
  endpoint?: unknown;
  expirationTime?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
};

function validSubscription(body: SubscriptionBody | null) {
  if (!body || typeof body.endpoint !== "string") return null;
  if (!body.endpoint.startsWith("https://") || body.endpoint.length > 4096) return null;
  if (typeof body.keys?.p256dh !== "string" || typeof body.keys.auth !== "string") return null;
  if (body.keys.p256dh.length > 512 || body.keys.auth.length > 256) return null;

  return {
    endpoint: body.endpoint,
    expirationTime:
      typeof body.expirationTime === "number"
        ? new Date(body.expirationTime).toISOString()
        : null,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth,
  };
}

function databaseUnavailable(message: string) {
  const missingTable = message.includes("push_subscriptions") || message.includes("schema cache");
  return NextResponse.json(
    {
      error: missingTable
        ? "Push storage is not installed yet. Apply the included Supabase migration."
        : "Could not update this device's alerts.",
    },
    { status: missingTable ? 503 : 500 }
  );
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!getPushConfiguration().configured) {
    return NextResponse.json({ error: "Background alerts are not configured yet." }, { status: 503 });
  }

  const subscription = validSubscription(await request.json().catch(() => null));
  if (!subscription) {
    return NextResponse.json({ error: "A valid push subscription is required" }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: subscription.endpoint,
      expiration_time: subscription.expirationTime,
      p256dh: subscription.p256dh,
      auth: subscription.auth,
      user_agent: (request.headers.get("user-agent") || "").slice(0, 500),
      enabled: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" }
  );

  if (error) return databaseUnavailable(error.message);
  return NextResponse.json({ subscribed: true });
}

export async function DELETE(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const body = await request.json().catch(() => null) as { endpoint?: unknown } | null;
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  if (!endpoint) return NextResponse.json({ error: "endpoint is required" }, { status: 400 });

  const { error } = await supabaseAdmin
    .from("push_subscriptions")
    .delete()
    .eq("user_id", user.id)
    .eq("endpoint", endpoint);

  if (error) return databaseUnavailable(error.message);
  return NextResponse.json({ subscribed: false });
}
