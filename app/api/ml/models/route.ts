import { NextResponse } from "next/server";
import { publicMlCatalog } from "../../../../src/lib/ml/model-catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    success: true,
    generatedAt: new Date().toISOString(),
    huggingFaceConfigured: Boolean(process.env.HUGGINGFACE_API_TOKEN || process.env.HF_TOKEN),
    workerConfigured: Boolean(process.env.ML_WORKER_URL),
    models: publicMlCatalog(),
  });
}
