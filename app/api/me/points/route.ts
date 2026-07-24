import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getRequestUser } from "../../../../src/lib/server-auth";

export const dynamic = "force-dynamic";

const supabaseAdmin = getSupabaseAdmin();

function providerFor(user: { app_metadata?: Record<string, unknown> }) {
  const provider = user.app_metadata?.provider;
  return typeof provider === "string" ? provider : "email";
}

async function bootstrapMember(user: Awaited<ReturnType<typeof getRequestUser>>) {
  if (!user) return;

  await supabaseAdmin.from("member_profiles").upsert(
    {
      user_id: user.id,
      display_name:
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.email?.split("@")[0] ||
        "Member",
    },
    { onConflict: "user_id", ignoreDuplicates: false }
  );

  await supabaseAdmin.from("points_ledger").upsert(
    {
      user_id: user.id,
      action: "account_created",
      points: 25,
      reference_key: "signup",
      metadata: { provider: providerFor(user) },
    },
    { onConflict: "user_id,action,reference_key", ignoreDuplicates: true }
  );

  await supabaseAdmin.rpc("refresh_member_points", { target_user: user.id });

  const { data: notification } = await supabaseAdmin
    .from("owner_signup_notifications")
    .select("user_id,notified_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!notification) {
    await supabaseAdmin.from("owner_signup_notifications").insert({
      user_id: user.id,
      email: user.email || null,
      provider: providerFor(user),
    });

    if (process.env.OWNER_SIGNUP_WEBHOOK_URL) {
      try {
        const response = await fetch(process.env.OWNER_SIGNUP_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "lit757.signup",
            userId: user.id,
            email: user.email || null,
            displayName:
              user.user_metadata?.full_name ||
              user.user_metadata?.name ||
              user.email?.split("@")[0] ||
              "Member",
            provider: providerFor(user),
            createdAt: user.created_at,
          }),
        });
        if (response.ok) {
          await supabaseAdmin
            .from("owner_signup_notifications")
            .update({ notified_at: new Date().toISOString() })
            .eq("user_id", user.id);
        }
      } catch (error) {
        console.error("Owner signup webhook failed", error);
      }
    }
  }
}

export async function GET(request: Request) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await bootstrapMember(user);

  const [{ data: profile, error: profileError }, { data: ledger, error: ledgerError }] =
    await Promise.all([
      supabaseAdmin
        .from("member_profiles")
        .select("points,reputation_level,display_name,home_city")
        .eq("user_id", user.id)
        .single(),
      supabaseAdmin
        .from("points_ledger")
        .select("id,action,points,metadata,created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(12),
    ]);

  if (profileError || ledgerError) {
    return NextResponse.json(
      { error: profileError?.message || ledgerError?.message || "Points unavailable" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    points: profile?.points || 0,
    level: profile?.reputation_level || "New Member",
    displayName: profile?.display_name || null,
    homeCity: profile?.home_city || null,
    recent: ledger || [],
    rewardsMessage: "Earn Points now. Member rewards are coming.",
  });
}
