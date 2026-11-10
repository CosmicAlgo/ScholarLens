import type { Metadata } from "next";
import Link from "next/link";
import { TopicSearch } from "@/components/topic-search";
import { topicSlug } from "@/lib/api";

export const metadata: Metadata = {
  title: "Research trends",
  description:
    "Is a research field really growing? See its share of all published papers over time, its peak, and the papers that matter.",
};

const GROUPS: [string, string[]][] = [
  ["AI and computing", ["retrieval augmented generation", "diffusion models", "federated learning", "graph neural networks"]],
  ["Life sciences", ["CRISPR base editing", "long covid", "single cell RNA sequencing", "gut microbiome"]],
  ["Physical sciences", ["perovskite solar cells", "microplastics", "solid state batteries", "quantum error correction"]],
  ["Check the hype", ["blockchain", "deep belief networks", "zika virus", "graphene"]],
];

export default function TrendsPage() {
  return (
    <div className="mx-auto max-w-5xl px-4">
      <section className="pt-12 pb-10 md:pt-16 max-w-3xl">
        <p className="text-sm font-medium text-accent-ink">Trends</p>
        <h1 className="mt-2 text-3xl md:text-5xl font-semibold tracking-tight leading-[1.08]">
          Is a field really growing, or just riding the growth of science?
        </h1>
        <p className="mt-4 text-ink-2 text-lg max-w-2xl">
          Raw paper counts rise for almost everything, because science grows about 4–5% a year. We measure a topic&rsquo;s{" "}
          <strong>share</strong> of all papers published, across 250M+ works in OpenAlex, so peaks and declines show up.
        </p>
        <div className="mt-8 max-w-2xl">
          <TopicSearch />
        </div>
      </section>

      <section className="grid sm:grid-cols-2 gap-4 pb-10">
        {GROUPS.map(([group, topics]) => (
          <div key={group} className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-3">{group}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {topics.map((t) => (
                <Link
                  key={t}
                  href={`/topic/${topicSlug(t)}`}
                  className="text-sm rounded-full border border-line bg-surface-2 px-3 py-1 text-ink-2 hover:border-ink-3 hover:text-ink"
                >
                  {t}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="grid md:grid-cols-3 gap-4 pb-20">
        <Card title="Share, not counts" href="/about#trends">
          Every chart is papers per million published that year, so a field that only keeps pace with science reads as flat.
        </Card>
        <Card title="Compare fields" href="/compare">
          Put up to four topics on one scale. Is your field gaining on its neighbour, or losing ground?
        </Card>
        <Card title="Read what matters" href="/workspace">
          Each topic lists its key papers with trust flags. Open any of them in the workspace to read, highlight and ask.
        </Card>
      </section>
    </div>
  );
}

function Card({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="block rounded-2xl border border-line bg-surface p-5 hover:border-ink-3">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-ink-2 leading-relaxed">{children}</p>
    </Link>
  );
}
