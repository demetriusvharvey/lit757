import { NextResponse } from "next/server";
import { supabase } from "../../../src/lib/supabase";

type Vibe = "lit" | "decent" | "dead" | "line_crazy";

const VIBE_SCORE: Record<Vibe, number> = {
  lit: 4,
  decent: 2,
  dead: -3,
  line_crazy: 2,
};

function voteWeight(createdAt?: string | null) {
  if (!createdAt) return 0;

  const minutes = (Date.now() - new Date(createdAt).getTime()) / 60000;
  if (minutes <= 30) return 1;
  if (minutes <= 60) return 0.7;
  if (minutes <= 90) return 0.5;
  return 0;
}

function getStatus(score: number, voteCount: number) {
  if (score >= 6) return "lit";
  if (score >= 2) return "decent";
  if (voteCount >= 1 && score >= 0) return "decent";
  return "dead";
}

export async function GET() {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { summary: "OpenAI key is not configured." },
      { status: 500 }
    );
  }

  const { data: venuesData, error: venuesError } = await supabase
    .from("venues")
    .select("id,name,city,music_genre");

  if (venuesError) {
    return NextResponse.json(
      { summary: "Unable to load venue data." },
      { status: 500 }
    );
  }

  const since = new Date(Date.now() - 90 * 60 * 1000).toISOString();
  const { data: votesData, error: votesError } = await supabase
    .from("votes")
    .select("venue_id,vibe,created_at")
    .gte("created_at", since);

  if (votesError) {
    return NextResponse.json(
      { summary: "Unable to load vote data." },
      { status: 500 }
    );
  }

  const venueScores = new Map<string, { voteCount: number; score: number }>();

  (votesData || []).forEach((vote) => {
    if (!vote.venue_id) return;
    const existing = venueScores.get(vote.venue_id) || { voteCount: 0, score: 0 };
    const weight = voteWeight(vote.created_at || null);
    existing.voteCount += 1;
    existing.score += VIBE_SCORE[vote.vibe as Vibe] * weight;
    venueScores.set(vote.venue_id, existing);
  });

  const venues = (venuesData || [])
    .map((venue) => {
      const meta = venueScores.get(venue.id) || { voteCount: 0, score: 0 };
      return {
        name: venue.name,
        city: venue.city,
        music_genre: venue.music_genre,
        voteCount: meta.voteCount,
        score: Number(meta.score.toFixed(1)),
        status: getStatus(meta.score, meta.voteCount),
      };
    })
    .filter((venue) => venue.voteCount > 0);

  if (venues.length === 0) {
    return NextResponse.json({ summary: "No active nightlife signals right now." });
  }

  const prompt = `Write a quick nightlife tip in 1-2 punchy sentences. No filler. No long explanations. Make it feel like a fast hype alert.

Venue signals:
${venues
    .map(
      (venue) =>
        `${venue.name} in ${venue.city} is ${venue.status} with ${venue.voteCount} votes and ${venue.music_genre || "mixed music"}.`
    )
    .join("\n")}

Return only the summary sentence.`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a nightlife copywriter writing short, hype, punchy nightlife tips.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 50,
      temperature: 0.95,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return NextResponse.json(
      { summary: "Unable to generate nightlife summary." },
      { status: 500 }
    );
  }

  const data = await response.json();
  const summary =
    data?.choices?.[0]?.message?.content?.trim() ||
    "The nightlife scene is warming up across the 757.";

  return NextResponse.json({ summary });
}
