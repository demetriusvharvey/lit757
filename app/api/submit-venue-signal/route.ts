import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const { venue_id, vibe_type, comment, nickname } = body;

    if (!venue_id || !vibe_type) {
      return NextResponse.json(
        { success: false, error: "Missing venue_id or vibe_type" },
        { status: 400 }
      );
    }

    const allowedVibes = [
      "active",
      "good",
      "quiet",
      "packed",
      "line",
      "expensive",
      "cover",
      "music",
    ];

    if (!allowedVibes.includes(vibe_type)) {
      return NextResponse.json(
        { success: false, error: "Invalid vibe_type" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("venue_signals")
      .insert({
        venue_id,
        vibe_type,
        comment: comment || null,
        nickname: nickname || null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      signal: data,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}