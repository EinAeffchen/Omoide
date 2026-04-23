from app.processors.base import MediaProcessor
from app.logger import logger

# Explicit imports ensure PyInstaller bundles these modules
# and avoids relying on filesystem scanning at runtime.
"""
Import heavy processors lazily inside load_processors to improve startup time.
PyInstaller bundles the whole 'app' package via main.spec (collect_submodules),
so dynamic imports here remain safe in binaries.
"""

processors: list[MediaProcessor] = []


def load_processors() -> list[MediaProcessor]:
    """
    Return a statically‑registered list of processors.

    Notes:
    - Dynamic discovery via pkgutil/importlib breaks in frozen binaries
      because files are bundled and not laid out on disk.
    - We explicitly import and instantiate known processors so they are
      included in the binary and reliably available at runtime.
    """
    logger.debug("Loading processors!")
    if processors:
        return processors

    # Lazy import to avoid importing heavy deps (torch/onnx) on startup
    from app.processors.blur import BlurProcessor
    from app.processors.exif import ExifProcessor
    from app.processors.embedding_extractor import EmbeddingExtractor
    from app.processors.faces import FaceProcessor
    from app.processors.auto_tagger import AutoTagger

    known_processor_classes: list[type[MediaProcessor]] = [
        BlurProcessor,
        ExifProcessor,
        EmbeddingExtractor,
        FaceProcessor,
        AutoTagger,
    ]

    loaded = [cls() for cls in known_processor_classes]
    loaded.sort(key=lambda p: p.order)
    processors.extend(loaded)
    logger.info("Processors loaded in order: %s", [p.name for p in processors])
    return processors


def reset_processors() -> None:
    """Unload and clear all registered processors so they reload next use."""
    if not processors:
        return
    for proc in processors:
        try:
            proc.unload()
        except Exception as exc:
            logger.debug("Processor %s unload failed: %s", proc.name, exc)
    processors.clear()
