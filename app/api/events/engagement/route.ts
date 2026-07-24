import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestUser } from "../../../../src/lib/server-auth";
import {
  guardErrorResponse,
  readBoundedJson,
  RequestGuardError,
} from "../../../../src/lib/server/request-guards";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

async function getSummary(eventId: string, userId?: string) {
  const [{ data: rows, error }, { data: event }] = await Promise.all([
    supabaseAdmin.from("event_engagement").select("status,user_id").eq("event_id", eventId),
    supabaseAdmin
      .from("events")
      .select("capacity,tickets_sold,ticket_status,ticket_sales_source,ticket_sales_verified,ticket_sales_updated_at")
      .eq("id", eventId)
      .maybeSingle(),
  ]);

  if (error) throw error;
  const interested = (rows || []).filter((row) => row.status === "interested").length;
  const going = (rows || []).filter((row) => row.status === "going").length;
  const mine = userId ? (rows || []).find((row) => row.user_id === userId)?.status || null : null;

  return {
    eventId,
    interested,
    going,
    mine,
    ticketing: event
      ? {
          capacity: event.capacity,
          ticketsSold: event.tickets_sold,
          status: event.ticket_status,
          source: event.ticket_sales_source,
          verified: Boolean(event.ticket_sales_verified),
          updatedAt: event.ticket_sales_updated_at,
        }
      : null,
  };
}

export async function GET(request: Request) {
  const eventId = new URL(request.url).searchParams.get("eventId")?.trim();
  if (!eventId) return NextResponse.json({ error: "eventId is required" }, { status: 400 });

  try {
    const user = await getRequestUser(request);
    return NextResponse.json(await getSummary(eventId, user?.id));
  } catch (error) {
    console.error("event engagement GET failed", error);
    return NextResponse.json({ error: "Could not load event activity." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to update your event plans." }, { status: 401 });

  try {
    const body = await readBoundedJson(request, 4_096);
    const eventId = typeof body.eventId === "string" ? body.eventId.trim().slice(0, 128) : "";
    if (!eventId) return NextResponse.json({ error: "eventId is required" }, { status: 400 });
    if (body.status !== null && body.status !== "interested" && body.status !== "going") {
      return NextResponse.json({ error: "Invalid event status" }, { status: 400 });
    }

    if (body.status === null) {
      const { error } = await supabaseAdmin
        .from("event_engagement")
        .delete()
        .eq("event_id", eventId)
        .eq("user_id", user.id);
      if (error) throw error;
    } else {
      const { error } = await supabaseAdmin.from("event_engagement").upsert(
        {
          event_id: eventId,
          user_id: user.id,
          status: body.status,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "event_id,user_id" }
      );
      if (error) throw error;
    }

    return NextResponse.json(await getSummary(eventId, user.id));
  } catch (error) {
    if (error instanceof RequestGuardError) return guardErrorResponse(error);
    console.error("event engagement POST failed", error);
    return NextResponse.json({ error: "Could not save your event plans." }, { status: 500 });
  }
}
