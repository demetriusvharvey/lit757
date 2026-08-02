import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getRequestUser } from "../../../../src/lib/server-auth";
import { meteredProviderCallsEnabled } from "../../../../src/lib/metered-providers";

const OWNER_EMAIL = "demetriusvharvey@gmail.com";

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = getSupabaseAdmin();

  const displayName = String(
    user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      user.email?.split("@")[0] ||
      "New member"
  );
  const provider = String(user.app_metadata?.provider || "email");

  const { data: existing } = await admin
    .from("member_profiles")
    .select("signup_notified_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing?.signup_notified_at) {
    return NextResponse.json({ success: true, alreadyNotified: true });
  }

  await admin.from("member_profiles").upsert(
    {
      user_id: user.id,
      display_name: displayName,
      points: 25,
      reputation_level: "New Member",
    },
    { onConflict: "user_id" }
  );

  if (!meteredProviderCallsEnabled("resend")) {
    return NextResponse.json({ success: true, emailSkipped: true, reason: "zero_cost_policy" });
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        error: "RESEND_API_KEY is not configured",
      },
      { status: 503 }
    );
  }

  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.SIGNUP_EMAIL_FROM || "LIT757 <onboarding@resend.dev>",
      to: [OWNER_EMAIL],
      subject: `New LIT757 member: ${displayName}`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.5"><h2>New LIT757 member</h2><p><strong>Name:</strong> ${escapeHtml(displayName)}</p><p><strong>Email:</strong> ${escapeHtml(user.email || "Not provided")}</p><p><strong>Signup method:</strong> ${escapeHtml(provider)}</p><p><strong>Joined:</strong> ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })} ET</p></div>`,
    }),
  });

  if (!sent.ok) {
    return NextResponse.json({ error: "Could not send signup email" }, { status: 502 });
  }

  await admin
    .from("member_profiles")
    .update({ signup_notified_at: new Date().toISOString() })
    .eq("user_id", user.id);

  return NextResponse.json({ success: true });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] || character);
}
