import { NextResponse } from "next/server";
import { callMlWorker, classifyVibes } from "../../../src/lib/ml/huggingface";
import { scoreCandidatesSemantically } from "../../../src/lib/ml/semantic-scoring";
import { exceedsRequestRate, requestClientKey } from "../../../src/lib/server/request-guards";
import { INTERNAL_DISCOVERY_HEADER } from "../../../src/lib/ml/discovery-routing";
import {
  buildMlMatch,
  byRelevanceThenActivity,
  liveQualityOf,
  STRONG_MATCH_PERCENT,
} from "../../../src/lib/ml/discovery-relevance";

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
      const mlMatch = buildMlMatch({
        semantic: semanticMap.get(venue.id) || 0,
        rerank: rerankerMap.get(venue.id),
        liveQuality: liveQualityOf(venue.score),
      }, topVibe);
      const strong = mlMatch.percent >= STRONG_MATCH_PERCENT;

      // `score`, `confidence` and `heat` are canonical activity truth and are
      // deliberately passed through untouched. Search relevance decides the
      // order results appear in, never how busy a venue is reported to be.
      return {
        ...venue,
        label: strong ? matchLabel(mlMatch.percent, topVibe) : venue.label,
        reason: strong ? matchReason(venue, mlMatch.percent, topVibe) : venue.reason,
        interestTags: Array.from(new Set([...(venue.interestTags || []), ...(topVibe ? [topVibe] : [])])),
        mlMatch,
      };
    })
    .sort(byRelevanceThenActivity);

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
  const query = cleanQuery(incoming.searchParams.get("q"));

  // Only requests that would actually spend ML budget consume the limiter, so a
  // flood of unqueried discovery traffic cannot starve real searches.
  const couldEnhance = Boolean(query) && Boolean(process.env.HUGGINGFACE_API_TOKEN);
  const rateLimited = couldEnhance
    && exceedsRequestRate(`discover-ml:${requestClientKey(request)}`, 12, 60_000);

  const legacyUrl = new URL("/api/discover", incoming.origin);
  incoming.searchParams.forEach((value, key) => legacyUrl.searchParams.set(key, value));

  const authorization = request.headers.get("authorization");
  const legacyResponse = await fetch(legacyUrl, {
    cache: "no-store",
    // An internal header rather than a query parameter: it stays out of URLs,
    // logs, referrers and cache keys.
    headers: {
      [INTERNAL_DISCOVERY_HEADER]: "1",
      ...(authorization ? { Authorization: authorization } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await legacyResponse.json() as DiscoveryPayload;

  if (!legacyResponse.ok || !payload.success || !couldEnhance || rateLimited) {
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
