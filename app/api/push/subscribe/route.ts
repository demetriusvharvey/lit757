import { getSupabaseAdmin, jsonError, requireAuthenticatedUser } from "@/lib/supabase-admin";

type PushBody = {
  endpoint?: string;
  expirationTime?: number | null;
  keys?: { p256dh?: string; auth?: string };
};

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const admin = getSupabaseAdmin();
    const body = (await request.json()) as PushBody;

    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
      return Response.json({ error: "Invalid push subscription" }, { status: 400 });
    }

    const { error } = await admin.from("push_subscriptions").upsert({
      user_id: user.id,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      expiration_time: body.expirationTime || null,
      user_agent: request.headers.get("user-agent"),
      enabled: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "endpoint" });

    if (error) throw error;
    return Response.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const admin = getSupabaseAdmin();
    const body = (await request.json()) as { endpoint?: string };
    if (!body.endpoint) return Response.json({ error: "Missing endpoint" }, { status: 400 });

    const { error } = await admin
      .from("push_subscriptions")
      .delete()
      .eq("user_id", user.id)
      .eq("endpoint", body.endpoint);
    if (error) throw error;

    return Response.json({ success: true });
  } catch (error) {
    return jsonError(error);
  }
}
