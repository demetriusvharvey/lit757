import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getRequestUser } from "../../../../src/lib/server-auth";

export const dynamic = "force-dynamic";

const OWNER_EMAIL = "demetriusvharvey@gmail.com";
const supabaseAdmin = getSupabaseAdmin();

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user || user.email?.toLowerCase() !== OWNER_EMAIL) {
    return NextResponse.json({ error: "Owner access required." }, { status: 403 });
  }

  try {
    const now = Date.now();
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: usersData, error: usersError } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    if (usersError) throw usersError;
    const users = usersData.users || [];

    const [activity, engagement] = await Promise.all([
      supabaseAdmin.from("activity_reports").select("user_id,venue_id,created_at,status").gte("created_at", weekAgo),
      supabaseAdmin.from("event_engagement").select("user_id,event_id,status,updated_at").gte("updated_at", weekAgo),
    ]);

    const topVenueCounts = new Map<string, number>();
    for (const row of activity.data || []) {
      topVenueCounts.set(row.venue_id, (topVenueCounts.get(row.venue_id) || 0) + 1);
    }

    return NextResponse.json({
      users: {
        total: users.length,
        today: users.filter((item) => item.created_at >= dayAgo).length,
        thisWeek: users.filter((item) => item.created_at >= weekAgo).length,
      },
      contributions: {
        thisWeek: activity.data?.length || 0,
        uniqueContributors: new Set((activity.data || []).map((row) => row.user_id)).size,
      },
      events: {
        interested: (engagement.data || []).filter((row) => row.status === "interested").length,
        going: (engagement.data || []).filter((row) => row.status === "going").length,
      },
      topVenueIds: [...topVenueCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([venueId, reports]) => ({ venueId, reports })),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("admin metrics failed", error);
    return NextResponse.json({ error: "Could not load owner metrics." }, { status: 500 });
  }
}
