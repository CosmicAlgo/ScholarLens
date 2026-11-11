"""Paper Film verification and researcher profiles: the parts decided in code."""

from scholarlens import authors
from scholarlens.agents import author_brief, film

P = {
    "S:W1:0": {"id": "S:W1:0", "page": 1, "text": "We observed a ring with a diameter of 42 ± 3 μas around M87."},
    "S:W1:1": {
        "id": "S:W1:1",
        "page": 2,
        "text": "The inferred mass is 6.5 billion solar masses. Figure 3: The averaged image.",
    },
}


def _scene(lines, visual, heading="Scene"):
    return film.Scene(
        kind="result", heading=heading, lines=[film.Line(**x) for x in lines], visual=film.Visual(**visual)
    )


def test_lines_need_a_source_and_their_numbers_must_be_in_it():
    board = film.Storyboard(
        title="T",
        logline="L",
        scenes=[
            _scene(
                [
                    {"text": "They saw a ring 42 microarcseconds across.", "cites": ["S:W1:0"]},
                    {"text": "The ring was 55 microarcseconds across.", "cites": ["S:W1:0"]},
                    {"text": "Nobody cites this.", "cites": ["S:W9:9"]},
                ],
                {"type": "points", "items": ["a", "b"]},
            )
        ],
    )
    out = film.verify(board, P, [])
    assert [ln["text"] for ln in out["scenes"][0]["lines"]] == ["They saw a ring 42 microarcseconds across."]
    assert {r["reason"] for r in out["verification"]["removed"]} == {"number_not_in_source", "no_source"}


def test_visuals_must_be_in_the_paper_but_may_cite_a_neighbouring_passage():
    ok_line = [{"text": "The mass is 6.5 billion suns.", "cites": ["S:W1:1"]}]
    stat = film.verify(
        film.Storyboard(
            title="T", logline="L", scenes=[_scene(ok_line, {"type": "stat", "value": "42 μas", "cite": "S:W1:1"})]
        ),
        P,
        [],
    )
    assert stat["scenes"][0]["visual"] == {"type": "stat", "value": "42 μas", "label": "", "cite": "S:W1:0", "page": 1}
    fake = film.verify(
        film.Storyboard(
            title="T",
            logline="L",
            scenes=[_scene(ok_line, {"type": "quote", "quote": "We imaged the event horizon directly in 2017."})],
        ),
        P,
        [],
    )
    assert fake["scenes"][0]["visual"]["type"] == "points"
    assert fake["verification"]["removed"][0]["reason"] == "visual_not_in_source"


def test_figures_come_from_captions_in_the_text():
    figs = film.figures_in(list(P.values()))
    assert figs == [{"label": "Figure 3", "caption": "The averaged image.", "page": 2, "cite": "S:W1:1"}]
    board = film.Storyboard(
        title="T",
        logline="L",
        scenes=[_scene([{"text": "See the image.", "cites": ["S:W1:1"]}], {"type": "figure", "figure": "figure 3"})],
    )
    assert film.verify(board, P, figs)["scenes"][0]["visual"]["label"] == "Figure 3"


def test_long_papers_are_read_in_at_most_ten_parts():
    many = [{"id": f"S:W:{i}", "page": i, "text": "x" * 900} for i in range(200)]
    parts = film.chunks(many)
    assert len(parts) <= 10 and sum(len(p) for p in parts) == 200


def test_topic_shift_labels():
    recent = [{"id": "T1", "name": "VLA", "count": 30}, {"id": "T2", "name": "RL", "count": 20}]
    before = [{"id": "T2", "name": "RL", "count": 50}, {"id": "T3", "name": "Meta-learning", "count": 50}]
    out = {t["name"]: t["trend"] for t in authors.topic_shift(recent, before)}
    assert out == {"VLA": "new", "RL": "steady", "Meta-learning": "dropped"}


def test_open_problems_are_quoted_from_abstracts():
    works = [
        {
            "id": "W1",
            "title": "A",
            "year": 2025,
            "abstract": "We build a robot. How to scale this to many homes remains an open question.",
        },
        {"id": "W2", "title": "B", "year": 2024, "abstract": "We close this gap with a new method that works."},
    ]
    out = authors.open_problems(works)
    assert [o["work"] for o in out] == ["W1"] and out[0]["text"].endswith("open question.")


def test_brief_drops_unsourced_statements_and_wrong_numbers():
    works = [{"id": "W1", "title": "Robots", "abstract": "Our policy succeeds in 87% of trials across 12 homes."}]
    raw = author_brief.Brief(
        agenda=[author_brief.Theme(name="Home robots", summary="Policies that work in 12 homes.", works=["W1"])],
        direction=author_brief.Point(text="Moving to homes.", works=["W1"]),
        overlap=[
            author_brief.Point(text="Your idea matches their 87% success rate.", works=["W1"]),
            author_brief.Point(text="They reached 95% success.", works=["W1"]),
            author_brief.Point(text="They have a grant for this.", works=["W99"]),
        ],
        read_first=[author_brief.ReadFirst(work="W1", why="Core paper."), author_brief.ReadFirst(work="W5", why="?")],
    )
    out, ver = author_brief.check(raw, works)
    assert [p["text"] for p in out["overlap"]] == ["Your idea matches their 87% success rate."]
    assert [r["work"] for r in out["read_first"]] == ["W1"]
    assert {r["reason"] for r in ver["removed"]} == {"number_not_in_source", "no_source"}
