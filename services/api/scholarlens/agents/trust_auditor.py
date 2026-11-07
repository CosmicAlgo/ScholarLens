"""Trust Auditor. One job: flag papers that should not be taken at face value.

Fully deterministic, no LLM. Uses OpenAlex's retraction and preprint signals.
"""


def audit(evidence: dict[str, dict]) -> dict:
    papers = [e for e in evidence.values() if e["kind"] == "paper"]
    retracted = [e["id"] for e in papers if "retracted" in e["flags"]]
    preprints = [e["id"] for e in papers if "preprint" in e["flags"]]
    n = len(papers) or 1
    return {
        "papers_checked": len(papers),
        "retracted": retracted,
        "preprints": preprints,
        "preprint_share": round(len(preprints) / n, 2),
        "note": (
            "A high preprint share means much of this evidence has not been peer reviewed yet."
            if len(preprints) / n > 0.4
            else ""
        ),
    }
