# ScholarLens architecture

## Principles

1. **Numbers are computed, never generated.** Trend maths, clustering, deduplication and
   trust checks are deterministic code with unit tests. The LLM only plans, names and explains.
2. **Every claim has a citable source.** Papers, metrics and clusters get evidence ids
   (`P:`, `M:`, `C:`). The verifier deletes any claim that doesn't cite a real one, and the
   user sees what was cut.
3. **One agent, one job.** Each agent has a single responsibility, a typed input and output,
   and access to only the tools it needs.
4. **Cheap by default.** Trend and search endpoints use no LLM. OpenAlex aggregations are
   cached for a week. Agent runs are rate-limited per visitor and globally.

## Components

| Path | Language | Job |
|---|---|---|
| `services/harvester` | Go | Pulls works from OpenAlex into Postgres (cursor paging, retries, batched upserts). |
| `services/api` | Python (FastAPI, LangGraph) | Trend, search and paper endpoints, and the agent pipeline. |
| `services/api/scholarlens/jobs/embed.py` | Python | Fills missing 384-dim embeddings (fastembed / ONNX). |
| `db/migrations` | SQL | Postgres + pgvector schema. |
| `apps/web` | TypeScript (Next.js 16) | Server-rendered, cached topic/compare/paper pages (SEO entry points) and the streamed Ask view. PostHog analytics when configured. |

## Data flow

```
OpenAlex ──(Go harvester)──> Postgres papers ──(embed job)──> pgvector embeddings
OpenAlex group_by counts ──(cached)──> trend maths ──> /api/trend
Postgres (vector + full-text, RRF) ──> /api/search
```

**Why trends don't use our own database:** we store a focused slice of papers (it has to
fit a 1 GB database). Trend counts need the *whole* literature, so they come from OpenAlex's
server-side `group_by=publication_year` over 250M+ works. Both the topic and the baseline
are limited to articles, preprints and reviews with an abstract, because the raw catalogue
contains bulk-ingested non-paper records that distort recent years.

**Growth is relative.** A topic "grows" only if its *share* of all papers rises. Raw counts
rise for almost everything because science grows about 4-5% a year. The current year is
marked partial and excluded from fitting (indexing lag).

## Agent pipeline (`services/api/scholarlens/agents`)

```
            ┌─> Trend Analyst ────────────────────────────────┐
  Planner ──┤                                                  ├─> Writer ─> Verifier
            └─> Scout ─> Cartographer ─> Trust Auditor ────────┘
```

| Agent | LLM? | Single job | Can't do |
|---|---|---|---|
| Planner | fast | Question → 1-3 searchable topics, or "out of scope" | Research, write prose |
| Trend Analyst | fast | Explain pre-computed trend metrics | See papers, compute numbers |
| Scout | fast | Propose search phrasings; hybrid search does retrieval | Judge or summarise papers |
| Cartographer | fast | Name the sub-topic clusters (clustering is k-means in code) | Decide what's emerging (that's computed) |
| Trust Auditor | none | Flag retracted papers and preprint share | n/a (deterministic) |
| Writer | strong | Turn findings into a briefing that cites evidence ids | Add facts not in the material |
| Verifier | none | Delete unsupported claims and retracted citations | Rewrite anything |

Out-of-scope questions stop after the Planner, so they cost one cheap call.

**Providers** (`agents/llm.py`): agents depend on a one-method `LLM` protocol
(`structured(tier, system, prompt, schema)`), so the provider is swappable. Default is
Gemini on the Google AI Studio free tier (fast tier `gemini-3.5-flash-lite`, strong tier
`gemini-3.6-flash`, two separate quotas). Anthropic is supported as a paid option.
A typical run makes 4-10 calls; the global daily cap keeps us under the free quota.

## Deployment (planned)

- **API + Postgres:** Heroku (student credit): Eco dyno + Essential-0 Postgres (1 GB, pgvector).
- **Web:** Vercel Hobby. **Domain:** Hostinger, `scholarlens.<tld>` → Vercel, `api.` → Heroku.
- **Harvest + embed:** run from a laptop against the production `DATABASE_URL`, or as
  Heroku Scheduler jobs.
