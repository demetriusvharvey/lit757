import { getSupabaseAdmin, jsonError, requireAuthenticatedUser } from "@/lib/supabase-admin";
import { guardErrorResponse, readBoundedJson } from "@/src/lib/server/request-guards";

type PushBody = {
  endpoint?: string;
  expirationTime?: number | null;
  keys?: { p256dh?: string; auth?: string };
};

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const admin = getSupabaseAdmin();
    const body = await readBoundedJson(request, 16_384) as PushBody;

    if (!body.endpoint || body.endpoint.length > 4_096
      || !body.keys?.p256dh || body.keys.p256dh.length > 1_024
      || !body.keys?.auth || body.keys.auth.length > 512) {
      return Response.json({ error: "Invalid push subscription" }, { status: 400 });
    }

    // The service-role client bypasses RLS, so ownership must be checked before
    // an endpoint conflict can update an existing subscription.
    const { data: existing, error: existingError } = await admin
      .from("push_subscriptions")
      .select("user_id")
      .eq("endpoint", body.endpoint)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing && existing.user_id !== user.id) {
      return Response.json({ error: "Push endpoint already belongs to another account" }, { status: 409 });
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
    if (error instanceof Error && error.name === "RequestGuardError") return guardErrorResponse(error);
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const admin = getSupabaseAdmin();
    const body = await readBoundedJson(request, 8_192) as { endpoint?: string };
    if (!body.endpoint || body.endpoint.length > 4_096) {
      return Response.json({ error: "Missing or invalid endpoint" }, { status: 400 });
    }

    const { error } = await admin
      .from("push_subscriptions")
      .delete()
      .eq("user_id", user.id)
      .eq("endpoint", body.endpoint);
    if (error) throw error;

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.name === "RequestGuardError") return guardErrorResponse(error);
    return jsonError(error);
  }
}
