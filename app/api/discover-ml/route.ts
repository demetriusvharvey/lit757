import { NextResponse } from "next/server";
import { callMlWorker, classifyVibes } from "../../../src/lib/ml/huggingface";
import { scoreCandidatesSemantically } from "../../../src/lib/ml/semantic-scoring";
import { clientAddress, exceedsRateLimit } from "../../../src/lib/ml/api-security";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type DiscoveryVenue = {
  id: string;
  name: string;
  city: string;
  type: string;
  category: string;
  kind: string;
  rating: number | null;
  reason: string;
  timing: string;
  label: string;
  confidence: string;
  score: number;
  interestTags: string[];
  event: { name: string; timeLabel: string } | null;
  [key: string]: unknown;
};

type DiscoveryPayload = {
  success: boolean;
  context?: Record<string, unknown>;
  picks?: DiscoveryVenue[];
  venues?: DiscoveryVenue[];
  [key: string]: unknown;
};

type RerankResponse = {
  scores?: Array<{ id: string; score: number }>;
};

const VIBE_LABELS = [
  "date night",
  "family friendly",
  "high energy",
  "quiet and relaxed",
  "live music",
  "outdoors",
  "budget friendly",
  "food focused",
  "late night",
  "sports and games",
  "arts and culture",
  "rainy day",
];

function candidateText(venue: DiscoveryVenue) {
  return [
    venue.name,
    venue.city,
    venue.type,
    venue.category,
    venue.kind,
    venue.reason,
    venue.timing,
    venue.interestTags?.join(" "),
    venue.event?.name,
    venue.event?.timeLabel,
  ]
    .filter(Boolean)
    .join(". ");
}

function cleanQuery(value: string | null) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 240);
}

function normalizeSemanticScore(score: number) {
  return Math.max(0, Math.min(1, (score + 1) / 2));
}

function normalizeCrossEncoderScore(score: number) {
  return 1 / (1 + Math.exp(-score));
}

function matchLabel(percent: number, vibe?: string) {
  if (percent >= 90) return vibe ? `${percent}% ${vibe}` : `${percent}% match`;
  if (percent >= 78) return vibe ? `Strong ${vibe}` : "Strong match";
  return vibe ? `Fits ${vibe}` : "Good match";
}

function matchReason(venue: DiscoveryVenue, percent: number, vibe?: string) {
  const pieces = [`AI matched this ${percent}% to what you asked for`];
  if (vibe) pieces.push(`with a ${vibe} feel`);
  if (venue.event?.name) pieces.push(`${venue.event.name} is also on the schedule`);
  else if (venue.timing) pieces.push(venue.timing.toLowerCase());
  return `${pieces.join(", ")}.`;
}

async function enhanceSearch(payload: DiscoveryPayload, query: string) {
  const venues = Array.isArray(payload.venues) ? payload.venues.slice(0, 50) : [];
  if (!venues.length) return payload;

  const candidates = venues.map((venue) => ({ id: venue.id, text: candidateText(venue) }));
  const semanticScores = await scoreCandidatesSemantically(query, candidates);
  const semanticMap = new Map(semanticScores.map((item) => [item.id, normalizeSemanticScore(item.score)]));

  let rerankerMap = new Map<string, number>();
  if (process.env.ML_WORKER_URL) {
    try {
      const reranked = await callMlWorker<RerankResponse>("venue-reranker", {
        query,
        candidates: candidates.slice(0, 30),
      }, 25_000);
      rerankerMap = new Map(
        (reranked.scores || []).map((item) => [item.id, normalizeCrossEncoderScore(item.score)])
      );
    } catch (error) {
      console.error("ML reranker unavailable; semantic ranking remains active", error);
    }
  }

  let topVibe: string | undefined;
  try {
    const vibes = await classifyVibes(query, VIBE_LABELS);
    topVibe = vibes
      .filter((item) => item.score >= 0.35)
      .sort((left, right) => right.score - left.score)[0]?.label;
  } catch (error) {
    console.error("Vibe classification unavailable", error);
  }

  const enhanced = venues
    .map((venue) => {
      const semantic = semanticMap.get(venue.id) || 0;
      const rerank = rerankerMap.get(venue.id);
      const liveQuality = Math.max(0, Math.min(1, Number(venue.score || 0) / 100));
      const combined = rerank === undefined
        ? semantic * 0.72 + liveQuality * 0.28
        : semantic * 0.42 + rerank * 0.38 + liveQuality * 0.2;
      const percent = Math.round(Math.max(55, Math.min(99, combined * 100)));

      return {
        ...venue,
        score: Math.round(Math.max(Number(venue.score || 0), combined * 100)),
        label: matchLabel(percent, topVibe),
        confidence: `AI match ${percent}%`,
        reason: matchReason(venue, percent, topVibe),
        interestTags: Array.from(new Set([...(venue.interestTags || []), ...(topVibe ? [topVibe] : [])])),
        mlMatch: {
          percent,
          semantic: Number(semantic.toFixed(3)),
          reranked: rerank === undefined ? null : Number(rerank.toFixed(3)),
          vibe: topVibe || null,
        },
      };
    })
    .sort((left, right) => {
      const leftMatch = Number((left.mlMatch as { percent: number }).percent);
      const rightMatch = Number((right.mlMatch as { percent: number }).percent);
      return rightMatch - leftMatch || Number(right.score) - Number(left.score);
    });

  return {
    ...payload,
    context: {
      ...(payload.context || {}),
      intelligence: {
        active: true,
        query,
        vibe: topVibe || null,
        method: rerankerMap.size ? "semantic + cross-encoder + live signals" : "semantic + live signals",
      },
    },
    picks: enhanced.slice(0, 3),
    venues: enhanced,
  };
}

export async function GET(request: Request) {
  const incoming = new URL(request.url);
  const legacyUrl = new URL("/api/discover", incoming.origin);
  incoming.searchParams.forEach((value, key) => legacyUrl.searchParams.set(key, value));
  legacyUrl.searchParams.set("__ml_bypass", "1");

  const authorization = request.headers.get("authorization");
  const legacyResponse = await fetch(legacyUrl, {
    cache: "no-store",
    headers: authorization ? { Authorization: authorization } : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await legacyResponse.json() as DiscoveryPayload;
  const query = cleanQuery(incoming.searchParams.get("q"));

  const rateLimited = exceedsRateLimit(`discover-ml:${clientAddress(request)}`, 12, 60_000);
  if (!legacyResponse.ok || !payload.success || !query || rateLimited || !process.env.HUGGINGFACE_API_TOKEN) {
    return NextResponse.json(payload, {
      status: legacyResponse.status,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  try {
    const enhanced = await enhanceSearch(payload, query);
    return NextResponse.json(enhanced, {
      status: legacyResponse.status,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("ML discovery enhancement failed; returning deterministic ranking", error);
    return NextResponse.json(payload, {
      status: legacyResponse.status,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}
