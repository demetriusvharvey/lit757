import { NextResponse } from "next/server";
import { publicMlCatalog } from "../../../../src/lib/ml/model-catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    success: true,
    generatedAt: new Date().toISOString(),
    models: publicMlCatalog(),
  }, { headers: { "Cache-Control": "public, max-age=300" } });
}
