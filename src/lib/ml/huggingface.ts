import { getMlModel, type MlModelKey } from "./model-catalog";

const HF_ROUTER_BASE = "https://router.huggingface.co/hf-inference/models";
const DEFAULT_TIMEOUT_MS = 45_000;

export class MlConfigurationError extends Error {}

export class MlInferenceError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = "MlInferenceError";
    this.status = status;
    this.details = details;
  }
}

function huggingFaceToken() {
  const token = process.env.HUGGINGFACE_API_TOKEN || process.env.HF_TOKEN;
  if (!token) throw new MlConfigurationError("HUGGINGFACE_API_TOKEN is not configured.");
  return token;
}

function workerConfiguration() {
  const url = process.env.ML_WORKER_URL?.replace(/\/$/, "");
  const secret = process.env.ML_WORKER_SECRET;
  if (!url) throw new MlConfigurationError("ML_WORKER_URL is not configured.");
  return { url, secret };
}

async function parseResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  if (contentType.startsWith("image/") || contentType.includes("application/octet-stream")) {
    return response.arrayBuffer();
  }
  return response.text();
}

export async function callHuggingFace<T>(
  modelKey: MlModelKey,
  payload: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const model = getMlModel(modelKey);
  if (!model) throw new MlConfigurationError(`Unknown ML model: ${modelKey}`);
  if (model.runtime !== "hf-inference") {
    throw new MlConfigurationError(`${modelKey} must run through the ML worker.`);
  }

  const response = await fetch(`${HF_ROUTER_BASE}/${model.modelId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${huggingFaceToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const result = await parseResponse(response);

  if (!response.ok) {
    throw new MlInferenceError(`Hugging Face request failed for ${model.modelId}.`, response.status, result);
  }
  return result as T;
}

export async function callMlWorker<T>(
  modelKey: MlModelKey,
  input: unknown,
  timeoutMs = 120_000
): Promise<T> {
  const model = getMlModel(modelKey);
  if (!model) throw new MlConfigurationError(`Unknown ML model: ${modelKey}`);
  const worker = workerConfiguration();

  const response = await fetch(`${worker.url}/v1/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(worker.secret ? { Authorization: `Bearer ${worker.secret}` } : {}),
    },
    body: JSON.stringify({ model: modelKey, input }),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const result = await parseResponse(response);

  if (!response.ok) {
    throw new MlInferenceError(`ML worker request failed for ${modelKey}.`, response.status, result);
  }
  return result as T;
}

export async function runMlModel<T>(modelKey: MlModelKey, input: unknown): Promise<T> {
  const model = getMlModel(modelKey);
  if (!model) throw new MlConfigurationError(`Unknown ML model: ${modelKey}`);
  return model.runtime === "hf-inference"
    ? callHuggingFace<T>(modelKey, input)
    : callMlWorker<T>(modelKey, input);
}

export async function embedTexts(texts: string[]) {
  if (!texts.length) return [];
  return callHuggingFace<number[][]>("venue-embedding", {
    inputs: texts,
    options: { wait_for_model: true },
  });
}

type VibeClassification =
  | Array<{ label: string; score: number }>
  | { labels?: string[]; scores?: number[] };

export async function classifyVibes(text: string, labels: string[]) {
  const result = await callHuggingFace<VibeClassification>("vibe-classifier", {
    inputs: text,
    parameters: {
      candidate_labels: labels,
      multi_label: true,
    },
  });

  if (Array.isArray(result)) return result;
  return (result.labels || []).map((label, index) => ({
    label,
    score: Number(result.scores?.[index] || 0),
  }));
}
