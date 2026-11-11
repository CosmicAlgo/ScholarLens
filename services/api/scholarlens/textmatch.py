"""Small, deterministic text checks shared by the verification features.

Everything an AI agent says it quoted is checked here against the real text. If the check fails, the
quote is treated as not found, never shown as if it were real.
"""

import re
import unicodedata
from difflib import SequenceMatcher

_WORD = re.compile(r"[a-z0-9]+")
# Thousands may be grouped with commas or (thin) spaces: 251,454 / 251 454.
_GROUPED = r"\d{1,3}(?:,\d{3})+(?!\d)|\d{1,3}(?:[ \u2009\u202f]\d{3})+(?![\d.,])"
NUM = re.compile(r"(?<![\w.])(" + _GROUPED + r"|\d+(?:\.\d+)?)(\s?%|\s?percent)?", re.I)
STOP = set(
    "a an the of in on for to and or with by from at as is are was were be been this that these those "
    "we our their its it which using use used via into than then also can may not no".split()
)


def norm(text: str) -> str:
    """Lowercase ASCII words only, so PDF ligatures, hyphen breaks and punctuation do not matter."""
    t = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode().lower()
    t = re.sub(r"-\s*\n\s*", "", t)  # words hyphenated across lines
    return " ".join(_WORD.findall(t))


def contains(haystack: str, needle: str) -> bool:
    """Is `needle` really in `haystack` (ignoring case, punctuation, spacing)?"""
    n = norm(needle)
    return bool(n) and n in norm(haystack)


def title_similarity(a: str, b: str) -> float:
    na, nb = norm(a), norm(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    return SequenceMatcher(None, na, nb).ratio()


def content_words(text: str) -> set[str]:
    return {w for w in norm(text).split() if w not in STOP and len(w) > 2}


def numbers(text: str) -> list[float]:
    out = []
    for m in NUM.finditer(text or ""):
        try:
            out.append(float(re.sub(r"[, \u2009\u202f]", "", m.group(1))))
        except ValueError:
            continue
    return out


def salient_numbers(text: str) -> list[float]:
    """Numbers that are claims: decimals, percentages, or anything above 10 that is not a year."""
    out = []
    for m in NUM.finditer(text or ""):
        raw = re.sub(r"[, \u2009\u202f]", "", m.group(1))
        try:
            v = float(raw)
        except ValueError:
            continue
        if m.group(2) or "." in raw or (v > 10 and not (1900 <= v <= 2100 and "." not in raw)):
            out.append(v)
    return out


def same_number(a: float, b: float, tolerance: float = 0.0005) -> bool:
    return abs(a - b) <= max(1e-9, tolerance * max(abs(a), abs(b)))


def rounded_from(a: float, b: float) -> bool:
    """b looks like a rounding of a (250,000 for 251,454), within 3%."""
    return not same_number(a, b) and same_number(a, b, 0.03)


def surname(name: str) -> str:
    """'Ho, Jonathan' -> 'ho'; 'Jonathan Ho' -> 'ho'; 'J. Ho' -> 'ho'."""
    name = (name or "").strip()
    if "," in name:
        name = name.split(",", 1)[0]
    else:
        parts = name.split()
        name = parts[-1] if parts else ""
    return norm(name).replace(" ", "")


def plausible_abstract(abstract: str, title: str) -> bool:
    """OpenAlex sometimes attaches another paper's abstract to a record. A real abstract shares at
    least a third of the title's content words."""
    words = content_words(title)
    if not abstract:
        return False
    return not words or len(words & content_words(abstract)) >= max(1, round(len(words) / 3))
