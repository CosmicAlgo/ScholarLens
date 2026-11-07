"""Text embeddings via fastembed (ONNX runtime, no PyTorch), so the API fits a 512 MB dyno.

Documents and queries must use the same model. The bulk job (`scholarlens.jobs.embed`)
and the API both go through this module, so they cannot drift apart.
"""

from functools import lru_cache

import numpy as np

from .config import get_settings


@lru_cache(maxsize=1)
def _model():
    from fastembed import TextEmbedding

    s = get_settings()
    return TextEmbedding(s.embedding_model, cache_dir=s.embedding_cache_dir or None)


def embed_query(text: str) -> np.ndarray:
    return next(iter(_model().query_embed([text]))).astype(np.float32)


def embed_documents(texts: list[str], batch_size: int = 64) -> list[np.ndarray]:
    return [v.astype(np.float32) for v in _model().embed(texts, batch_size=batch_size)]


def paper_text(title: str, abstract: str | None) -> str:
    return f"{title}. {abstract or ''}".strip()[:2000]


def to_pgvector(vec: np.ndarray) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in vec.tolist()) + "]"
