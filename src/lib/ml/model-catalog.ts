export type MlModelCategory = "ranking" | "text" | "vision" | "forecasting" | "generation" | "safety";
export type MlRuntime = "hf-inference" | "ml-worker";
export type MlLicense = "MIT" | "Apache-2.0" | "BSD-3-Clause";

export type MlModelDefinition = {
  key: string;
  modelId: string;
  displayName: string;
  category: MlModelCategory;
  task: string;
  license: MlLicense;
  runtime: MlRuntime;
  purpose: string;
  recommended: boolean;
  gated?: boolean;
};

export const ML_MODELS = [
  {
    key: "venue-embedding",
    modelId: "BAAI/bge-small-en-v1.5",
    displayName: "BGE Small English v1.5",
    category: "ranking",
    task: "feature-extraction",
    license: "MIT",
    runtime: "hf-inference",
    purpose: "Creates semantic vectors for venue, event, and user-query matching.",
    recommended: true,
  },
  {
    key: "embedding-fallback",
    modelId: "sentence-transformers/all-MiniLM-L6-v2",
    displayName: "All MiniLM L6 v2",
    category: "ranking",
    task: "feature-extraction",
    license: "Apache-2.0",
    runtime: "hf-inference",
    purpose: "Fallback semantic embedding model when BGE is unavailable.",
    recommended: false,
  },
  {
    key: "venue-reranker",
    modelId: "cross-encoder/ms-marco-MiniLM-L6-v2",
    displayName: "MS MARCO MiniLM Cross Encoder",
    category: "ranking",
    task: "text-ranking",
    license: "Apache-2.0",
    runtime: "ml-worker",
    purpose: "Reranks the strongest candidate venues against the user's exact request.",
    recommended: true,
  },
  {
    key: "vibe-classifier",
    modelId: "MoritzLaurer/ModernBERT-base-zeroshot-v2.0",
    displayName: "ModernBERT Zero Shot v2",
    category: "text",
    task: "zero-shot-classification",
    license: "Apache-2.0",
    runtime: "hf-inference",
    purpose: "Assigns flexible vibes such as date-night, high-energy, quiet, outdoors, or family-friendly.",
    recommended: true,
  },
  {
    key: "entity-extractor",
    modelId: "dslim/distilbert-NER",
    displayName: "DistilBERT NER",
    category: "text",
    task: "token-classification",
    license: "Apache-2.0",
    runtime: "hf-inference",
    purpose: "Extracts people, organizations, and locations from event descriptions and imported feeds.",
    recommended: true,
  },
  {
    key: "short-copy-generator",
    modelId: "google/flan-t5-base",
    displayName: "FLAN-T5 Base",
    category: "text",
    task: "text2text-generation",
    license: "Apache-2.0",
    runtime: "hf-inference",
    purpose: "Creates concise venue summaries, event blurbs, and notification copy.",
    recommended: false,
  },
  {
    key: "image-relevance",
    modelId: "google/siglip2-base-patch16-224",
    displayName: "SigLIP 2 Base",
    category: "vision",
    task: "zero-shot-image-classification",
    license: "Apache-2.0",
    runtime: "ml-worker",
    purpose: "Rejects logos, maps, screenshots, and unrelated images while identifying useful venue photos.",
    recommended: true,
  },
  {
    key: "image-aesthetic-score",
    modelId: "somepago/AestheticSigLIP",
    displayName: "AestheticSigLIP",
    category: "vision",
    task: "image-scoring",
    license: "Apache-2.0",
    runtime: "ml-worker",
    purpose: "Scores candidate venue images for composition, clarity, and visual appeal.",
    recommended: true,
  },
  {
    key: "vision-understanding",
    modelId: "microsoft/Florence-2-base",
    displayName: "Florence 2 Base",
    category: "vision",
    task: "image-text-to-text",
    license: "MIT",
    runtime: "ml-worker",
    purpose: "Captions images, reads flyer text, detects objects, and supports visual grounding.",
    recommended: true,
  },
  {
    key: "image-captioning-fallback",
    modelId: "Salesforce/blip-image-captioning-base",
    displayName: "BLIP Image Captioning Base",
    category: "vision",
    task: "image-to-text",
    license: "BSD-3-Clause",
    runtime: "ml-worker",
    purpose: "Fallback image captioning and accessible alt-text generation.",
    recommended: false,
  },
  {
    key: "image-upscaler",
    modelId: "caidas/swin2SR-realworld-sr-x4-64-bsrgan-psnr",
    displayName: "Swin2SR Real World x4",
    category: "vision",
    task: "image-to-image",
    license: "Apache-2.0",
    runtime: "ml-worker",
    purpose: "Upscales low-resolution venue photos before they are used in cards and detail pages.",
    recommended: true,
  },
  {
    key: "image-segmentation",
    modelId: "facebook/sam2.1-hiera-small",
    displayName: "SAM 2.1 Hiera Small",
    category: "vision",
    task: "mask-generation",
    license: "Apache-2.0",
    runtime: "ml-worker",
    purpose: "Creates subject cutouts and layered promotional graphics from venue images.",
    recommended: false,
  },
  {
    key: "image-depth",
    modelId: "depth-anything/Depth-Anything-V2-Small-hf",
    displayName: "Depth Anything V2 Small",
    category: "vision",
    task: "depth-estimation",
    license: "Apache-2.0",
    runtime: "ml-worker",
    purpose: "Produces depth maps for subtle parallax and dimensional visual effects.",
    recommended: false,
  },
  {
    key: "image-safety",
    modelId: "Falconsai/nsfw_image_detection",
    displayName: "Falconsai NSFW Image Detection",
    category: "safety",
    task: "image-classification",
    license: "Apache-2.0",
    runtime: "hf-inference",
    purpose: "Screens imported or user-provided images before they appear in the app.",
    recommended: true,
  },
  {
    key: "buzz-forecast",
    modelId: "amazon/chronos-2",
    displayName: "Amazon Chronos 2",
    category: "forecasting",
    task: "time-series-forecasting",
    license: "Apache-2.0",
    runtime: "ml-worker",
    purpose: "Forecasts how venue activity may change over the next several hours.",
    recommended: true,
  },
  {
    key: "buzz-forecast-fast",
    modelId: "ibm-granite/granite-timeseries-ttm-r3",
    displayName: "IBM Granite TinyTimeMixer R3",
    category: "forecasting",
    task: "time-series-forecasting",
    license: "Apache-2.0",
    runtime: "ml-worker",
    purpose: "Provides a lightweight forecasting alternative for fast activity predictions.",
    recommended: true,
  },
  {
    key: "brand-art-generator",
    modelId: "black-forest-labs/FLUX.1-schnell",
    displayName: "FLUX.1 Schnell",
    category: "generation",
    task: "text-to-image",
    license: "Apache-2.0",
    runtime: "ml-worker",
    purpose: "Generates branded illustrations, empty states, and campaign artwork, never fake venue photography.",
    recommended: false,
    gated: true,
  },
] as const satisfies readonly MlModelDefinition[];

export type MlModelKey = (typeof ML_MODELS)[number]["key"];

export function getMlModel(key: string) {
  return ML_MODELS.find((model) => model.key === key) || null;
}

export function publicMlCatalog() {
  return ML_MODELS.map((model) => ({
    ...model,
    commercialUse: true,
    configured:
      model.runtime === "hf-inference"
        ? Boolean(process.env.HUGGINGFACE_API_TOKEN || process.env.HF_TOKEN)
        : Boolean(process.env.ML_WORKER_URL),
  }));
}
