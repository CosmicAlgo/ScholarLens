import numpy as np

from scholarlens.clustering import cluster_papers
from scholarlens.search import PaperHit, dedupe


def _hit(id, title, preprint, cites, score=0.1):
    return PaperHit(
        id=id,
        title=title,
        year=2023,
        venue=None,
        doi=None,
        abstract=None,
        cited_by_count=cites,
        is_retracted=False,
        is_preprint=preprint,
        is_oa=True,
        oa_url=None,
        score=score,
    )


def test_dedupe_prefers_peer_reviewed_version():
    hits = [
        _hit("W1", "Attention is all you need", True, 900, 0.5),
        _hit("W2", "Attention Is All You Need!", False, 100, 0.2),
        _hit("W3", "Something else", False, 5),
    ]
    out = dedupe(hits)
    assert [h.id for h in out] == ["W2", "W3"]
    assert out[0].score == 0.5  # keeps the better rank of the pair


def test_clusters_separate_groups_and_flag_emerging():
    rng = np.random.default_rng(0)
    a = [rng.normal(0, 0.05, 16) + np.eye(16)[0] for _ in range(20)]  # older group
    b = [rng.normal(0, 0.05, 16) + np.eye(16)[1] for _ in range(20)]  # recent group
    ids = [f"A{i}" for i in range(20)] + [f"B{i}" for i in range(20)]
    years = [2015] * 20 + [2024] * 20
    clusters = cluster_papers(ids, a + b, years, current_year=2026, k=2)
    assert len(clusters) == 2
    by_first = {c.paper_ids[0][0]: c for c in clusters}
    assert all(p.startswith("B") for p in by_first["B"].paper_ids)
    assert by_first["B"].emergence > 1.5 and by_first["A"].emergence == 0


def test_too_few_papers_returns_nothing():
    assert cluster_papers(["a"], [np.ones(4)], [2020], 2026) == []
