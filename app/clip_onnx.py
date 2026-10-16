"""OpenCLIP inference on ONNX Runtime.

Runs the image and text towers of an OpenCLIP model exported to ONNX, so CLIP
shares the (small, GPU capable) onnxruntime package with face recognition
instead of pulling in torch. The exports come from Immich's Hugging Face
repositories; they contain the exact OpenCLIP weights, so embeddings stay
compatible with ones produced by open_clip.
"""

from __future__ import annotations

import html
import json
import shutil
import threading
from collections.abc import Sequence
from pathlib import Path
from urllib.request import urlopen

import numpy as np
from PIL import Image

from app.accelerators import create_onnx_session
from app.logger import logger

HF_BASE_URL = "https://huggingface.co"

REQUIRED_FILES = (
    "config.json",
    "visual/model.onnx",
    "visual/preprocess_cfg.json",
    "textual/model.onnx",
    "textual/tokenizer.json",
    "textual/tokenizer_config.json",
)
# Exports for other runtimes/hardware stored in the same repos
_SKIPPED_PATH_PARTS = ("rknpu", "armnn", "fp16")
# Written once every file of a model is present, so later starts skip the
# (network) file listing.
_COMPLETE_MARKER = ".complete"

_RESAMPLING = {
    "bicubic": Image.Resampling.BICUBIC,
    "bilinear": Image.Resampling.BILINEAR,
    "nearest": Image.Resampling.NEAREST,
}


def _download_file(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    with urlopen(url) as response, open(tmp, "wb") as out:
        shutil.copyfileobj(response, out, length=1024 * 1024)
    tmp.replace(dest)


def _list_model_files(hf_repo: str) -> list[str]:
    """All files of the ONNX export, including external weight files.

    Models over 2 GB (e.g. ViT-H-14) keep their weights in hundreds of files
    next to model.onnx that ONNX Runtime loads by name.
    """
    with urlopen(f"{HF_BASE_URL}/api/models/{hf_repo}") as response:
        siblings = json.load(response).get("siblings", [])
    files = [
        s["rfilename"]
        for s in siblings
        if s["rfilename"].split("/")[0] in ("visual", "textual")
        and not any(part in _SKIPPED_PATH_PARTS for part in s["rfilename"].split("/"))
    ]
    return sorted(set(files) | set(REQUIRED_FILES))


def ensure_model_files(hf_repo: str, models_dir: Path) -> Path:
    """Download the ONNX export of ``hf_repo`` unless it is already cached."""
    from concurrent.futures import ThreadPoolExecutor

    model_dir = models_dir / "clip" / hf_repo.split("/")[-1]
    if (model_dir / _COMPLETE_MARKER).exists():
        return model_dir
    missing = [
        rel_path
        for rel_path in _list_model_files(hf_repo)
        if not (model_dir / rel_path).exists()
    ]
    if missing:
        logger.info(
            "Downloading %d CLIP model files for %s", len(missing), hf_repo
        )
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(
                pool.map(
                    lambda rel_path: _download_file(
                        f"{HF_BASE_URL}/{hf_repo}/resolve/main/{rel_path}",
                        model_dir / rel_path,
                    ),
                    missing,
                )
            )
    (model_dir / _COMPLETE_MARKER).touch()
    return model_dir


def _clean_text(text: str) -> str:
    # Mirrors open_clip's default "whitespace" cleaning.
    text = html.unescape(html.unescape(text))
    return " ".join(text.split())


def _normalize(features: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(features, axis=-1, keepdims=True)
    return (features / np.maximum(norms, 1e-12)).astype(np.float32, copy=False)


class ClipEncoder:
    def __init__(self, model_dir: Path, prefer_gpu: bool):
        from tokenizers import Tokenizer

        config = json.loads((model_dir / "config.json").read_text("utf-8"))
        preprocess_cfg = json.loads(
            (model_dir / "visual" / "preprocess_cfg.json").read_text("utf-8")
        )
        tokenizer_cfg = json.loads(
            (model_dir / "textual" / "tokenizer_config.json").read_text("utf-8")
        )

        self.embedding_size = int(config["embed_dim"])
        self._image_size = int(preprocess_cfg["size"][0])
        self._resample = _RESAMPLING[preprocess_cfg.get("interpolation", "bicubic")]
        self._mean = np.array(preprocess_cfg["mean"], dtype=np.float32)[:, None, None]
        self._std = np.array(preprocess_cfg["std"], dtype=np.float32)[:, None, None]

        text_cfg = config.get("text_cfg", {})
        context_length = int(text_cfg.get("context_length", 77))
        # HF text towers (XLM-RoBERTa) derive their attention mask from the
        # tokenizer's pad id; OpenAI-style towers are padded with zeros and
        # expect lowercased input, like open_clip's SimpleTokenizer.
        self._is_hf_text = "hf_tokenizer_name" in text_cfg
        self._tokenizer = Tokenizer.from_file(
            str(model_dir / "textual" / "tokenizer.json")
        )
        pad_token = tokenizer_cfg.get("pad_token")
        pad_id = (
            self._tokenizer.token_to_id(pad_token)
            if self._is_hf_text and isinstance(pad_token, str)
            else 0
        )
        self._tokenizer.enable_truncation(max_length=context_length)
        self._tokenizer.enable_padding(
            length=context_length, pad_id=pad_id or 0, pad_token=pad_token or ""
        )

        self._visual = create_onnx_session(
            model_dir / "visual" / "model.onnx", prefer_gpu
        )
        self._textual = create_onnx_session(
            model_dir / "textual" / "model.onnx", prefer_gpu
        )
        self._visual_input = self._visual.get_inputs()[0]
        self._textual_input = self._textual.get_inputs()[0]

    def preprocess(self, image: Image.Image | np.ndarray) -> np.ndarray:
        """Resize the shortest side, center-crop and normalize to CHW float32."""
        if not isinstance(image, Image.Image):
            image = Image.fromarray(image)
        image = image.convert("RGB")
        size = self._image_size
        width, height = image.size
        if width <= height:
            new_w, new_h = size, int(size * height / width)
        else:
            new_w, new_h = int(size * width / height), size
        image = image.resize((new_w, new_h), self._resample)
        left = int(round((new_w - size) / 2.0))
        top = int(round((new_h - size) / 2.0))
        image = image.crop((left, top, left + size, top + size))
        pixels = np.asarray(image, dtype=np.float32).transpose(2, 0, 1) / 255.0
        return (pixels - self._mean) / self._std

    def _run(self, session, model_input, batch: np.ndarray) -> np.ndarray:
        # Exports with a fixed batch dimension of 1 are run item by item.
        if model_input.shape[0] == 1 and batch.shape[0] > 1:
            outputs = [
                session.run(None, {model_input.name: batch[i : i + 1]})[0]
                for i in range(batch.shape[0])
            ]
            return np.concatenate(outputs, axis=0)
        return session.run(None, {model_input.name: batch})[0]

    def encode_pixels(self, pixels: np.ndarray) -> np.ndarray:
        """Embed a (N, 3, H, W) batch produced by preprocess()."""
        features = self._run(
            self._visual, self._visual_input, pixels.astype(np.float32, copy=False)
        )
        return _normalize(features)

    def encode_images(
        self, images: Sequence[Image.Image | np.ndarray]
    ) -> np.ndarray:
        return self.encode_pixels(np.stack([self.preprocess(i) for i in images]))

    def encode_texts(self, texts: Sequence[str]) -> np.ndarray:
        cleaned = [_clean_text(t) for t in texts]
        if not self._is_hf_text:
            cleaned = [t.lower() for t in cleaned]
        encodings = self._tokenizer.encode_batch(cleaned)
        tokens = np.array([e.ids for e in encodings], dtype=np.int32)
        if self._textual_input.type == "tensor(int64)":
            tokens = tokens.astype(np.int64)
        features = self._run(self._textual, self._textual_input, tokens)
        return _normalize(features)


_clip_lock = threading.Lock()
_clip_encoder: ClipEncoder | None = None


def get_clip_encoder() -> ClipEncoder:
    """Shared encoder for the configured CLIP model, loaded on first use."""
    global _clip_encoder
    with _clip_lock:
        if _clip_encoder is None:
            from app.config import settings

            logger.info("Loading CLIP encoder (lazy)...")
            model_dir = ensure_model_files(
                settings.ai.clip_model.hf_repo, settings.general.models_dir
            )
            _clip_encoder = ClipEncoder(
                model_dir, prefer_gpu=settings.processors.prefer_gpu
            )
        return _clip_encoder


def reset_clip_encoder() -> None:
    """Drop the shared encoder so the next use loads the configured model."""
    global _clip_encoder
    with _clip_lock:
        _clip_encoder = None
