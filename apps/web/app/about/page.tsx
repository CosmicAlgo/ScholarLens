import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How it works",
  description: "How ScholarLens measures research trends, checks trust, and keeps AI briefings honest.",
};

export default function About() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-10 leading-relaxed">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">How ScholarLens works</h1>
        <p className="mt-3 text-ink-2">
          Three rules: numbers are computed, never generated; every claim cites a source; and each AI agent has exactly
          one job.
        </p>
      </header>

      <section id="trends">
        <h2 className="text-xl font-semibold">Trends are measured as share, not raw counts</h2>
        <p className="mt-2 text-ink-2">
          The number of papers published grows about 4–5% every year, so nearly every topic&rsquo;s raw count goes up.
          ScholarLens divides each year&rsquo;s papers on a topic by all papers published that year (articles,
          preprints and reviews with an abstract), then fits a growth rate to that share. A topic is{" "}
          <em>growing</em> only if it outpaces science as a whole.
        </p>
        <ul className="mt-3 list-disc pl-5 text-ink-2 space-y-1">
          <li>The current year is shown dashed and excluded from the maths, because indexing lags by months.</li>
          <li>
            <strong>Peaked</strong> means the share rose, hit a high at least two years ago, and has since fallen clearly.
          </li>
          <li>Topics with fewer than 30 papers in the window are marked &ldquo;too few papers&rdquo; rather than guessed.</li>
          <li>Counts come from the full OpenAlex catalogue (250M+ works), matched on titles and abstracts.</li>
        </ul>
      </section>

      <section id="trust">
        <h2 className="text-xl font-semibold">Trust badges</h2>
        <p className="mt-2 text-ink-2">
          Papers OpenAlex marks as <strong>retracted</strong> are flagged in red everywhere, and AI briefings are not
          allowed to cite them. <strong>Preprints</strong> (not yet peer reviewed) are flagged in amber, and a report
          warns you when much of its evidence is unreviewed. When a preprint and its published version both exist, we
          show the published one.
        </p>
      </section>

      <section id="agents">
        <h2 className="text-xl font-semibold">The agents behind Ask</h2>
        <p className="mt-2 text-ink-2">
          A <strong>Planner</strong> turns your question into topics. In parallel, a <strong>Trend Analyst</strong>{" "}
          explains the computed trend numbers, while a <strong>Scout</strong> retrieves papers, a{" "}
          <strong>Cartographer</strong> names the sub-areas found by clustering, and a <strong>Trust Auditor</strong>{" "}
          checks for retractions. A <strong>Writer</strong> drafts the briefing using only that material, and a{" "}
          <strong>Verifier</strong> (plain code, no AI) deletes any sentence that doesn&rsquo;t cite a real paper, metric
          or cluster. You can see everything it removed.
        </p>
      </section>

      <section id="limits">
        <h2 className="text-xl font-semibold">Limits</h2>
        <ul className="mt-2 list-disc pl-5 text-ink-2 space-y-1">
          <li>Keyword matching can miss papers that use different words for the same idea, or catch unrelated ones.</li>
          <li>The paper search covers a growing indexed subset, not every paper ever published.</li>
          <li>AI briefings can still misread a source. Check the cited papers before relying on a claim.</li>
        </ul>
      </section>

      <section id="privacy">
        <h2 className="text-xl font-semibold">Privacy</h2>
        <ul className="mt-2 list-disc pl-5 text-ink-2 space-y-1">
          <li>No account is needed. We don&rsquo;t ask for your name or email.</li>
          <li>
            Your browser gets a random ID so we can apply the daily limit on AI briefings. Questions you ask are stored
            with that ID to monitor cost and quality.
          </li>
          <li>
            Questions are sent to our AI provider (Google Gemini) to write the briefing. We use Google&rsquo;s free
            API tier, under which Google may use these prompts to improve its products, so please don&rsquo;t include
            personal or confidential information.
          </li>
          <li>
            We use privacy-friendly product analytics (PostHog, EU hosting) to count page views and feature use. No session
            recordings, and we honour Do Not Track.
          </li>
        </ul>
      </section>
    </div>
  );
}
