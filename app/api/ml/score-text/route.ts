import { NextResponse } from "next/server";
import { MlConfigurationError, MlInferenceError } from "../../../../src/lib/ml/huggingface";
import { scoreCandidatesSemantically } from "../../../../src/lib/ml/semantic-scoring";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RequestBody = {
  query?: unknown;
  candidates?: unknown;
};

function isAuthorized(request: Request) {
  if (process.env.NODE_ENV !== "production") return true;
  const secret = process.env.ML_WORKER_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

function normalizeCandidates(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as { id?: unknown; text?: unknown };
      if (typeof candidate.id !== "string" || typeof candidate.text !== "string") return null;
      return { id: candidate.id, text: candidate.text };
    })
    .filter((candidate): candidate is { id: string; text: string } => Boolean(candidate));
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as RequestBody;
    const query = typeof body.query === "string" ? body.query.trim() : "";
    const candidates = normalizeCandidates(body.candidates);

    if (!query || !candidates.length) {
      return NextResponse.json(
        { success: false, error: "query and at least one candidate are required" },
        { status: 400 }
      );
    }

    const scores = await scoreCandidatesSemantically(query, candidates);
    return NextResponse.json({ success: true, model: "venue-embedding", scores });
  } catch (error) {
    if (error instanceof MlConfigurationError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 503 });
    }
    if (error instanceof MlInferenceError) {
      return NextResponse.json(
        { success: false, error: error.message, providerStatus: error.status },
        { status: 502 }
      );
    }
    return NextResponse.json({ success: false, error: "Unable to score candidates." }, { status: 500 });
  }
}
