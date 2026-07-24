# Buzz ML worker

Buzz uses two ML runtimes:

1. **Hugging Face Inference Providers from Vercel** for smaller text models such as BGE embeddings, ModernBERT classification, DistilBERT NER, FLAN-T5, and image safety.
2. **This separate CPU/GPU worker** for large or custom models such as the cross-encoder reranker, SigLIP 2, AestheticSigLIP, Florence 2, BLIP, Swin2SR, SAM 2.1, Depth Anything, Chronos 2, Granite TTM R3, and FLUX.1 Schnell.

Model weights are intentionally not committed to GitHub. They are downloaded lazily from the IDs in `models.json` and cached on the worker's persistent disk.

## Required environment variables

```env
HUGGINGFACE_API_TOKEN=hf_your_fine_grained_token
ML_WORKER_SECRET=use_a_unique_random_value_of_at_least_32_characters
ML_WORKER_MAX_CONCURRENCY=1
ML_WORKER_RATE_LIMIT_PER_MINUTE=30
HF_HOME=/models/huggingface
```

FLUX.1 Schnell is gated even though its weights use Apache 2.0. The Hugging Face account behind the token must accept the model access terms before it can be downloaded.

## Download model snapshots

Recommended models only:

```bash
python download_models.py --recommended
```

Every vetted model in the manifest:

```bash
python download_models.py --all
```

One or more specific models:

```bash
python download_models.py --model venue-reranker --model image-relevance
```

Downloading every model requires tens of gigabytes of persistent storage. Do not put the cache in Git or a Vercel deployment.

## Run directly

```bash
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8080
```

## Run with Docker

```bash
docker build -t buzz-ml-worker .
docker run --rm -p 8080:8080 \
  -e HUGGINGFACE_API_TOKEN \
  -e ML_WORKER_SECRET \
  -v buzz-model-cache:/models/huggingface \
  buzz-ml-worker
```

After deployment, add these to the Vercel project:

```env
ML_WORKER_URL=https://your-worker.example.com
ML_WORKER_SECRET=the_same_long_random_value
ML_API_SECRET=a_separate_random_value_for_protected_vercel_ml_routes
```

`ML_API_SECRET` and `ML_WORKER_SECRET` must be different. Never reuse `CRON_SECRET`
for either purpose. The worker fails closed when its secret is absent or too short.

## Worker API

Health check:

```http
GET /health
```

Run a model:

```http
POST /v1/run
Authorization: Bearer <ML_WORKER_SECRET>
Content-Type: application/json

{
  "model": "venue-reranker",
  "input": {
    "query": "chill date night with live music",
    "candidates": [
      {"id": "venue-1", "text": "Quiet wine bar with an acoustic trio"},
      {"id": "venue-2", "text": "High-energy sports bar"}
    ]
  }
}
```

## Current limitation

Granite TTM R3 is included in the commercial-use manifest and downloader, but its model card currently says the example inference recipes are still to be released. The worker returns HTTP 501 for that one handler rather than pretending an unverified implementation is production-ready.
