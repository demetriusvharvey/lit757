import { NextResponse } from "next/server";
import { publicMlCatalog } from "../../../../src/lib/ml/model-catalog";
import { exceedsRequestRate, hasBearerSecret, requestClientKey } from "../../../../src/lib/server/request-guards";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // The catalog reports which providers are configured, which is infrastructure
  // state rather than public information. Keep it behind the same secret as the
  // other ML routes, and out of shared caches.
  if (!hasBearerSecret(request, process.env.ML_API_SECRET)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (exceedsRequestRate(`ml-models:${requestClientKey(request)}`, 30, 60_000)) {
    return NextResponse.json({ success: false, error: "Too many requests" }, { status: 429 });
  }

  return NextResponse.json({
    success: true,
    generatedAt: new Date().toISOString(),
    models: publicMlCatalog(),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
