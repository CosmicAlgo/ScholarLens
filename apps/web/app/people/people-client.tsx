"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Working } from "@/components/verify/shared";
import {
  type AuthorSummary,
  type BriefPoint,
  type BriefResult,
  fetchBrief,
  fetchProfile,
  type Profile,
  searchAuthors,
  type TopicShift,
  type Work,
} from "@/lib/people";

const TREND: Record<TopicShift["trend"], { label: string; cls: string }> = {
  new: { label: "New", cls: "bg-vision-soft text-vision border-vision/30" },
  rising: { label: "Rising", cls: "bg-good-soft text-good border-good/30" },
  steady: { label: "Steady", cls: "bg-surface-2 text-ink-2 border-line" },
  fading: { label: "Fading", cls: "bg-warn-soft text-warn border-warn/30" },
  dropped: { label: "Earlier focus", cls: "bg-surface-2 text-ink-3 border-line" },
};

export function PeopleClient({ initialId, initialQuery }: { initialId: string | null; initialQuery: string }) {
  const [q, setQ] = useState(initialQuery);
  const [results, setResults] = useState<AuthorSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const open = useCallback(async (id: string) => {
    setLoadingId(id);
    setErr("");
    try {
      const p = await fetchProfile(id);
      setProfile(p);
      const url = new URL(window.location.href);
      url.search = `?id=${id}`;
      window.history.replaceState(null, "", url);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load this researcher.");
    } finally {
      setLoadingId(null);
    }
  }, []);

  const search = async (e?: React.FormEvent, text = q) => {
    e?.preventDefault();
    if (text.trim().length < 2) return;
    setBusy(true);
    setErr("");
    setProfile(null);
    try {
      setResults((await searchAuthors(text.trim())).results);
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Search failed.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    // Deferred so state updates happen outside the effect body.
    const t = setTimeout(() => {
      if (initialId) open(initialId);
      else if (initialQuery) search(undefined, initialQuery);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="pb-20 space-y-5">
      <form onSubmit={search} className="flex gap-2">
        <label htmlFor="ppl-q" className="sr-only">
          Researcher name
        </label>
        <input
          id="ppl-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={120}
          placeholder="A researcher's name, e.g. Chelsea Finn"
          className="flex-1 min-w-0 h-12 rounded-xl border border-line bg-surface px-4 outline-none focus:border-accent"
        />
        <button className="h-12 rounded-xl bg-accent text-white font-medium px-5 hover:opacity-90 disabled:opacity-50" disabled={busy}>
          {busy ? "Searching…" : "Find"}
        </button>
      </form>
      {err && <p className="text-sm text-bad">{err}</p>}

      {profile ? (
        <ProfileView p={profile} onOpen={open} onBack={() => setProfile(null)} hasResults={!!results?.length} />
      ) : (
        results && (
          <section>
            <p className="text-sm text-ink-3">
              {results.length
                ? "OpenAlex sometimes splits one person into several records. Pick the one whose institution and topics match."
                : "No researchers found with that name."}
            </p>
            <ul className="mt-3 grid sm:grid-cols-2 gap-3">
              {results.map((a) => (
                <li key={a.id}>
                  <button
                    onClick={() => open(a.id)}
                    disabled={!!loadingId}
                    className="w-full text-left rounded-2xl border border-line bg-surface p-4 hover:border-ink-3 disabled:opacity-60"
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="font-semibold">{a.name}</span>
                      {loadingId === a.id ? (
                        <span className="text-xs text-ink-3">Loading…</span>
                      ) : (
                        a.orcid && <span className="text-[0.65rem] rounded-full border border-good/30 bg-good-soft text-good px-2 py-0.5">ORCID</span>
                      )}
                    </span>
                    <span className="block text-sm text-ink-2 mt-0.5">{a.institutions.map((i) => i.name).slice(0, 2).join(" · ") || "Institution unknown"}</span>
                    <span className="block text-xs text-ink-3 mt-1">{a.topics.join(" · ")}</span>
                    <span className="mt-2 flex flex-wrap gap-3 text-xs text-ink-3 font-mono">
                      <span>{a.works.toLocaleString("en-GB")} works</span>
                      <span>h-index {a.h_index ?? "?"}</span>
                      <span>last paper {a.last_active ?? "?"}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      )}
    </div>
  );
}

function ProfileView({ p, onOpen, onBack, hasResults }: { p: Profile; onOpen: (id: string) => void; onBack: () => void; hasResults: boolean }) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) => setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : x.length >= 5 ? x : [...x, id]));
  const works = new Map([...p.recent, ...p.most_cited].map((w) => [w.id, w]));
  const totalRoles = p.roles.first + p.roles.middle + p.roles.last;

  return (
    <div className="space-y-6">
      {hasResults && (
        <button onClick={onBack} className="text-sm text-ink-3 hover:text-ink">
          ← Back to results
        </button>
      )}
      <header className="rounded-2xl border border-line bg-surface p-5 md:p-6">
        <div className="flex flex-wrap items-start gap-3">
          <div className="w-12 h-12 rounded-2xl bg-accent-soft text-accent-ink grid place-items-center text-lg font-semibold" aria-hidden="true">
            {p.name
              .split(/\s+/)
              .map((x) => x[0])
              .slice(0, 2)
              .join("")}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-semibold tracking-tight">{p.name}</h2>
            <p className="text-sm text-ink-2">{p.institutions.map((i) => i.name).slice(0, 3).join(" · ") || "Institution unknown"}</p>
            <p className="text-xs text-ink-3 mt-1">
              Institutions as recorded by OpenAlex; check their homepage for the current one.
              {p.orcid && (
                <>
                  {" "}
                  <a href={p.orcid} target="_blank" rel="noreferrer" className="text-accent-ink hover:underline">
                    ORCID profile
                  </a>
                </>
              )}
            </p>
          </div>
        </div>
        <dl className="mt-5 grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
          {[
            ["Works", p.works.toLocaleString("en-GB")],
            ["Citations", p.cited_by.toLocaleString("en-GB")],
            ["h-index", p.h_index ?? "?"],
            ["Last paper", p.last_active ?? "?"],
            [`Papers since ${p.since}`, p.recent.length >= 25 ? "25+" : p.recent.length],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-xl bg-surface-2 px-2 py-2.5">
              <dt className="text-[0.62rem] uppercase tracking-wider text-ink-3">{k}</dt>
              <dd className="mt-0.5 font-mono font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        {totalRoles > 0 && (
          <p className="mt-3 text-sm text-ink-2">
            In their recent papers they are usually the{" "}
            <strong>{p.roles.last >= p.roles.first && p.roles.last >= p.roles.middle ? "last author" : p.roles.first >= p.roles.middle ? "first author" : "middle author"}</strong>{" "}
            (last {p.roles.last}, first {p.roles.first}, middle {p.roles.middle}).{" "}
            {p.roles.last >= p.roles.first && <span className="text-ink-3">In many fields the last author leads the lab.</span>}
          </p>
        )}
        <Activity yearly={p.yearly} />
      </header>

      <Section title="What they work on now" note={`Topics of papers since ${p.since}, against their earlier papers. From OpenAlex's classification.`}>
        <div className="flex flex-wrap gap-2">
          {p.topics.map((t) => (
            <span key={t.id} className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
              {t.name}
              <span className={`rounded-full border px-2 py-0.5 text-[0.65rem] font-medium ${TREND[t.trend].cls}`}>{TREND[t.trend].label}</span>
              {t.trend !== "dropped" && <span className="font-mono text-xs text-ink-3">{Math.round(t.recent_share * 100)}%</span>}
            </span>
          ))}
        </div>
      </Section>

      <BriefPanel p={p} works={works} />

      {p.open_problems.length > 0 && (
        <Section title="In their words: what is still open" note="Sentences copied from the abstracts of their recent papers. No AI involved.">
          <ul className="space-y-2">
            {p.open_problems.map((o) => (
              <li key={o.work} className="rounded-xl border border-line bg-surface p-3">
                <p className="text-sm leading-relaxed">“{o.text}”</p>
                <a href={`#w-${o.work}`} className="mt-1 block text-xs text-ink-3 hover:text-accent-ink">
                  {o.title} ({o.year})
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={`Recent papers (since ${p.since})`} note="Pick up to five and open them in the workspace to read, ask Copilot, and compare them in the matrix.">
        <div className="sticky top-14 z-10 -mx-1 mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-bg/90 backdrop-blur px-1 py-2">
          <Link
            href={picked.length ? `/workspace?open=${picked.join(",")}` : "#"}
            aria-disabled={!picked.length}
            className={`h-9 inline-flex items-center rounded-lg px-3 text-sm font-medium ${
              picked.length ? "bg-accent text-white hover:opacity-90" : "bg-surface-2 text-ink-3 pointer-events-none"
            }`}
          >
            Open {picked.length || ""} in workspace →
          </Link>
          <span className="text-xs text-ink-3">{picked.length}/5 selected</span>
        </div>
        <ul className="space-y-2">
          {p.recent.map((w) => (
            <WorkCard key={w.id} w={w} authorId={p.id} picked={picked.includes(w.id)} onPick={() => toggle(w.id)} onOpenPerson={onOpen} />
          ))}
        </ul>
      </Section>

      <div className="grid md:grid-cols-2 gap-6">
        <Section title="Most cited">
          <ol className="space-y-2">
            {p.most_cited.map((w) => (
              <li key={w.id} className="text-sm">
                <Link href={`/paper/${w.id}`} className="font-medium hover:text-accent-ink">
                  {w.title}
                </Link>
                <span className="block text-xs text-ink-3">
                  {w.year} · {w.cited_by.toLocaleString("en-GB")} citations
                </span>
              </li>
            ))}
          </ol>
        </Section>
        <Section title="Works most with" note="Co-authors in the last six years. Click to open their profile.">
          <div className="flex flex-wrap gap-1.5">
            {p.collaborators.map((c) => (
              <button
                key={c.id}
                onClick={() => onOpen(c.id)}
                className="rounded-full border border-line bg-surface px-3 py-1 text-sm hover:border-ink-3"
              >
                {c.name} <span className="font-mono text-xs text-ink-3">{c.count}</span>
              </button>
            ))}
          </div>
          {p.affiliations.length > 0 && (
            <>
              <h4 className="mt-5 text-xs font-semibold uppercase tracking-wider text-ink-3">Affiliations over time</h4>
              <ul className="mt-2 space-y-1 text-sm text-ink-2">
                {p.affiliations.map((a) => (
                  <li key={a.name + a.from}>
                    <span className="font-mono text-xs text-ink-3">{a.from === a.to ? a.to : `${a.from}–${a.to}`}</span> {a.name}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">{title}</h3>
      {note && <p className="mt-1 text-xs text-ink-3">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Activity({ yearly }: { yearly: Profile["yearly"] }) {
  const pts = yearly.slice(-15);
  if (pts.length < 2) return null;
  const max = Math.max(...pts.map((p) => p.works), 1);
  return (
    <div className="mt-5">
      <p className="text-[0.62rem] uppercase tracking-wider text-ink-3">Papers per year</p>
      <div className="mt-2 flex items-end gap-1 h-16" role="img" aria-label={pts.map((p) => `${p.year}: ${p.works}`).join(", ")}>
        {pts.map((p) => (
          <div key={p.year} className="flex-1 flex flex-col items-center gap-1" title={`${p.year}: ${p.works} papers, ${p.cited_by.toLocaleString("en-GB")} citations`}>
            <div className="w-full rounded-t bg-accent/70" style={{ height: `${Math.max(4, (p.works / max) * 52)}px` }} />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[0.62rem] font-mono text-ink-3 mt-1">
        <span>{pts[0].year}</span>
        <span>{pts.at(-1)!.year}</span>
      </div>
    </div>
  );
}

function WorkCard({
  w,
  authorId,
  picked,
  onPick,
  onOpenPerson,
}: {
  w: Work;
  authorId: string;
  picked: boolean;
  onPick: () => void;
  onOpenPerson: (id: string) => void;
}) {
  const [more, setMore] = useState(false);
  const others = w.authors.filter((a) => a.id !== authorId).slice(0, 5);
  return (
    <li id={`w-${w.id}`} className={`rounded-2xl border bg-surface p-4 scroll-mt-32 ${picked ? "border-accent" : "border-line"}`}>
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={picked} onChange={onPick} aria-label={`Select ${w.title}`} className="mt-1 w-4 h-4 accent-[var(--accent)]" />
        <div className="min-w-0 flex-1">
          <Link href={`/paper/${w.id}`} className="font-medium leading-snug hover:text-accent-ink">
            {w.title}
          </Link>
          <p className="mt-0.5 text-xs text-ink-3">
            {[w.date || w.year, w.venue, `${w.cited_by.toLocaleString("en-GB")} citations`].filter(Boolean).join(" · ")}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[0.68rem]">
            {w.position && <span className="rounded-full border border-line px-2 py-0.5 text-ink-2">{w.position} author</span>}
            {w.preprint && <span className="rounded-full border border-warn/30 bg-warn-soft text-warn px-2 py-0.5">Preprint</span>}
            {w.retracted && <span className="rounded-full border border-bad/30 bg-bad-soft text-bad px-2 py-0.5">Retracted</span>}
            {w.oa_url && (
              <a href={w.oa_url} target="_blank" rel="noreferrer" className="rounded-full border border-good/30 bg-good-soft text-good px-2 py-0.5">
                Free to read
              </a>
            )}
            {w.topic && <span className="text-ink-3">{w.topic}</span>}
          </div>
          {others.length > 0 && (
            <p className="mt-1.5 text-xs text-ink-3">
              With{" "}
              {others.map((a, i) => (
                <span key={a.id}>
                  {i > 0 && ", "}
                  <button onClick={() => onOpenPerson(a.id)} className="hover:text-accent-ink hover:underline">
                    {a.name}
                  </button>
                </span>
              ))}
              {w.n_authors > others.length + 1 && ` and ${w.n_authors - others.length - 1} more`}
            </p>
          )}
          {w.abstract && (
            <>
              <p className={`mt-2 text-sm text-ink-2 leading-relaxed ${more ? "" : "line-clamp-2"}`}>{w.abstract}</p>
              <button onClick={() => setMore(!more)} className="text-xs text-accent-ink mt-1">
                {more ? "Less" : "Read abstract"}
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function BriefPanel({ p, works }: { p: Profile; works: Map<string, Work> }) {
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<BriefResult | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const run = async () => {
    abort.current?.abort();
    const ctl = (abort.current = new AbortController());
    setBusy(true);
    setErr("");
    setRes(null);
    try {
      setRes(await fetchBrief(p.id, idea, ctl.signal));
    } catch (e) {
      if (!ctl.signal.aborted) setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      if (!ctl.signal.aborted) setBusy(false);
    }
  };

  const b = res?.brief;
  return (
    <section className="rounded-2xl border border-accent/30 bg-accent-soft/40 p-5">
      <h3 className="font-semibold">Brief me on {p.name.split(" ")[0]}&rsquo;s work</h3>
      <p className="mt-1 text-sm text-ink-2">
        An AI agent reads the abstracts of their recent papers. Every statement cites those papers; anything it cannot back
        up is removed in code before you see it.
      </p>
      <label htmlFor="brief-idea" className="mt-3 block text-sm font-medium">
        Your research idea <span className="font-normal text-ink-3">(optional, makes the brief about fit)</span>
      </label>
      <textarea
        id="brief-idea"
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        maxLength={2000}
        rows={3}
        placeholder="e.g. Teaching household robots new manipulation tasks from a few human videos, with safety constraints"
        className="mt-1.5 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent resize-y"
      />
      <button onClick={run} disabled={busy} className="mt-2 h-10 rounded-xl bg-accent text-white font-medium px-5 hover:opacity-90 disabled:opacity-50">
        {busy ? "Reading their papers…" : idea.trim() ? "Where does my idea fit?" : "Brief me"}
      </button>
      {busy && (
        <div className="mt-4">
          <Working
            typical="Usually 20 to 60 seconds."
            steps={["Reading the abstracts of up to 18 recent papers", "Writing the brief, citing a paper for every statement", "Checking every citation and number in code"]}
          />
        </div>
      )}
      {err && <p className="mt-3 text-sm text-bad">{err}</p>}
      {res && !b && <p className="mt-3 text-sm text-ink-2">Their recent papers have no abstracts on record, so there is nothing to brief from.</p>}
      {b && (
        <div className="mt-5 space-y-5">
          {b.agenda.length > 0 && (
            <div className="grid sm:grid-cols-2 gap-3">
              {b.agenda.map((t) => (
                <div key={t.name} className="rounded-xl border border-line bg-surface p-4">
                  <p className="font-semibold">{t.name}</p>
                  <p className="mt-1 text-sm text-ink-2 leading-relaxed">{t.summary}</p>
                  <Cites ids={t.works} works={works} />
                </div>
              ))}
            </div>
          )}
          {b.direction && <Points title="Where their focus is moving" items={[b.direction]} works={works} />}
          <Points title="Where your idea meets their work" items={b.overlap} works={works} tone="good" />
          <Points title="What they leave open that you could take on" items={b.gaps} works={works} tone="vision" />
          {b.read_first.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-3">Read these first</h4>
              <ol className="mt-2 space-y-2">
                {b.read_first.map((r, i) => (
                  <li key={r.work} className="flex gap-3 rounded-xl border border-line bg-surface p-3">
                    <span className="font-mono text-sm text-accent-ink">{i + 1}</span>
                    <div className="text-sm">
                      <a href={`#w-${r.work}`} className="font-medium hover:text-accent-ink">
                        {works.get(r.work)?.title ?? r.work}
                      </a>
                      <p className="text-ink-2 mt-0.5">{r.why}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <Points title="Specific things you could mention when you write" items={b.talking_points} works={works} />
          <p className="text-xs text-ink-3">
            Read {res.papers_read} abstracts. {res.verification.kept} statements kept
            {res.verification.removed.length > 0 && `, ${res.verification.removed.length} removed because they cited no paper or used a number the papers do not contain`}
            . Abstracts are not the whole paper: read the papers before you rely on a point.{res.cached ? " (Cached result.)" : ""}
          </p>
        </div>
      )}
    </section>
  );
}

function Points({ title, items, works, tone }: { title: string; items: BriefPoint[]; works: Map<string, Work>; tone?: "good" | "vision" }) {
  if (!items.length) return null;
  const bar = tone === "good" ? "var(--good)" : tone === "vision" ? "var(--vision)" : "var(--accent)";
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-3">{title}</h4>
      <ul className="mt-2 space-y-2">
        {items.map((x, i) => (
          <li key={i} className="rounded-xl border border-line bg-surface p-3 text-sm leading-relaxed" style={{ borderLeft: `3px solid ${bar}` }}>
            {x.text}
            <Cites ids={x.works} works={works} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Cites({ ids, works }: { ids: string[]; works: Map<string, Work> }) {
  return (
    <span className="mt-2 flex flex-wrap gap-1">
      {ids.map((id) => {
        const w = works.get(id);
        return (
          <a
            key={id}
            href={`#w-${id}`}
            title={w?.title}
            className="rounded-md bg-surface-2 border border-line px-1.5 py-0.5 text-[0.68rem] text-ink-2 hover:text-accent-ink max-w-[16rem] truncate"
          >
            {w ? `${w.title.slice(0, 40)}${w.title.length > 40 ? "…" : ""} (${w.year})` : id}
          </a>
        );
      })}
    </span>
  );
}
