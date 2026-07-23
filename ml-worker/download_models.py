#!/usr/bin/env python3
"""Download Buzz's vetted Hugging Face models into a worker cache.

The web app never commits model weights. This script is intended for a separate
CPU/GPU worker image or persistent volume, not Vercel serverless functions.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

from huggingface_hub import snapshot_download
from huggingface_hub.utils import GatedRepoError, HfHubHTTPError

ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "models.json"


def load_models() -> list[dict[str, Any]]:
    with MANIFEST.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download Buzz ML model snapshots.")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--all", action="store_true", help="Download every model in the manifest.")
    group.add_argument("--recommended", action="store_true", help="Download recommended production models.")
    group.add_argument("--model", action="append", default=[], help="Download one model key; repeat as needed.")
    parser.add_argument(
        "--cache-dir",
        default=os.environ.get("HF_HOME", str(ROOT / ".cache" / "huggingface")),
        help="Persistent Hugging Face cache directory.",
    )
    return parser.parse_args()


def select_models(models: list[dict[str, Any]], args: argparse.Namespace) -> list[dict[str, Any]]:
    if args.all:
        return models
    if args.model:
        requested = set(args.model)
        selected = [model for model in models if model["key"] in requested]
        missing = sorted(requested - {model["key"] for model in selected})
        if missing:
            raise SystemExit(f"Unknown model key(s): {', '.join(missing)}")
        return selected
    return [model for model in models if model.get("recommended")]


def main() -> int:
    args = parse_args()
    models = select_models(load_models(), args)
    token = os.environ.get("HUGGINGFACE_API_TOKEN") or os.environ.get("HF_TOKEN")
    cache_dir = Path(args.cache_dir).expanduser().resolve()
    cache_dir.mkdir(parents=True, exist_ok=True)

    downloaded: list[str] = []
    skipped: list[str] = []
    failed: list[str] = []

    print(f"Downloading {len(models)} model(s) into {cache_dir}")
    for model in models:
        key = model["key"]
        model_id = model["model_id"]
        if model.get("gated") and not token:
            print(f"SKIP {key}: gated model requires HUGGINGFACE_API_TOKEN")
            skipped.append(key)
            continue

        print(f"GET  {key}: {model_id}")
        try:
            snapshot_download(repo_id=model_id, token=token, cache_dir=str(cache_dir))
            downloaded.append(key)
        except GatedRepoError:
            print(f"SKIP {key}: accept the model terms on Hugging Face first")
            skipped.append(key)
        except HfHubHTTPError as error:
            print(f"FAIL {key}: {error}")
            failed.append(key)

    print(json.dumps({"downloaded": downloaded, "skipped": skipped, "failed": failed}, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
