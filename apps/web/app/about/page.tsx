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

      <section id="verify">
        <h2 className="text-xl font-semibold">How Verify decides</h2>
        <ul className="mt-2 list-disc pl-5 text-ink-2 space-y-1">
          <li>
            <strong>Citation Check</strong> looks each reference up by DOI and title in OpenAlex, then Semantic Scholar. Title,
            year and first author are compared in code, and retractions come from OpenAlex. An AI agent only splits the list
            into entries, and every title it returns must appear in your text.
          </li>
          <li>
            <strong>Claim Court</strong> reads the sentences in which other papers cite the source (from Semantic Scholar).
            An AI agent labels each one as supporting, disputing or mentioning, and must quote the words that justify the
            label. Labels whose quote is not in the sentence are downgraded. The verdict is counted, not written.
          </li>
          <li>
            <strong>Citation Telephone</strong> follows a finding through two generations of citing sentences. The agent only
            picks the retellings and copies their words; numbers are compared in code (kept, rounded within 3%, changed or
            dropped).
          </li>
          <li>
            Topic trends follow the meaning a name has now when it has changed: early &ldquo;transformers&rdquo; papers were
            mostly power engineering, recent ones mostly computer science. Compare lets you switch fields.
          </li>
        </ul>
      </section>

      <section id="film">
        <h2 className="text-xl font-semibold">Paper Film and Researchers</h2>
        <ul className="mt-2 list-disc pl-5 text-ink-2 space-y-1">
          <li>
            <strong>Paper Film</strong>: reader agents read the whole paper in parts and take notes that cite passages; a
            director agent turns them into scenes. Code then cuts any line without a source or with a number the cited
            passage does not contain, and any quote, key number or figure that is not in the paper. Figures are the
            paper&rsquo;s own, cropped around their printed captions. Narration uses your browser&rsquo;s voice.
          </li>
          <li>
            <strong>Researchers</strong>: profiles, topics, collaborators and the &ldquo;still open&rdquo; quotes come straight
            from OpenAlex, with no AI. The optional brief reads the abstracts of their recent papers; every statement must cite one
            of them, and numbers must appear in the cited abstract. OpenAlex sometimes splits one person into several
            records, so check the institution and topics before relying on a profile.
          </li>
        </ul>
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
            PDFs you upload stay in your browser (IndexedDB). They are never stored on our servers. When you ask Copilot,
            only the passages it needs (and any figure you cut out) are sent to answer that one question.
          </li>
          <li>
            Because your PDFs live in your browser, clearing site data or a long absence can remove them. Use{" "}
            <strong>Back up</strong> in the Library to save a file with your papers, notes and PDFs, and{" "}
            <strong>Restore</strong> to load it on any device.
          </li>
          <li>
            We use privacy-friendly product analytics (PostHog, EU hosting) to count page views and feature use. No session
            recordings, and we honour Do Not Track.
          </li>
        </ul>
      </section>

      <section id="use">
        <h2 className="text-xl font-semibold">Fair use and limits</h2>
        <ul className="mt-2 list-disc pl-5 text-ink-2 space-y-1">
          <li>ScholarLens is for reading and reasoning about research. Requests outside that, or for harmful help, are declined.</li>
          <li>
            Only upload documents you have the right to use. Don&rsquo;t upload confidential, personal or unpublished material
            you can&rsquo;t share with Google&rsquo;s free AI tier.
          </li>
          <li>
            To keep it free for everyone there are daily limits on AI features, per browser and per network, plus a request
            rate limit. Reading, search, trends and the citation map are not limited in the same way.
          </li>
          <li>Instructions hidden inside papers are treated as text to analyse, never as commands to the assistant.</li>
          <li>
            Every AI answer is checked in code: citations must exist, and numbers must appear in the source they cite.
            Still, check the cited page before you rely on a claim.
          </li>
        </ul>
      </section>
    </div>
  );
}
