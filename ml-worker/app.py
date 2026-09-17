from __future__ import annotations

import base64
import binascii
import hmac
import importlib.util
import ipaddress
import io
import os
import socket
import sys
import threading
import time
from collections import defaultdict, deque
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
import numpy as np
import pandas as pd
import torch
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from huggingface_hub import snapshot_download
from PIL import Image
from pydantic import BaseModel, Field
from sentence_transformers import CrossEncoder
from transformers import AutoModelForCausalLM, AutoProcessor, pipeline

MODEL_IDS = {
    "venue-reranker": "cross-encoder/ms-marco-MiniLM-L6-v2",
    "image-relevance": "google/siglip2-base-patch16-224",
    "image-aesthetic-score": "somepago/AestheticSigLIP",
    "vision-understanding": "microsoft/Florence-2-base",
    "image-captioning-fallback": "Salesforce/blip-image-captioning-base",
    "image-upscaler": "caidas/swin2SR-realworld-sr-x4-64-bsrgan-psnr",
    "image-segmentation": "facebook/sam2.1-hiera-small",
    "image-depth": "depth-anything/Depth-Anything-V2-Small-hf",
    "buzz-forecast": "amazon/chronos-2",
    "buzz-forecast-fast": "ibm-granite/granite-timeseries-ttm-r3",
    "brand-art-generator": "black-forest-labs/FLUX.1-schnell",
}

app = FastAPI(title="Buzz ML Worker", version="1.0.0")
MAX_REQUEST_BYTES = 1_048_576
MAX_IMAGE_BYTES = 10_485_760
RATE_LIMIT_PER_MINUTE = int(os.environ.get("ML_WORKER_RATE_LIMIT_PER_MINUTE", "30"))
MAX_CONCURRENCY = int(os.environ.get("ML_WORKER_MAX_CONCURRENCY", "1"))
request_slots = threading.BoundedSemaphore(max(1, MAX_CONCURRENCY))
rate_lock = threading.Lock()
rate_buckets: dict[str, deque[float]] = defaultdict(deque)
Image.MAX_IMAGE_PIXELS = 40_000_000


class RunRequest(BaseModel):
    model: str
    input: dict[str, Any] = Field(default_factory=dict)


def require_secret(authorization: str | None = Header(default=None)) -> None:
    expected = os.environ.get("ML_WORKER_SECRET")
    supplied = authorization or ""
    if not expected or len(expected) < 32 or not hmac.compare_digest(supplied, f"Bearer {expected}"):
        raise HTTPException(status_code=401, detail="Unauthorized")


def rate_limited(client: str) -> bool:
    now = time.monotonic()
    with rate_lock:
        bucket = rate_buckets[client]
        while bucket and bucket[0] <= now - 60:
            bucket.popleft()
        if len(bucket) >= RATE_LIMIT_PER_MINUTE:
            return True
        bucket.append(now)
        return False


@app.middleware("http")
async def protect_inference(request: Request, call_next):
    if request.url.path != "/v1/run":
        return await call_next(request)
    client = request.client.host if request.client else "unknown"
    if rate_limited(client):
        return JSONResponse({"detail": "Too many requests"}, status_code=429)
    content_length = int(request.headers.get("content-length") or "0")
    if content_length > MAX_REQUEST_BYTES:
        return JSONResponse({"detail": "Request too large"}, status_code=413)
    body = await request.body()
    if not body or len(body) > MAX_REQUEST_BYTES:
        return JSONResponse({"detail": "Invalid request body"}, status_code=400)
    if not request_slots.acquire(blocking=False):
        return JSONResponse({"detail": "Worker is busy"}, status_code=429)
    try:
        return await call_next(request)
    finally:
        request_slots.release()


def hf_token() -> str | None:
    return os.environ.get("HUGGINGFACE_API_TOKEN") or os.environ.get("HF_TOKEN")


def pipeline_device() -> int:
    return 0 if torch.cuda.is_available() else -1


def model_device() -> str:
    return "cuda" if torch.cuda.is_available() else "cpu"


def validate_public_https_url(value: str) -> str:
    if len(value) > 2_048:
        raise HTTPException(status_code=400, detail="Image URL is too long")
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise HTTPException(status_code=400, detail="A public HTTPS image URL is required")
    try:
        addresses = {
            item[4][0]
            for item in socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)
        }
    except socket.gaierror as error:
        raise HTTPException(status_code=400, detail="Image host could not be resolved") from error
    if not addresses:
        raise HTTPException(status_code=400, detail="Image host could not be resolved")
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if not ip.is_global:
            raise HTTPException(status_code=400, detail="Private image hosts are not allowed")
    return value


def decoded_image(raw: bytes) -> Image.Image:
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image is too large")
    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
        return image.convert("RGB")
    except (OSError, ValueError) as error:
        raise HTTPException(status_code=400, detail="Invalid image") from error


def image_from_input(data: dict[str, Any]) -> Image.Image:
    image_url = data.get("image_url")
    image_base64 = data.get("image_base64")
    if isinstance(image_url, str) and image_url:
        safe_url = validate_public_https_url(image_url)
        timeout = httpx.Timeout(30, connect=5)
        with httpx.Client(timeout=timeout, follow_redirects=False) as client:
            with client.stream("GET", safe_url) as response:
                response.raise_for_status()
                if not (response.headers.get("content-type") or "").lower().startswith("image/"):
                    raise HTTPException(status_code=400, detail="URL did not return an image")
                raw = bytearray()
                for chunk in response.iter_bytes():
                    raw.extend(chunk)
                    if len(raw) > MAX_IMAGE_BYTES:
                        raise HTTPException(status_code=413, detail="Image is too large")
                return decoded_image(bytes(raw))
    if isinstance(image_base64, str) and image_base64:
        if len(image_base64) > (MAX_IMAGE_BYTES * 4 // 3) + 1_024:
            raise HTTPException(status_code=413, detail="Image is too large")
        raw = image_base64.split(",", 1)[-1]
        try:
            return decoded_image(base64.b64decode(raw, validate=True))
        except (binascii.Error, ValueError) as error:
            raise HTTPException(status_code=400, detail="Invalid base64 image") from error
    raise HTTPException(status_code=400, detail="image_url or image_base64 is required")


def encode_image(image: Image.Image, image_format: str = "PNG") -> dict[str, Any]:
    buffer = io.BytesIO()
    image.save(buffer, format=image_format)
    return {
        "mime_type": f"image/{image_format.lower()}",
        "base64": base64.b64encode(buffer.getvalue()).decode("ascii"),
        "width": image.width,
        "height": image.height,
    }


def json_safe(value: Any) -> Any:
    if isinstance(value, Image.Image):
        return encode_image(value)
    if isinstance(value, torch.Tensor):
        return value.detach().cpu().tolist()
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    return value


@lru_cache(maxsize=None)
def transformer_pipeline(task: str, model_id: str, trust_remote_code: bool = False):
    return pipeline(
        task,
        model=model_id,
        token=hf_token(),
        device=pipeline_device(),
        trust_remote_code=trust_remote_code,
    )


@lru_cache(maxsize=1)
def reranker() -> CrossEncoder:
    return CrossEncoder(MODEL_IDS["venue-reranker"], device=model_device(), token=hf_token())


@lru_cache(maxsize=1)
def aesthetic_scorer():
    snapshot = Path(snapshot_download(MODEL_IDS["image-aesthetic-score"], token=hf_token()))
    sys.path.insert(0, str(snapshot))
    spec = importlib.util.spec_from_file_location("buzz_aesthetic_predict", snapshot / "predict.py")
    if not spec or not spec.loader:
        raise RuntimeError("Unable to load AestheticSigLIP predictor")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.AestheticScorer.from_pretrained(MODEL_IDS["image-aesthetic-score"])


@lru_cache(maxsize=1)
def florence_components():
    model_id = MODEL_IDS["vision-understanding"]
    dtype = torch.float16 if torch.cuda.is_available() else torch.float32
    processor = AutoProcessor.from_pretrained(model_id, token=hf_token(), trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        model_id,
        token=hf_token(),
        trust_remote_code=True,
        torch_dtype=dtype,
    ).to(model_device())
    return processor, model


@lru_cache(maxsize=1)
def chronos_pipeline():
    from chronos import BaseChronosPipeline

    return BaseChronosPipeline.from_pretrained(
        MODEL_IDS["buzz-forecast"],
        token=hf_token(),
        device_map=model_device(),
    )


@lru_cache(maxsize=1)
def flux_pipeline():
    from diffusers import DiffusionPipeline

    dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
    model = DiffusionPipeline.from_pretrained(
        MODEL_IDS["brand-art-generator"],
        token=hf_token(),
        torch_dtype=dtype,
    )
    return model.to(model_device())


def run_reranker(data: dict[str, Any]) -> dict[str, Any]:
    query = str(data.get("query") or "").strip()
    raw_candidates = data.get("candidates")
    if not query or not isinstance(raw_candidates, list) or not raw_candidates:
        raise HTTPException(status_code=400, detail="query and candidates are required")

    candidates: list[dict[str, str]] = []
    for index, candidate in enumerate(raw_candidates[:100]):
        if isinstance(candidate, str):
            candidates.append({"id": str(index), "text": candidate})
        elif isinstance(candidate, dict) and isinstance(candidate.get("text"), str):
            candidates.append({"id": str(candidate.get("id", index)), "text": candidate["text"]})

    scores = reranker().predict([(query, candidate["text"]) for candidate in candidates])
    ranked = [
        {"id": candidate["id"], "score": float(score)}
        for candidate, score in zip(candidates, scores, strict=True)
    ]
    ranked.sort(key=lambda item: item["score"], reverse=True)
    return {"model": "venue-reranker", "scores": ranked}


def run_image_relevance(data: dict[str, Any]) -> dict[str, Any]:
    labels = data.get("labels") or [
        "venue exterior",
        "venue interior",
        "food or drink",
        "people enjoying an event",
        "logo",
        "map screenshot",
        "unrelated stock photo",
    ]
    image = image_from_input(data)
    result = transformer_pipeline(
        "zero-shot-image-classification", MODEL_IDS["image-relevance"]
    )(image, candidate_labels=labels)
    return {"model": "image-relevance", "labels": json_safe(result)}


def run_aesthetic_score(data: dict[str, Any]) -> dict[str, Any]:
    image = image_from_input(data)
    return {"model": "image-aesthetic-score", "score": float(aesthetic_scorer().rate(image))}


def run_florence(data: dict[str, Any]) -> dict[str, Any]:
    image = image_from_input(data)
    task = str(data.get("task") or "<MORE_DETAILED_CAPTION>")
    processor, model = florence_components()
    inputs = processor(text=task, images=image, return_tensors="pt")
    inputs = {key: value.to(model_device()) for key, value in inputs.items()}
    generated_ids = model.generate(
        **inputs,
        max_new_tokens=int(data.get("max_new_tokens") or 512),
        num_beams=int(data.get("num_beams") or 3),
    )
    text = processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
    parsed = processor.post_process_generation(text, task=task, image_size=image.size)
    return {"model": "vision-understanding", "task": task, "result": json_safe(parsed)}


def run_standard_image_pipeline(key: str, task: str, data: dict[str, Any]) -> dict[str, Any]:
    image = image_from_input(data)
    result = transformer_pipeline(task, MODEL_IDS[key])(image)
    return {"model": key, "result": json_safe(result)}


def run_chronos(data: dict[str, Any]) -> dict[str, Any]:
    values = data.get("values")
    if not isinstance(values, list) or len(values) < 8:
        raise HTTPException(status_code=400, detail="values must contain at least eight observations")
    prediction_length = min(168, max(1, int(data.get("prediction_length") or 12)))
    frequency = str(data.get("frequency") or "h")
    end = pd.Timestamp(data.get("end_time") or pd.Timestamp.now(tz="UTC"))
    timestamps = pd.date_range(end=end, periods=len(values), freq=frequency)
    frame = pd.DataFrame({
        "item_id": str(data.get("item_id") or "venue"),
        "timestamp": timestamps,
        "target": [float(value) for value in values],
    })
    prediction = chronos_pipeline().predict_df(
        frame,
        prediction_length=prediction_length,
        quantile_levels=[0.1, 0.5, 0.9],
        id_column="item_id",
        timestamp_column="timestamp",
        target="target",
    )
    return {"model": "buzz-forecast", "forecast": json_safe(prediction.to_dict(orient="records"))}


def run_flux(data: dict[str, Any]) -> dict[str, Any]:
    prompt = str(data.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt is required")
    if not torch.cuda.is_available():
        raise HTTPException(status_code=503, detail="FLUX requires a GPU worker for practical use")
    image = flux_pipeline()(
        prompt,
        num_inference_steps=min(4, max(1, int(data.get("steps") or 4))),
        guidance_scale=0.0,
    ).images[0]
    return {"model": "brand-art-generator", "image": encode_image(image)}


HANDLERS = {
    "venue-reranker": run_reranker,
    "image-relevance": run_image_relevance,
    "image-aesthetic-score": run_aesthetic_score,
    "vision-understanding": run_florence,
    "image-captioning-fallback": lambda data: run_standard_image_pipeline(
        "image-captioning-fallback", "image-to-text", data
    ),
    "image-upscaler": lambda data: run_standard_image_pipeline("image-upscaler", "image-to-image", data),
    "image-segmentation": lambda data: run_standard_image_pipeline(
        "image-segmentation", "mask-generation", data
    ),
    "image-depth": lambda data: run_standard_image_pipeline("image-depth", "depth-estimation", data),
    "buzz-forecast": run_chronos,
    "brand-art-generator": run_flux,
}


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "device": model_device(),
        "models": sorted(MODEL_IDS),
        "implemented": sorted(HANDLERS),
    }


@app.post("/v1/run", dependencies=[Depends(require_secret)])
def run(request: RunRequest) -> dict[str, Any]:
    if request.model == "buzz-forecast-fast":
        raise HTTPException(
            status_code=501,
            detail="Granite TTM R3 is registered and downloadable, but IBM has not released its R3 inference recipe yet.",
        )
    handler = HANDLERS.get(request.model)
    if not handler:
        raise HTTPException(status_code=404, detail=f"Unknown or serverless model: {request.model}")
    try:
        return handler(request.input)
    except HTTPException:
        raise
    except Exception as error:
        print(f"{request.model} inference failed: {type(error).__name__}", file=sys.stderr)
        raise HTTPException(status_code=500, detail="Inference failed") from error
