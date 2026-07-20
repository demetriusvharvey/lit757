import webpush from "web-push";
import { getSupabaseAdmin, jsonError, requireAuthenticatedUser } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUser(request);
    const publicKey = process.env.VAPID_PUBLIC_KEY || "";
    const privateKey = process.env.VAPID_PRIVATE_KEY || "";
    if (!publicKey || !privateKey) {
      return Response.json({ error: "VAPID keys are not configured" }, { status: 503 });
    }

    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "mailto:hello@lit757.app",
      publicKey,
      privateKey,
    );

    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("push_subscriptions")
      .select("id,endpoint,p256dh,auth")
      .eq("user_id", user.id)
      .eq("enabled", true);
    if (error) throw error;

    let sent = 0;
    let expired = 0;
    const payload = JSON.stringify({
      title: "🔥 Your Buzz alerts are connected",
      body: "LIT757 can now tell you when a saved place starts heating up.",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: "lit757-test-alert",
      url: "/",
    });

    for (const subscription of data || []) {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, payload, { TTL: 300, urgency: "high" });
        sent += 1;
      } catch (sendError) {
        const statusCode = typeof sendError === "object" && sendError && "statusCode" in sendError
          ? Number((sendError as { statusCode?: number }).statusCode)
          : 0;
        if (statusCode === 404 || statusCode === 410) {
          await admin.from("push_subscriptions").delete().eq("id", subscription.id);
          expired += 1;
        }
      }
    }

    return Response.json({ success: sent > 0, sent, expired });
  } catch (error) {
    return jsonError(error);
  }
}
