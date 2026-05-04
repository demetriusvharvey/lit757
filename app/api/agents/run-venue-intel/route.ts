import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function getStatus(score: number) {
  if (score >= 85) return "Packed";
  if (score >= 70) return "Heating Up";
  if (score >= 55) return "Worth Watching";
  if (score >= 35) return "Monitored";
  return "Quiet";
}

function calculateGhostScore(venue: any) {
  let score = 25;

  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();

  const isNight = hour >= 20 || hour <= 2;
  const isWeekend = day === 5 || day === 6 || day === 0;

  const signals: any = {
    hasWebsite: Boolean(venue.website_url),
    hasTicketLink: Boolean(venue.ticket_url),
    hasInstagram: Boolean(venue.instagram_url),
    timeBoost: false,
    weekendBoost: false,
    signalStrength: "low",
  };

  // Basic links mean “we can monitor this venue,” not “it is packed.”
  if (venue.website_url) score += 5;
  if (venue.instagram_url) score += 5;

  // Ticket/event link is a stronger signal.
  if (venue.ticket_url) score += 18;

  // Time boosts should be small. Weekend/night alone should not create fake heat.
  if (isNight) {
    score += 5;
    signals.timeBoost = true;
  }

  if (isWeekend) {
    score += 6;
    signals.weekendBoost = true;
  }

  const hasStrongSignal = Boolean(venue.ticket_url);
  const hasMediumSignal = Boolean(venue.website_url || venue.instagram_url);

  if (hasStrongSignal && isWeekend) {
    signals.signalStrength = "medium";
  } else if (hasStrongSignal) {
    signals.signalStrength = "medium";
  } else if (hasMediumSignal) {
    signals.signalStrength = "low";
  }

  score = Math.min(100, Math.max(0, score));

  return {
    lit_score: score,
    status: getStatus(score),
    confidence: hasStrongSignal ? "Medium" : "Low",
    summary: `${venue.name} is currently ${getStatus(
      score
    )}. Ghost Data is monitoring public venue signals, but this is not confirmed crowd activity unless votes, updates, events, or ticket activity support it.`,
    signals_json: signals,
  };
}

export async function GET() {
  const { data: venues, error } = await supabase.from("venues").select("*");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const updates =
    venues?.map((venue) => {
      const intel = calculateGhostScore(venue);

      return {
        venue_id: venue.id,
        ...intel,
        updated_at: new Date().toISOString(),
      };
    }) || [];

  const { error: upsertError } = await supabase
    .from("venue_intelligence")
    .upsert(updates, { onConflict: "venue_id" });

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    updated: updates.length,
    results: updates,
  });
}