"""Figure reader: a vision worker that looks at a paper's figures, tables and diagrams.

Text extraction loses everything drawn on the page (plots, architecture diagrams, flowcharts, tables
laid out as graphics). This worker picks the pages most likely to hold the figures a question is
about, cuts them out of the PDF (pypdf, no rendering needed), and asks a vision model to read them.

The model's reading is labelled as such in the evidence ledger ("AI reading of a figure"), so the
writer and the reader can tell it apart from text quoted from the paper.
"""

import asyncio
import base64
import io
import re
from typing import Literal

from pydantic import BaseModel, Field

from .deps import Deps
from .llm import Media

_CAPTION = re.compile(r"\b(fig\.?|figure|table|algorithm)\s*(\d+|[ivx]+)\b", re.I)
MAX_PDF_PAGES_TO_MODEL = 8
MAX_PAGE_BYTES = 14_000_000  # inline request limit is ~20 MB after base64


class Figure(BaseModel):
    page: int = Field(description='the page number from the "Page N" label just before the page it is on')
    label: str = Field(description='as printed, e.g. "Figure 3" or "Table 2"; "unlabelled" if none')
    kind: Literal["chart", "diagram", "flowchart", "table", "image", "equation", "other"]
    shows: str = Field(description="what the visual shows: axes, components, arrows, groups (1-3 sentences)")
    takeaway: str = Field(description="the main result or point it makes, with numbers read off it when legible")


class Figures(BaseModel):
    figures: list[Figure]


SYSTEM = """You read the figures, tables and diagrams in pages of a research paper, like a careful
reviewer. Describe only what is visibly on the pages. Read numbers off axes, bars and table cells
when they are legible; never guess values you cannot read. For diagrams and flowcharts, name the
components and how they connect (what feeds into what). Skip logos, headers and decorative images."""


def caption_pages(pages: list[str]) -> list[int]:
    """1-based numbers of pages whose text mentions a figure or table caption."""
    return [i + 1 for i, t in enumerate(pages) if _CAPTION.search(t)]


def choose_pages(pages: list[str], query: str | None, limit: int) -> list[int]:
    """Pages to show the model: caption pages, best match to the query first."""
    from ..fulltext import rank_passages

    with_caps = caption_pages(pages)
    if not query:
        return with_caps[:limit] or list(range(1, min(limit, len(pages)) + 1))
    # Mention of a specific figure ("figure 3") wins outright.
    wanted = re.findall(r"\b(fig\.?|figure|table)\s*(\d+)", query, re.I)
    picked: list[int] = []
    for kind, n in wanted:
        word = r"table" if kind.lower() == "table" else r"(?:fig\.?|figure)"
        pat = re.compile(rf"\b{word}\s*{n}\b", re.I)
        cap = re.compile(rf"\b{word}\s*{n}\s*[:.|]", re.I)
        printed = [p for p in with_caps if cap.search(pages[p - 1])]  # the caption itself
        if printed:
            picked += [p for p in printed if p not in picked]
            continue
        hits = [p for p in with_caps if pat.search(pages[p - 1])]
        # Figures are often printed on the page before their first mention.
        for p in ([hits[0] - 1] if hits and hits[0] > 1 else []) + hits:
            if p not in picked:
                picked.append(p)
    q = query
    for pat, more in _SYNONYMS:
        if pat.search(query):
            q += " " + more
    # Rank by caption text first ("Figure 2: Overview of the framework"), then by the page body.
    caps = [{"page": p, "text": " ".join(_CAPTION_TEXT.findall(pages[p - 1])) or pages[p - 1]} for p in with_caps]
    pool = [{"page": p, "text": pages[p - 1]} for p in (with_caps or range(1, len(pages) + 1))]
    for ranked in (caps, pool):
        if not ranked:
            continue
        scores_hit = rank_passages(ranked, q, limit)
        for i in scores_hit:
            if ranked[i]["page"] not in picked and len(picked) < limit:
                picked.append(ranked[i]["page"])
    return sorted(picked[:limit])


_CAPTION_TEXT = re.compile(r"(?:fig\.?|figure|table)\s*\d+\s*[:.|]\s*(.{0,240})", re.I)
_SYNONYMS = [
    (
        re.compile(r"architect|pipeline|framework|overview|workflow|flow ?chart|diagram|how .* works|method", re.I),
        "overview framework architecture pipeline model workflow proposed approach illustration",
    ),
    (
        re.compile(r"result|performance|accuracy|compar|benchmark|ablation|score", re.I),
        "results performance comparison accuracy baselines ablation datasets",
    ),
]


def subset_pdf(data: bytes, pages: list[int]) -> bytes:
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(io.BytesIO(data))
    writer = PdfWriter()
    for p in pages:
        if 1 <= p <= len(reader.pages):
            writer.add_page(reader.pages[p - 1])
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def _prompt(title: str, pages: list[int], query: str | None) -> str:
    focus = (
        f"The user's question: {query}\nDescribe the figures relevant to it first."
        if query
        else ("Describe every figure, table and diagram on these pages.")
    )
    return (
        f'Paper: "{title}"\nEach attached page is preceded by a label "Page N of the paper". Report each '
        f"figure's page as that N. Copy each figure's label exactly as printed in its caption.\n{focus}"
    )


_LABEL = re.compile(r"\b(fig\.?|figure|table|algorithm)\s*(\d+|[ivx]+)\b", re.I)


def find_caption(label: str, page_text: str, seps: str = ":.|") -> str | None:
    """The printed caption for `label` ("Figure 2") if it starts a line of the page text, else None.
    In-text mentions ("as shown in Figure 2.") never start a line, so they are not mistaken for it."""
    m = _LABEL.search(label)
    if not m:
        return None
    word = (
        r"table"
        if m.group(1).lower() == "table"
        else r"algorithm"
        if m.group(1).lower() == "algorithm"
        else (r"(?:fig\.?|figure)")
    )
    pat = re.compile(rf"^\s*{word}\s*{re.escape(m.group(2))}\s*[{re.escape(seps)}]\s*(.{{0,200}})", re.I | re.M)
    hit = pat.search(page_text)
    if not hit:
        return None
    return re.sub(r"\s+", " ", hit.group(0)).strip()


def raw_pages(data: bytes, pages: list[int]) -> dict[int, str]:
    """Page text with line breaks kept (captions start a line)."""
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    out = {}
    for p in pages:
        if 1 <= p <= len(reader.pages):
            try:
                out[p] = reader.pages[p - 1].extract_text() or ""
            except Exception:  # a broken page must not sink the rest
                out[p] = ""
    return out


async def read_pdf_figures(deps: Deps, ft, paper_id: str, title: str, query: str | None, limit: int = 3) -> list[dict]:
    """Figures from a paper whose PDF the server can fetch. Empty if there is no PDF."""
    status = await ft.ensure_fulltext(paper_id)
    if status["status"] != "ready":
        return []
    data, _, _ = await ft.get_pdf(paper_id)
    pages = await asyncio.to_thread(ft.extract_pages, data)
    chosen = choose_pages(pages, query, min(limit, MAX_PDF_PAGES_TO_MODEL))
    if not chosen:
        return []
    # One small PDF per page, each labelled with its real page number, so the model cannot confuse
    # a page's position in the request with its page number in the paper.
    media, total = [], 0
    for p in chosen:
        one = await asyncio.to_thread(subset_pdf, data, [p])
        total += len(one)
        if total > MAX_PAGE_BYTES:
            break
        media.append(Media("application/pdf", base64.b64encode(one).decode(), label=f"Page {p} of the paper:"))
    if not media:
        return []
    sent = chosen[: len(media)]
    texts = await asyncio.to_thread(raw_pages, data, sent)
    return await _read(deps, paper_id, title, sent, query, media, texts)


async def read_image_figures(
    deps: Deps,
    paper_id: str,
    title: str,
    images: list[tuple[int, str]],
    query: str | None,
    texts: dict[int, str] | None = None,
) -> list[dict]:
    """Figures from page images the browser rendered (uploaded PDFs never reach the server).
    `texts` is each page's text (with line breaks), extracted in the browser, for caption checks."""
    if not images:
        return []
    pages = [p for p, _ in images]
    media = [Media("image/jpeg", b64, label=f"Page {p} of the paper:") for p, b64 in images]
    return await _read(deps, paper_id, title, pages, query, media, texts or {})


def ground(label: str, model_page: int, texts: dict[int, str]) -> tuple[int | None, str | None]:
    """Where the figure really is: the page whose text prints its caption wins over the model's page.
    Returns (page, caption); page is None when the model's page was not among those it was shown."""
    # "Figure 2:" is a caption; "Figure 2." at a line start can be a wrapped in-text mention, so it
    # only counts when no page prints the colon form.
    for seps in (":|", "."):
        for p, t in texts.items():
            cap = find_caption(label, t, seps)
            if cap:
                return p, cap
    return (model_page if model_page in texts or not texts else None), None


async def _read(deps: Deps, paper_id: str, title: str, pages: list[int], query, media, texts) -> list[dict]:
    out = await deps.llm.structured(
        tier="fast", system=SYSTEM, prompt=_prompt(title, pages, query), schema=Figures, media=media
    )
    allowed, seen, ev = set(pages), {}, []
    texts = {p: texts.get(p, "") for p in pages} if texts else {}
    for f in out.figures:
        page, caption = ground(f.label, f.page, texts)
        if page is None and not texts:
            page = f.page if f.page in allowed else None
        if page is None or page not in allowed:
            continue  # the model invented a page number and no printed caption places the figure
        seen[page] = seen.get(page, 0) + 1
        ev.append(
            {
                "id": f"F:{paper_id}:{page}:{seen[page]}",
                "kind": "figure",
                "paper_id": paper_id,
                "title": title,
                "page": page,
                "label": f.label[:60],
                "figure_kind": f.kind,
                # The caption is copied from the PDF's text: it is what the reader jumps to and what
                # shows the label is real. Without it, the label is the vision model's reading.
                "caption": caption,
                "text": f"{f.label} ({f.kind}). Shows: {f.shows} Takeaway: {f.takeaway}",
            }
        )
    return ev
