import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getRequestUser } from "../../../../src/lib/server-auth";
import { guardErrorResponse, readBoundedJson } from "../../../../src/lib/server/request-guards";

export const dynamic = "force-dynamic";

const supabaseAdmin = getSupabaseAdmin();

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

  let body: Record<string, unknown>;
  try {
    body = await readBoundedJson(request, 4_096);
  } catch (error) {
    return guardErrorResponse(error);
  }
  const venueId = typeof body.venueId === "string" ? body.venueId.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(venueId)) {
    return NextResponse.json({ error: "A valid venueId is required." }, { status: 400 });
  }

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
