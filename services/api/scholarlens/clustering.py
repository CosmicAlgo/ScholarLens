"""Group retrieved papers into sub-topics and score which ones are emerging. Deterministic."""

from dataclasses import dataclass

import numpy as np


@dataclass
class Cluster:
    index: int
    paper_ids: list[str]
    representative_ids: list[str]  # closest to the centre: what the cluster is "about"
    recent_share: float  # fraction of this cluster's papers from the last 2 complete years
    emergence: float  # recent_share relative to the whole result set (>1 = newer than average)
    median_year: int | None


def _kmeans(x: np.ndarray, k: int, iters: int = 50, seed: int = 7) -> np.ndarray:
    rng = np.random.default_rng(seed)
    # k-means++ initialisation
    centres = [x[rng.integers(len(x))]]
    for _ in range(1, k):
        d = np.min([np.sum((x - c) ** 2, axis=1) for c in centres], axis=0)
        probs = d / d.sum() if d.sum() > 0 else np.full(len(x), 1 / len(x))
        centres.append(x[rng.choice(len(x), p=probs)])
    c = np.stack(centres)
    labels = np.zeros(len(x), dtype=int)
    for _ in range(iters):
        new = np.argmin(((x[:, None, :] - c[None, :, :]) ** 2).sum(-1), axis=1)
        if np.array_equal(new, labels) and _ > 0:
            break
        labels = new
        for j in range(k):
            members = x[labels == j]
            if len(members):
                c[j] = members.mean(axis=0)
    return labels


def cluster_papers(
    ids: list[str], vectors: list[np.ndarray], years: list[int | None], current_year: int, k: int | None = None
) -> list[Cluster]:
    if len(ids) < 6:
        return []
    x = np.stack(vectors).astype(np.float64)
    x /= np.linalg.norm(x, axis=1, keepdims=True) + 1e-9
    k = k or int(min(6, max(2, len(ids) // 10)))
    labels = _kmeans(x, k)

    recent_cut = current_year - 2  # last 2 *complete* years

    def is_recent(y):
        return y is not None and recent_cut <= y < current_year

    overall_recent = sum(map(is_recent, years)) / len(years) or 1e-9

    clusters = []
    for j in range(k):
        idx = np.where(labels == j)[0]
        if len(idx) < 2:
            continue
        centre = x[idx].mean(axis=0)
        order = idx[np.argsort(-(x[idx] @ centre))]
        ys = [years[i] for i in idx if years[i] is not None]
        recent = sum(is_recent(years[i]) for i in idx) / len(idx)
        clusters.append(
            Cluster(
                index=len(clusters),
                paper_ids=[ids[i] for i in order],
                representative_ids=[ids[i] for i in order[:5]],
                recent_share=round(recent, 3),
                emergence=round(recent / overall_recent, 2),
                median_year=int(np.median(ys)) if ys else None,
            )
        )
    return sorted(clusters, key=lambda c: -len(c.paper_ids))
