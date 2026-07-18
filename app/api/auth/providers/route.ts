import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      cache: "no-store",
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
    });
    const settings = await response.json();

    return NextResponse.json(
      {
        google: Boolean(settings?.external?.google),
        apple: Boolean(settings?.external?.apple),
        email: settings?.external?.email !== false,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch {
    return NextResponse.json({ google: false, apple: false, email: true });
  }
}
