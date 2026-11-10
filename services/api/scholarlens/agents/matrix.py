"""Evidence matrix: one row per paper (problem, method, data, findings, limitations), every cell cited.

The literature-review table every scholar builds by hand. For each column we retrieve the passages
most likely to answer it, then a fast LLM fills the row using only those passages. Cells cite passage
ids, and citations not in the retrieved set are dropped, so each cell links to the page it came from.
"""

import re

from pydantic import BaseModel, Field

from .copilot import doc_passages
from .deps import Deps

COLUMNS = {
    "problem": "problem motivation research question aim",
    "method": "method approach model architecture algorithm we propose",
    "data": "dataset data participants sample experimental setup benchmark",
    "findings": "results findings show outperforms improvement accuracy significant",
    "limitations": "limitations future work threats to validity however",
}


class Cell(BaseModel):
    text: str = Field(description="at most 30 words; 'Not reported' if the passages do not say")
    cites: list[str] = Field(default_factory=list, description="ids of the passages this cell is based on")


class Row(BaseModel):
    problem: Cell
    method: Cell
    data: Cell
    findings: Cell
    limitations: Cell


SYSTEM = """Fill one row of a literature review table for this paper using ONLY the passages given.
Be concrete: name the method, the dataset and sizes, the headline numbers. If the passages do not say,
write "Not reported". Cite the passage ids each cell is based on."""


def normalise_cites(raw: list[str], seen: set[str]) -> list[str]:
    """Map what the model wrote ("[S:U12ab:3]", "S:U12ab:3 ", "3", "passage 3") onto real passage ids.
    Anything that cannot be matched to a passage that was shown is dropped."""
    out: list[str] = []
    for c in raw:
        c = c.strip().strip("[]() ").strip()
        hit = c if c in seen else None
        if hit is None:
            m = re.search(r"(\d+)$", c)
            if m:
                ends = [s for s in seen if s.endswith(":" + m.group(1))]
                hit = ends[0] if len(ends) == 1 else None
        if hit and hit not in out:
            out.append(hit)
    return out


async def extract_row(deps: Deps, ft, paper_id: str, title: str, passages: list[dict] | None = None) -> dict:
    evidence: list[dict] = []
    if passages:
        for q in COLUMNS.values():
            evidence += doc_passages(paper_id, passages, q, 3)
        source = "uploaded"
    elif (await ft.ensure_fulltext(paper_id))["status"] == "ready":
        for q in COLUMNS.values():
            for r in await ft.search_passages([paper_id], q, k=3):
                evidence.append(
                    {
                        "id": f"S:{r['paper_id']}:{r['idx']}",
                        "kind": "passage",
                        "paper_id": r["paper_id"],
                        "title": r["title"],
                        "page": r["page"],
                        "text": r["text"],
                    }
                )
        source = "full_text"
    else:
        row = await deps.tools.paper(paper_id)
        if row:
            evidence.append(
                {
                    "id": f"P:{paper_id}",
                    "kind": "passage",
                    "paper_id": paper_id,
                    "title": row["title"],
                    "page": 0,
                    "text": row["abstract"] or "",
                }
            )
        source = "abstract"

    seen, uniq = set(), []
    for e in evidence:
        if e["id"] not in seen and e["text"]:
            seen.add(e["id"])
            uniq.append(e)
    if not uniq:
        return {"paper_id": paper_id, "source": source, "row": None, "evidence": []}

    ledger = "\n".join(f"[{e['id']}] (page {e['page']}) {e['text'][:1200]}" for e in uniq)
    row = await deps.llm.structured(tier="fast", system=SYSTEM, prompt=f'Paper: "{title}"\n\n{ledger}', schema=Row)
    from .copilot import unsupported_numbers

    by_id = {e["id"]: e for e in uniq}
    cells = {}
    for col in COLUMNS:
        cell: Cell = getattr(row, col)
        cites = normalise_cites(cell.cites, seen)
        # Same number check as Copilot answers: a figure in a cell must appear in a passage it cites.
        tag = "".join(f" [{c}]" for c in cites)
        tagged = re.sub(r"([.!?])(\s+)", tag + r"\1\2", cell.text.strip()) + tag if cites else ""
        flagged = sorted({x["number"] for x in unsupported_numbers(tagged, by_id)}) if tagged else []
        uncited = not cites and not cell.text.strip().lower().startswith("not reported")
        cells[col] = {"text": cell.text, "cites": cites, "unsupported_numbers": flagged, "uncited": uncited}
    used = {c for cell in cells.values() for c in cell["cites"]}
    return {
        "paper_id": paper_id,
        "source": source,
        "row": cells,
        "evidence": [{"id": e["id"], "page": e["page"], "text": e["text"][:500]} for e in uniq if e["id"] in used],
    }
