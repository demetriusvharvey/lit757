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
      { recommendation: "OpenAI key is not configured.", venueName: "" },
      { status: 500 }
    );
  }

  const { data: venuesData, error: venuesError } = await supabase
    .from("venues")
    .select("id,name,city,type,music_genre,age_limit,cover");

  if (venuesError) {
    return NextResponse.json(
      { recommendation: "Unable to load venue data.", venueName: "" },
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
      { recommendation: "Unable to load vote data.", venueName: "" },
      { status: 500 }
    );
  }

  const venueScores = new Map<
    string,
    { voteCount: number; score: number; lastUpdated: string | null }
  >();

  (votesData || []).forEach((vote) => {
    if (!vote.venue_id) return;
    const existing =
      venueScores.get(vote.venue_id) ||
      ({ voteCount: 0, score: 0, lastUpdated: null } as {
        voteCount: number;
        score: number;
        lastUpdated: string | null;
      });
    const weight = voteWeight(vote.created_at || null);
    existing.voteCount += 1;
    existing.score += VIBE_SCORE[vote.vibe as Vibe] * weight;
    if (vote.created_at) {
      const currentTime = new Date(vote.created_at).toISOString();
      existing.lastUpdated = existing.lastUpdated
        ? existing.lastUpdated > currentTime
          ? existing.lastUpdated
          : currentTime
        : currentTime;
    }
    venueScores.set(vote.venue_id, existing);
  });

  const venues = (venuesData || [])
    .map((venue) => {
      const meta =
        venueScores.get(venue.id) ||
        ({ voteCount: 0, score: 0, lastUpdated: null } as {
          voteCount: number;
          score: number;
          lastUpdated: string | null;
        });
      return {
        name: venue.name,
        city: venue.city,
        type: venue.type,
        music_genre: venue.music_genre,
        age_limit: venue.age_limit,
        cover: venue.cover,
        voteCount: meta.voteCount,
        score: Number(meta.score.toFixed(1)),
        status: getStatus(meta.score, meta.voteCount),
        lastUpdated: meta.lastUpdated,
      };
    })
    .filter((venue) => venue.voteCount > 0);

  if (venues.length === 0) {
    return NextResponse.json({
      recommendation: "No strong nightlife signals right now. Check back soon.",
      venueName: "",
    });
  }

  const sortedVenues = [...venues].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.voteCount - a.voteCount;
  });

  const topVenue = sortedVenues[0];

  const prompt = `You are a local nightlife friend. Pick the single best spot from these live signals and recommend it in 1-2 short casual sentences. Mention the venue and why. Keep it direct and friendly. If the data feels weak, say that clearly and suggest the safest choice.

Venue signals:
${venues
    .map(
      (venue) =>
        `${venue.name} in ${venue.city} is ${venue.status} with ${venue.voteCount} votes, ${venue.music_genre || "mixed music"}, cover ${venue.cover || "varies"}, age ${venue.age_limit || "any"}.`
    )
    .join("\n")}

Return only the recommendation text.`;

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
          content: "You are a nightlife copywriter writing short direct recommendations.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 70,
      temperature: 0.95,
    }),
  });

  if (!response.ok) {
    return NextResponse.json({
      recommendation: "Unable to generate a recommendation right now.",
      venueName: topVenue.name,
    });
  }

  const data = await response.json();
  const recommendation =
    data?.choices?.[0]?.message?.content?.trim() ||
    `Go to ${topVenue.name} — it looks like the best live move tonight.`;

  return NextResponse.json({ recommendation, venueName: topVenue.name });
}
