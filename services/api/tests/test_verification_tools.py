"""Citation Check, Claim Court, Citation Telephone and topic senses: the parts decided in code."""

from types import SimpleNamespace

from scholarlens import claims, refcheck, senses
from scholarlens.textmatch import contains, numbers, plausible_abstract, salient_numbers, surname


def test_numbers_read_grouped_thousands_and_skip_years():
    assert numbers("as high as 251 454 per year") == [251454.0]
    assert numbers("about 250,000 deaths, 1.1% of admissions") == [250000.0, 1.1]
    assert salient_numbers("In 2016 we saw 3 cases and 400,000 deaths") == [400000.0]


def test_quotes_must_really_be_in_the_text():
    assert contains("Our model achieves 28.4 BLEU on the WMT 2014 task.", "achieves 28.4 BLEU")
    assert not contains("Our model achieves 28.4 BLEU.", "achieves 41.8 BLEU")


def test_a_mismatched_abstract_is_rejected():
    assert plausible_abstract("The dominant sequence models use attention ...", "Attention Is All You Need")
    assert not plausible_abstract(
        "We used a diffusion model to impute missing methylation data from leukemia samples.",
        "Denoising Diffusion Probabilistic Models for Image Synthesis on Large Benchmarks",
    )


def test_numbers_decide_the_fate_of_a_retelling():
    nums = [251454.0]
    assert claims.fate(nums, "an estimated 251,454 deaths")[0] == "faithful"
    assert claims.fate(nums, "more than 250 000 deaths a year")[0] == "rounded"
    assert claims.fate(nums, "about 400,000 deaths a year") == ("changed", "numbers")
    assert claims.fate(nums, "the third leading cause of death") == ("vaguer", "numbers")
    assert claims.fate([], "the leading cause", "stronger") == ("overstated", "ai")


def test_court_verdict_is_counted_not_written():
    assert claims._verdict(1, 0)["label"] == "not_enough"
    assert claims._verdict(9, 0)["label"] == "supported"
    assert claims._verdict(8, 2)["label"] == "mostly_supported"
    assert claims._verdict(3, 3)["label"] == "contested"


def test_a_meaning_shift_is_followed_only_when_the_dominant_field_changed():
    cs = {"id": "17", "name": "Computer Science", "share": 0.51}
    env = {"id": "23", "name": "Environmental Science", "share": 0.2}
    field, note = senses.choose([cs], 2900, [env])
    assert field == cs and "Environmental Science" in note
    assert senses.choose([cs], 2900, [{**cs, "share": 0.4}]) == (None, "")  # same field: all fields
    assert senses.choose([cs], 50, [env]) == (None, "")  # too few early papers to trust
    assert senses.choose([{**cs, "share": 0.2}], 2900, [env]) == (None, "")  # no clear current meaning


def test_draft_and_reference_list_are_split_at_the_last_heading():
    body, refs = refcheck.split_draft("Intro text [1].\n\nReferences\n[1] A paper. 2020.")
    assert body.startswith("Intro") and refs.strip().startswith("[1]")
    assert refcheck.split_draft("[1] Only a list. 2020.") == ("", "[1] Only a list. 2020.")


def _entry(**kw):
    return {
        "title": "Deep residual learning for image recognition",
        "first_author": "He",
        "year": 2016,
        "readable": True,
        **kw,
    }


def _rec(**kw):
    return {
        "title": "Deep Residual Learning for Image Recognition",
        "year": 2016,
        "authors": ["Kaiming He", "Xiangyu Zhang"],
        "retracted": False,
        "cited_by": 100,
        **kw,
    }


def test_reference_judgements():
    assert refcheck.judge(_entry(), _rec(), None) == ("verified", [])
    assert refcheck.judge(_entry(year=2012), _rec(), None)[0] == "check_details"
    assert refcheck.judge(_entry(), None, None)[0] == "not_found"
    assert refcheck.judge(_entry(), _rec(retracted=True), None)[0] == "retracted"
    assert refcheck.judge(_entry(), None, _rec(title="Another paper"))[0] == "doi_mismatch"
    assert refcheck.judge(_entry(readable=False), _rec(), None)[0] == "unreadable"


def test_the_article_wins_over_a_reply_with_the_same_title():
    reply = _rec(authors=["Aderbal Sabra"], cited_by=3, year=1998)
    article = _rec(authors=["A J Wakefield"], cited_by=3000, year=1998)
    entry = _entry(first_author="Wakefield", year=1998)
    assert refcheck.pick([reply, article], entry) is article
    assert surname("Wakefield, A. J.") == "wakefield" and surname("A J Wakefield") == "wakefield"


async def test_unproven_stance_labels_fall_back_to_mentions(monkeypatch):
    src = {
        "id": "W1",
        "title": "A paper",
        "year": 2020,
        "doi": None,
        "arxiv": None,
        "authors": [],
        "abstract": "",
        "cited_by": 10,
        "retracted": False,
    }
    ctx = [
        {
            "text": "Our replication confirms the effect reported by [3] in all cohorts.",
            "influential": False,
            "paper": {"s2": "a", "title": "T1", "year": 2021, "cited_by": 1},
        },
        {
            "text": "Unlike [3], we find no effect at all in a larger sample.",
            "influential": False,
            "paper": {"s2": "b", "title": "T2", "year": 2022, "cited_by": 2},
        },
    ]

    async def fake_source(_):
        return src

    async def fake_ref(_):
        return "X"

    async def fake_contexts(*_a, **_k):
        return ctx

    monkeypatch.setattr(claims, "source_paper", fake_source)
    monkeypatch.setattr(claims, "_s2_ref", fake_ref)
    monkeypatch.setattr(claims.s2, "citation_contexts", fake_contexts)

    class LLM:
        async def structured(self, **_):
            return claims.Judgements(
                items=[
                    claims.Judgement(i=0, stance="supports", quote="confirms the effect"),
                    claims.Judgement(i=1, stance="disputes", quote="we found the opposite"),  # not in the text
                ]
            )

    out = await claims.court(LLM(), "W1", "the effect")
    assert out["tally"] == {"supports": 1, "disputes": 0, "mentions": 1}
    assert out["coverage"]["labels_without_proof"] == 1
    assert SimpleNamespace(**out["verdict"]).label == "not_enough"
