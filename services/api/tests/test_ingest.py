"""OpenAlex normalisation must match the Go harvester's rules."""

from scholarlens.ingest import normalise, reconstruct_abstract

WORK = {
    "id": "https://openalex.org/W123",
    "doi": "https://doi.org/10.1/abc",
    "title": " A study ",
    "publication_year": 2024,
    "publication_date": "2024-03-01",
    "type": "article",
    "primary_location": {"source": {"display_name": "arXiv", "type": "repository"}, "version": "submittedVersion"},
    "cited_by_count": 7,
    "open_access": {"is_oa": True, "oa_url": "https://x"},
    "is_retracted": False,
    "primary_topic": {"id": "https://openalex.org/T1", "display_name": "NLP", "field": {"display_name": "CS"}},
    "authorships": [
        {
            "author": {"id": "https://openalex.org/A1", "display_name": "Ada", "orcid": "https://orcid.org/0000-1"},
            "institutions": [{"display_name": "Uni"}],
        },
        {"author": {"id": "https://openalex.org/A1", "display_name": "Ada dup"}},
        {"author": {"id": "https://openalex.org/A2", "display_name": "Bo"}, "institutions": []},
    ],
    "abstract_inverted_index": {"hello": [0], "world": [1, 3], "again": [2]},
}


def test_reconstruct_abstract_orders_by_position():
    assert reconstruct_abstract({"b": [1], "a": [0], "c": [2, 3]}) == "a b c c"
    assert reconstruct_abstract(None) == ""


def test_normalise_matches_harvester_rules():
    p = normalise(WORK)
    assert p["id"] == "W123" and p["doi"] == "10.1/abc" and p["title"] == "A study"
    assert p["is_preprint"] is True and p["venue"] == "arXiv"
    assert p["abstract"] == "hello world again world"
    assert p["topic"]["id"] == "T1" and p["topic"]["field"] == "CS"
    assert [a["id"] for a in p["authors"]] == ["A1", "A2"]
    assert p["authors"][0]["orcid"] == "0000-1" and p["authors"][0]["institution"] == "Uni"
    assert p["authors"][1]["position"] == 2


def test_normalise_skips_untitled():
    assert normalise({**WORK, "title": "  "}) is None
