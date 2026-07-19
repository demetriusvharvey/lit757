import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestUser } from "../../../../src/lib/server-auth";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from("venue_alerts")
    .select("venue_id,enabled,last_notified_at")
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: "Could not load alerts." }, { status: 500 });
  return NextResponse.json({ alerts: data || [] });
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const body = (await request.json()) as { venueId?: string; enabled?: boolean };
  const venueId = body.venueId?.trim();
  if (!venueId) return NextResponse.json({ error: "venueId is required." }, { status: 400 });

  const { error } = await supabaseAdmin.from("venue_alerts").upsert(
    {
      user_id: user.id,
      venue_id: venueId,
      enabled: body.enabled !== false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,venue_id" }
  );

  if (error) return NextResponse.json({ error: "Could not save alert." }, { status: 500 });
  return NextResponse.json({ venueId, enabled: body.enabled !== false });
}
