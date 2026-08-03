import { NextResponse } from "next/server";
import { callMlWorker } from "../../../../src/lib/ml/huggingface";
import {
  exceedsRequestRate,
  hasBearerSecret,
  readBoundedJson,
  requestClientKey,
  RequestGuardError,
} from "../../../../src/lib/server/request-guards";

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

export async function POST(request: Request) {
  if (!hasBearerSecret(request, process.env.ML_API_SECRET)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (exceedsRequestRate(`rank-images:${requestClientKey(request)}`, 5, 60_000)) {
    return NextResponse.json({ success: false, error: "Too many requests" }, { status: 429 });
  }
  if (!process.env.ML_WORKER_URL) {
    return NextResponse.json(
      { success: false, error: "ML_WORKER_URL is required for image intelligence." },
      { status: 503 }
    );
  }

  try {
    // readBoundedJson already rejects arrays and primitives, so this is an object.
    const body = await readBoundedJson(request, 32_768) as { venueName?: unknown; candidates?: unknown };
    const candidates = (Array.isArray(body.candidates) ? body.candidates : [])
      .filter((candidate): candidate is ImageCandidate => {
        if (!candidate || typeof candidate !== "object") return false;
        const url = (candidate as ImageCandidate).url;
        return typeof url === "string" && url.startsWith("https://") && url.length <= 2_048;
      })
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
      } catch {
        return { ...candidate, accepted: false, relevance: 0, aesthetic: null, score: 0, error: "Inference unavailable" };
      }
    }));

    const ranked = results.sort((left, right) => right.score - left.score);
    return NextResponse.json({
      success: true,
      venueName: typeof body.venueName === "string" ? body.venueName.slice(0, 200) : null,
      winner: ranked.find((item) => item.accepted) || null,
      candidates: ranked,
    });
  } catch (error) {
    const status = error instanceof RequestGuardError ? error.status : 500;
    const message = error instanceof RequestGuardError ? error.message : "Unable to rank images";
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
