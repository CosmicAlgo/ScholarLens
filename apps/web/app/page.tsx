import Link from "next/link";
import { TopicSearch } from "@/components/topic-search";
import { topicSlug } from "@/lib/api";

const EXAMPLES = [
  "retrieval augmented generation",
  "diffusion models",
  "CRISPR base editing",
  "microplastics",
  "long covid",
  "perovskite solar cells",
  "federated learning",
  "blockchain",
];

const AGENTS = [
  ["Planner", "Turns your question into searchable topics"],
  ["Trend Analyst", "Explains numbers computed in code"],
  ["Scout", "Finds the papers that matter"],
  ["Cartographer", "Maps sub-areas and spots emerging ones"],
  ["Trust Auditor", "Flags retracted and unreviewed work"],
  ["Writer", "Drafts a briefing from evidence only"],
  ["Verifier", "Deletes any claim without a real source"],
];

export default function Home() {
  return (
    <div className="mx-auto max-w-5xl px-4">
      <section className="pt-16 pb-12 md:pt-24 md:pb-16 max-w-3xl">
        <p className="text-sm font-medium text-accent-ink">Research trend intelligence · free beta</p>
        <h1 className="mt-3 text-4xl md:text-5xl font-semibold tracking-tight leading-[1.1]">
          See where a research field is <em className="not-italic text-accent">really</em> heading.
        </h1>
        <p className="mt-4 text-lg text-ink-2 max-w-2xl">
          Track how topics rise, peak and fade across 250M+ papers. Growth is measured against all of science, so
          &ldquo;growing&rdquo; means something. AI briefings cite a source for every claim, or the claim is cut.
        </p>
        <div className="mt-8 max-w-2xl">
          <TopicSearch autoFocus />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {EXAMPLES.map((t) => (
            <Link
              key={t}
              href={`/topic/${topicSlug(t)}`}
              className="text-sm rounded-full border border-line bg-surface px-3 py-1 text-ink-2 hover:border-ink-3 hover:text-ink"
            >
              {t}
            </Link>
          ))}
        </div>
      </section>

      <section className="grid md:grid-cols-3 gap-4 pb-16">
        <Feature title="Honest trends" href="/about#trends">
          Most tools show raw paper counts, which rise for almost everything because science grows ~4–5% a year. We
          measure a topic&rsquo;s <strong>share</strong> of all papers, so you see real momentum, peaks and declines.
        </Feature>
        <Feature title="Compare fields" href="/compare">
          Put up to four topics side by side on one scale. Is your field gaining on its neighbour, or losing ground?
        </Feature>
        <Feature title="Trust badges" href="/about#trust">
          Retracted papers and unreviewed preprints are flagged wherever they appear, including inside AI reports.
        </Feature>
      </section>

      <section className="pb-20">
        <div className="rounded-2xl border border-line bg-surface p-6 md:p-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Ask a question, get a cited briefing</h2>
              <p className="mt-2 text-ink-2 max-w-2xl">
                Seven agents, each with one job. Numbers are computed in code, never written by the model. You see
                exactly which claims the verifier removed.
              </p>
            </div>
            <Link href="/ask" className="rounded-xl bg-ink text-bg px-4 h-11 inline-flex items-center font-medium hover:opacity-90">
              Try Ask →
            </Link>
          </div>
          <ol className="mt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {AGENTS.map(([name, job], i) => (
              <li key={name} className="rounded-xl bg-surface-2 p-3">
                <div className="text-xs text-ink-3 font-mono">{String(i + 1).padStart(2, "0")}</div>
                <div className="font-medium">{name}</div>
                <div className="text-sm text-ink-2">{job}</div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}

function Feature({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="block rounded-2xl border border-line bg-surface p-5 hover:border-ink-3">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-ink-2 leading-relaxed">{children}</p>
    </Link>
  );
}
