"""Typed contracts between agents. Each agent reads and writes only these shapes.

No min/max length constraints here: structured-output JSON schemas support a limited
subset of validation, so sizes are enforced in code after parsing.
"""

from typing import Literal

from pydantic import BaseModel, Field


class TopicQuery(BaseModel):
    key: str = Field(description="short lowercase slug, e.g. 'rag'")
    label: str = Field(description="human-readable topic name")
    query: str = Field(description="2-6 word phrase as it would appear in paper titles/abstracts")


class Plan(BaseModel):
    in_scope: bool = Field(description="false if this is not a question about research literature")
    out_of_scope_reason: str = ""
    topics: list[TopicQuery] = Field(description="1 to 3 topics; more than one only when comparing")
    year_from: int | None = Field(default=None, description="earliest year the user cares about, if stated")


class SearchQueries(BaseModel):
    queries: list[str] = Field(description="2 or 3 alternative search phrasings")


class Claim(BaseModel):
    text: str
    evidence: list[str] = Field(description="evidence ids that support this claim, e.g. ['M:rag:recent_growth']")


class TrendInsight(BaseModel):
    statements: list[Claim]


class ClusterLabel(BaseModel):
    index: int
    name: str = Field(description="3-6 word name for this sub-area")
    summary: str = Field(description="one sentence on what these papers study")


class ClusterLabels(BaseModel):
    clusters: list[ClusterLabel]


class Section(BaseModel):
    heading: str
    claims: list[Claim]


class Report(BaseModel):
    title: str
    tldr: list[Claim] = Field(description="2-4 headline findings")
    sections: list[Section]
    caveats: list[str] = Field(default_factory=list, description="limits of this analysis, no citations needed")


class RemovedClaim(BaseModel):
    text: str
    reason: Literal["no_evidence", "unknown_evidence"]


class Verification(BaseModel):
    claims_total: int
    claims_kept: int
    removed: list[RemovedClaim]
    retracted_citations_removed: list[str]
