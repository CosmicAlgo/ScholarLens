"""Verifier. One job: delete anything the evidence does not support.

Deterministic. Unsupported claims are removed (not rewritten), and retracted papers are
stripped from citations. What was removed is reported to the user, so cuts are visible.
"""

from .schemas import Claim, RemovedClaim, Report, Verification


def verify(report: Report, evidence: dict[str, dict]) -> tuple[Report, Verification]:
    total = kept = 0
    removed: list[RemovedClaim] = []
    retracted_removed: set[str] = set()

    def check(claims: list[Claim]) -> list[Claim]:
        nonlocal total, kept
        out = []
        for c in claims:
            total += 1
            if not c.evidence:
                removed.append(RemovedClaim(text=c.text, reason="no_evidence"))
                continue
            valid = []
            for eid in dict.fromkeys(c.evidence):
                item = evidence.get(eid)
                if item is None:
                    continue
                if item["kind"] == "paper" and "retracted" in item.get("flags", []):
                    retracted_removed.add(eid)
                    continue
                valid.append(eid)
            if not valid:
                removed.append(RemovedClaim(text=c.text, reason="unknown_evidence"))
                continue
            kept += 1
            out.append(c.model_copy(update={"evidence": valid}))
        return out

    clean = report.model_copy(deep=True)
    clean.tldr = check(clean.tldr)
    for s in clean.sections:
        s.claims = check(s.claims)
    clean.sections = [s for s in clean.sections if s.claims]
    return clean, Verification(
        claims_total=total,
        claims_kept=kept,
        removed=removed,
        retracted_citations_removed=sorted(retracted_removed),
    )
