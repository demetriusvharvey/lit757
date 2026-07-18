import webpush, { type PushSubscription, WebPushError } from "web-push";

export type PushPayload = {
  title: string;
  body: string;
  tag: string;
  url: string;
};

export function getPushConfiguration() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || "";
  const subject = process.env.VAPID_SUBJECT?.trim() || "https://lit757.vercel.app";

  return {
    configured: Boolean(publicKey && privateKey),
    publicKey,
    privateKey,
    subject,
  };
}

export async function sendWebPush(subscription: PushSubscription, payload: PushPayload) {
  const configuration = getPushConfiguration();
  if (!configuration.configured) throw new Error("Web Push is not configured");

  return webpush.sendNotification(subscription, JSON.stringify(payload), {
    TTL: 60 * 60,
    urgency: "high",
    topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 32),
    vapidDetails: {
      subject: configuration.subject,
      publicKey: configuration.publicKey,
      privateKey: configuration.privateKey,
    },
  });
}

export function pushStatusCode(error: unknown) {
  return error instanceof WebPushError ? error.statusCode : null;
}
