import Link from "next/link";

const FEATURES: [string, string, string][] = [
  ["Read with an agent beside you", "Open any open-access paper or your own PDF. Select a passage to ask, explain, verify or find related work.", "▤"],
  ["It sees the figures", "A vision model reads plots, tables, flowcharts and architecture diagrams, which text extraction misses. Cut out any figure and ask about it.", "◩"],
  ["Map the connections", "See how your papers link: shared foundations they all cite, key references, and the work that built on them. Your ideas sit on the same map.", "⌘"],
  ["Evidence matrix", "Problem, method, data, findings and limits for every open paper in one table. Each cell links to the page it came from. Export to CSV.", "▦"],
  ["Ideas, checked for novelty", "Brainstormed ideas start from cited limitations, then a second agent searches 250M+ works for anything that already did them.", "✦"],
  ["Verify a claim", "Paste or highlight a claim. Get supported, contradicted or mixed, with the evidence on each side and how strong it is.", "✓"],
];

const AGENTS: [string, string][] = [
  ["Master", "plans which workers to send"],
  ["read_paper", "finds passages, with pages"],
  ["read_figures", "vision on figures and tables"],
  ["search_literature", "searches 250M+ works"],
  ["topic_trend", "computes a field's momentum"],
  ["Writer", "answers only from evidence"],
  ["Verifier", "checks every citation in code"],
  ["Novelty", "tests ideas against prior work"],
];

export default function Home() {
  return (
    <div className="mx-auto max-w-5xl px-4">
      <section className="pt-16 pb-12 md:pt-24 md:pb-16 max-w-3xl">
        <p className="text-sm font-medium text-accent-ink">The research workspace · free beta</p>
        <h1 className="mt-3 text-4xl md:text-6xl font-semibold tracking-tight leading-[1.05]">
          Read, question and build on research, <span className="text-accent">with every claim traced to a page.</span>
        </h1>
        <p className="mt-5 text-lg text-ink-2 max-w-2xl">
          A team of AI agents reads your papers with you, text and figures alike, searches the literature, and answers
          with citations that open the exact page. Nothing is stated without a source you can check.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/workspace" className="rounded-xl bg-accent text-white font-medium px-5 h-12 inline-flex items-center hover:opacity-90">
            Open the workspace →
          </Link>
          <Link
            href="/trends"
            className="rounded-xl border border-line bg-surface font-medium px-5 h-12 inline-flex items-center hover:border-ink-3"
          >
            Explore research trends
          </Link>
        </div>
        <p className="mt-4 text-sm text-ink-3">No account needed. Your own PDFs stay in your browser.</p>
      </section>

      <section className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-16">
        {FEATURES.map(([title, body, icon]) => (
          <div key={title} className="rounded-2xl border border-line bg-surface p-5">
            <div className="w-9 h-9 rounded-xl bg-accent-soft text-accent-ink grid place-items-center text-lg" aria-hidden="true">
              {icon}
            </div>
            <h2 className="mt-3 font-semibold">{title}</h2>
            <p className="mt-1.5 text-sm text-ink-2 leading-relaxed">{body}</p>
          </div>
        ))}
      </section>

      <section className="pb-16">
        <div className="rounded-2xl border border-line bg-surface p-6 md:p-8">
          <h2 className="text-2xl font-semibold tracking-tight">How a question gets answered</h2>
          <p className="mt-2 text-ink-2 max-w-2xl">
            A master agent plans the work and sends specialist workers in parallel. Numbers are computed in code, figure
            readings are labelled as such, and the verifier flags any citation that isn&rsquo;t in the evidence.
          </p>
          <ol className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
            {AGENTS.map(([name, job], i) => (
              <li key={name} className="rounded-xl bg-surface-2 p-3">
                <div className="text-xs text-ink-3 font-mono">{String(i + 1).padStart(2, "0")}</div>
                <div className="font-medium font-mono text-sm break-all">{name}</div>
                <div className="text-sm text-ink-2">{job}</div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="grid md:grid-cols-3 gap-4 pb-20">
        <Link href="/trends" className="block rounded-2xl border border-line bg-surface p-6 hover:border-ink-3">
          <h2 className="font-semibold text-lg">Trends →</h2>
          <p className="mt-2 text-sm text-ink-2 leading-relaxed">
            Is your field really growing? We measure its share of all papers, not raw counts, so real peaks and declines
            show.
          </p>
        </Link>
        <Link href="/ask" className="block rounded-2xl border border-line bg-surface p-6 hover:border-ink-3">
          <h2 className="font-semibold text-lg">Briefings →</h2>
          <p className="mt-2 text-sm text-ink-2 leading-relaxed">
            Ask a question about a field and get a cited report: momentum, key papers, emerging sub-areas and trust flags.
          </p>
        </Link>
        <Link href="/verify" className="block rounded-2xl border border-line bg-surface p-6 hover:border-ink-3">
          <h2 className="font-semibold text-lg">Verify →</h2>
          <p className="mt-2 text-sm text-ink-2 leading-relaxed">
            Catch fabricated or retracted references, see which papers support or dispute a claim, and follow a famous
            number to see where it changed.
          </p>
        </Link>
      </section>
    </div>
  );
}
