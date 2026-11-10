"""Smart search (typo-tolerant, vague queries) and topic lineage, without network or LLM."""

from scholarlens import smart_search
from scholarlens.lineage import first_sustained_year
from scholarlens.search import PaperHit


def hit(i, title, cites=0, abstract="", retracted=False):
    return PaperHit(
        id=i,
        title=title,
        year=2020,
        venue=None,
        doi=None,
        abstract=abstract,
        cited_by_count=cites,
        is_retracted=retracted,
        is_preprint=False,
        is_oa=True,
        oa_url=None,
        score=0.0,
    )


def test_rerank_prefers_on_topic_papers_found_by_several_phrases():
    a = hit("W1", "Retrieval augmented generation for question answering", 50)
    b = hit("W2", "A history of medieval architecture", 5000)
    c = hit("W3", "Dense retrieval for open-domain QA", 900)
    bad = hit("W4", "Retrieval augmented generation, retracted", 10, retracted=True)
    out = smart_search.rerank([[b, a], [a, c], [bad]], ["retrieval augmented generation"], 3)
    assert out[0].id == "W1" and out[-1].id != "W1"
    assert "W2" not in [h.id for h in out[:2]]  # citations alone do not win


def test_first_usage_ignores_isolated_early_records():
    counts = {1998: 1, 2012: 2, 2019: 1, 2020: 4, 2021: 9, 2022: 13, 2023: 113}
    assert first_sustained_year(counts) == 2020
    assert first_sustained_year({2015: 1, 2018: 2}) is None


class NoCache:
    store: dict = {}


async def test_interpretation_falls_back_without_llm(monkeypatch):
    async def get(key, ttl_hours):
        return None

    async def put(key, payload):
        NoCache.store[key] = payload

    from scholarlens import openalex

    monkeypatch.setattr(openalex, "cache_get", get)
    monkeypatch.setattr(openalex, "cache_put", put)
    assert await smart_search.interpret(None, "difusion modle") is None

    class BrokenLLM:
        async def structured(self, **kw):
            raise RuntimeError("quota")

    assert await smart_search.interpret(BrokenLLM(), "difusion modle") is None

    class GoodLLM:
        async def structured(self, **kw):
            assert kw["effort"] == "minimal"
            return smart_search.Interpretation(
                corrected="diffusion model", searches=["diffusion model", "", "x" * 300], note="Spelling"
            )

    out = await smart_search.interpret(GoodLLM(), "difusion modle")
    assert out.searches == ["diffusion model"] and NoCache.store  # junk phrases dropped, result cached
