import { NextResponse } from "next/server";
import { callMlWorker } from "../../../../src/lib/ml/huggingface";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ImageCandidate = {
  url: string;
  source?: string;
};

type LabelScore = { label: string; score: number };
type RelevanceResponse = { labels?: LabelScore[] };
type AestheticResponse = { score?: number };

const GOOD_LABELS = new Set([
  "venue exterior",
  "venue interior",
  "food or drink",
  "people enjoying an event",
]);
const BAD_LABELS = new Set(["logo", "map screenshot", "unrelated stock photo"]);

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET || process.env.ML_WORKER_SECRET;
  if (!expected) return process.env.NODE_ENV === "development";
  return request.headers.get("authorization") === `Bearer ${expected}`;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.ML_WORKER_URL) {
    return NextResponse.json(
      { success: false, error: "ML_WORKER_URL is required for image intelligence." },
      { status: 503 }
    );
  }

  const body = await request.json() as {
    venueName?: string;
    candidates?: ImageCandidate[];
  };
  const candidates = (body.candidates || [])
    .filter((candidate) => candidate?.url?.startsWith("https://"))
    .slice(0, 8);

  if (!candidates.length) {
    return NextResponse.json({ success: false, error: "At least one HTTPS image URL is required." }, { status: 400 });
  }

  const results = await Promise.all(candidates.map(async (candidate) => {
    try {
      const relevance = await callMlWorker<RelevanceResponse>("image-relevance", {
        image_url: candidate.url,
      }, 45_000);
      const labels = relevance.labels || [];
      const positive = labels
        .filter((item) => GOOD_LABELS.has(item.label))
        .reduce((best, item) => Math.max(best, item.score), 0);
      const negative = labels
        .filter((item) => BAD_LABELS.has(item.label))
        .reduce((best, item) => Math.max(best, item.score), 0);

      if (negative > positive || positive < 0.25) {
        return { ...candidate, accepted: false, relevance: positive, aesthetic: null, score: 0, labels };
      }

      const aesthetic = await callMlWorker<AestheticResponse>("image-aesthetic-score", {
        image_url: candidate.url,
      }, 45_000);
      const aestheticScore = Math.max(0, Math.min(10, Number(aesthetic.score || 0)));
      const score = positive * 0.58 + (aestheticScore / 10) * 0.42;
      return {
        ...candidate,
        accepted: true,
        relevance: Number(positive.toFixed(4)),
        aesthetic: Number(aestheticScore.toFixed(2)),
        score: Number(score.toFixed(4)),
        labels,
      };
    } catch (error) {
      return { ...candidate, accepted: false, relevance: 0, aesthetic: null, score: 0, error: String(error) };
    }
  }));

  const ranked = results.sort((left, right) => right.score - left.score);
  return NextResponse.json({
    success: true,
    venueName: body.venueName || null,
    winner: ranked.find((item) => item.accepted) || null,
    candidates: ranked,
  });
}
