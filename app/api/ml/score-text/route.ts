import { NextResponse } from "next/server";
import { MlConfigurationError, MlInferenceError } from "../../../../src/lib/ml/huggingface";
import { scoreCandidatesSemantically } from "../../../../src/lib/ml/semantic-scoring";
import {
  exceedsRequestRate,
  hasBearerSecret,
  readBoundedJson,
  requestClientKey,
  RequestGuardError,
} from "../../../../src/lib/server/request-guards";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RequestBody = {
  query?: unknown;
  candidates?: unknown;
};

function normalizeCandidates(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as { id?: unknown; text?: unknown };
      if (typeof candidate.id !== "string" || typeof candidate.text !== "string") return null;
      const id = candidate.id.trim().slice(0, 128);
      const text = candidate.text.trim().slice(0, 2_000);
      return id && text ? { id, text } : null;
    })
    .filter((candidate): candidate is { id: string; text: string } => Boolean(candidate))
    .slice(0, 25);
}

export async function POST(request: Request) {
  if (!hasBearerSecret(request, process.env.ML_API_SECRET)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (exceedsRequestRate(`score-text:${requestClientKey(request)}`, 10, 60_000)) {
    return NextResponse.json({ success: false, error: "Too many requests" }, { status: 429 });
  }

  try {
    const body = await readBoundedJson(request, 65_536) as RequestBody;
    const query = typeof body.query === "string" ? body.query.trim().slice(0, 500) : "";
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
    if (error instanceof RequestGuardError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
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
