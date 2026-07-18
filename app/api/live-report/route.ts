import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
      venue_id,
      report_type,
      report_value,
      venue_category,
      device_id,
    } = body;

    if (!venue_id || !report_type || !report_value) {
      return NextResponse.json(
        { error: "venue_id, report_type, and report_value are required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("venue_live_reports")
      .insert({
        venue_id,
        report_type,
        report_value,
        venue_category: venue_category || null,
        device_id: device_id || null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      report: data,
    });
  } catch {
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 500 }
    );
  }
}
