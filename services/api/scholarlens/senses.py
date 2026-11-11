"""Which meaning of a topic name the user means. OpenAlex only, no LLM.

Keyword matching counts every paper that uses the words, so "transformers" mixes deep learning with
power engineering and "diffusion models" mixes generative AI with chemistry. We look at which research
fields (OpenAlex's classification of each paper's primary topic) use the phrase now, and which used it
at the start of the window. When the dominant field has changed, the name has picked up a new meaning,
so we follow the current one and say so. Users can always pick a field or "all fields" themselves.
"""

from .openalex import PAPER_FILTER, _cached_get, search_term

MIN_EARLY = 200  # papers needed in the early window before a meaning shift is trusted
MIN_DOMINANT = 0.35  # the current field must hold at least this share to be followed automatically


async def field_shares(query: str, y0: int, y1: int) -> tuple[int, list[dict]]:
    payload = await _cached_get(
        "/works",
        {
            "filter": f"publication_year:{y0}-{y1},{PAPER_FILTER},title_and_abstract.search:{search_term(query)}",
            "group_by": "primary_topic.field.id",
        },
    )
    groups = payload.get("group_by", [])
    total = sum(int(g.get("count", 0)) for g in groups) or 0
    out = []
    for g in groups[:8]:
        key = str(g.get("key", "")).rsplit("/", 1)[-1]
        if not key.isdigit() or not total:
            continue
        out.append({"id": key, "name": g.get("key_display_name") or key, "share": round(int(g["count"]) / total, 3)})
    return total, out


def choose(recent: list[dict], early_total: int, early: list[dict]) -> tuple[dict | None, str]:
    """Pure decision so it can be unit-tested. Returns (field or None for all fields, reason)."""
    if not recent:
        return None, ""
    top = recent[0]
    if top["share"] < MIN_DOMINANT or early_total < MIN_EARLY or not early:
        return None, ""
    if early[0]["id"] == top["id"]:
        return None, ""
    was = early[0]
    return top, (
        f"This name meant something else before: early papers using it were mostly {was['name']} "
        f"({round(was['share'] * 100)}%), recent ones are mostly {top['name']} ({round(top['share'] * 100)}%). "
        f"Showing {top['name']} only."
    )


async def resolve(query: str, y0: int, y1: int, choice: str = "auto") -> dict:
    """choice: "auto", "all", or an OpenAlex field id. Returns the field to filter on and the options."""
    last = y1 - 1  # the current year is still being indexed
    total, recent = await field_shares(query, last - 2, last)
    options = [o for o in recent if o["share"] >= 0.03][:6]
    if choice == "all":
        return {"field": None, "name": "All fields", "auto": False, "note": "", "options": options}
    if choice.isdigit():
        name = next((o["name"] for o in recent if o["id"] == choice), f"Field {choice}")
        return {"field": choice, "name": name, "auto": False, "note": "", "options": options}
    early_total, early = await field_shares(query, y0, y0 + 2)
    picked, note = choose(recent, early_total, early)
    if not picked:
        return {"field": None, "name": "All fields", "auto": True, "note": "", "options": options}
    return {"field": picked["id"], "name": picked["name"], "auto": True, "note": note, "options": options}
