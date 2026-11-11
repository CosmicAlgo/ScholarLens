"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Working } from "@/components/verify/shared";
import { getDoc } from "@/lib/docstore";
import { type Film, type FilmScene, type FilmVisual, filmScript, makeFilm, savedFilm, saveFilm } from "@/lib/film";
import type { OpenPaper } from "@/lib/workspace";

const FilmFigure = dynamic(() => import("./film-figure"), { ssr: false });

const KIND: Record<FilmScene["kind"], string> = {
  intro: "Why it matters",
  problem: "The problem",
  idea: "The idea",
  method: "How it works",
  result: "What they found",
  limits: "The limits",
  takeaway: "The takeaway",
};
const RATES = [0.9, 1, 1.15, 1.3];

/** Paper Film for one paper: make it, then play it. */
export function FilmView({
  p,
  file,
  onCite,
}: {
  p: OpenPaper;
  file: string | { data: Uint8Array } | null;
  onCite: (page: number, text?: string) => void;
}) {
  const [film, setFilm] = useState<Film | null>(() => savedFilm(p.id));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const make = async () => {
    abort.current?.abort();
    const ctl = (abort.current = new AbortController());
    setBusy(true);
    setErr("");
    try {
      const passages = p.local ? (await getDoc(p.id))?.passages : undefined;
      if (p.local && !passages?.length) throw new Error("This PDF has no readable text on this device. Re-attach it and try again.");
      const f = await makeFilm(p.id, p.title, passages, ctl.signal);
      saveFilm(p.id, f);
      setFilm(f);
    } catch (e) {
      if (!ctl.signal.aborted) setErr(e instanceof Error ? e.message : "Could not make the film.");
    } finally {
      if (!ctl.signal.aborted) setBusy(false);
    }
  };

  if (film && film.scenes.length) return <Player film={film} paperTitle={p.title} file={file} onCite={onCite} onRemake={() => setFilm(null)} />;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-5 py-8 space-y-4">
        <div className="rounded-2xl overflow-hidden border border-line">
          <div className="relative aspect-video bg-[#0b0f1a] text-white grid place-items-center p-6 text-center">
            <div className="film-glow absolute inset-0" style={{ background: "radial-gradient(60% 60% at 50% 40%, rgba(57,135,229,0.35), transparent 70%)" }} />
            <div className="relative">
              <p className="text-xs uppercase tracking-[0.2em] text-white/60">Paper Film</p>
              <p className="mt-2 text-xl md:text-2xl font-semibold leading-snug line-clamp-3">{p.title}</p>
            </div>
          </div>
          <div className="p-5 bg-surface">
            <p className="text-sm text-ink-2 leading-relaxed">
              AI agents read the whole paper in parts, take notes, and direct a short narrated film of it: why it matters, the
              idea, how it works, what they found and the limits, using the paper&rsquo;s own figures. Every spoken line cites
              the page it comes from; lines and visuals that fail the checks are cut, and you can see what was cut.
            </p>
            <button
              onClick={make}
              disabled={busy || file === null}
              className="mt-4 h-10 rounded-xl bg-accent text-white font-medium px-5 hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Making the film…" : "▶ Make the film"}
            </button>
            {file === null && <p className="mt-2 text-xs text-ink-3">A film needs the paper&rsquo;s full text. Attach its PDF first.</p>}
          </div>
        </div>
        {busy && (
          <Working
            typical="Usually 1 to 3 minutes: the whole paper is read, not just the abstract."
            steps={[
              "Reader agents each read one part of the paper and take cited notes",
              "A Director agent turns the notes into 6 to 9 scenes and picks a visual for each",
              "The Verifier checks every line, number, quote and figure against the paper, in code",
            ]}
          />
        )}
        {err && <div className="rounded-xl border border-bad/30 bg-bad-soft px-4 py-3 text-sm text-bad">{err}</div>}
      </div>
    </div>
  );
}

function Player({
  film,
  paperTitle,
  file,
  onCite,
  onRemake,
}: {
  film: Film;
  paperTitle: string;
  file: string | { data: Uint8Array } | null;
  onCite: (page: number, text?: string) => void;
  onRemake: () => void;
}) {
  const [scene, setScene] = useState(0);
  const [line, setLine] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [voice, setVoice] = useState(true);
  const [rate, setRate] = useState(1);
  const [panel, setPanel] = useState<"chapters" | "script" | "checks">("chapters");
  const stage = useRef<HTMLDivElement>(null);
  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;
  const sc = film.scenes[scene];
  const ln = sc.lines[Math.min(line, sc.lines.length - 1)];

  const advance = useCallback(() => {
    if (line + 1 < sc.lines.length) setLine(line + 1);
    else if (scene + 1 < film.scenes.length) {
      setScene(scene + 1);
      setLine(0);
    } else {
      setPlaying(false);
      setScene(0);
      setLine(0);
    }
  }, [line, scene, sc.lines.length, film.scenes.length]);

  // Narrate the current line, then move on. Speech can fail silently, so a timer is the backstop.
  useEffect(() => {
    if (!playing) return;
    const words = ln.text.split(/\s+/).length;
    const estimate = ((words / 2.6) * 1000) / rate + (line === 0 ? 900 : 350);
    let done = false;
    const next = () => {
      if (done) return;
      done = true;
      advance();
    };
    let timer: ReturnType<typeof setTimeout>;
    if (voice && canSpeak) {
      const u = new SpeechSynthesisUtterance(ln.text);
      u.rate = rate;
      u.lang = "en-US";
      const v = speechSynthesis.getVoices().find((x) => /en[-_](US|GB)/i.test(x.lang) && /natural|google|samantha|daniel|aria|jenny/i.test(x.name));
      if (v) u.voice = v;
      u.onend = () => setTimeout(next, line + 1 >= sc.lines.length ? 700 : 250);
      speechSynthesis.cancel();
      const start = setTimeout(() => speechSynthesis.speak(u), line === 0 ? 600 : 0);
      timer = setTimeout(next, estimate * 1.8 + 1500);
      return () => {
        done = true;
        clearTimeout(start);
        clearTimeout(timer);
        speechSynthesis.cancel();
      };
    }
    timer = setTimeout(next, estimate);
    return () => {
      done = true;
      clearTimeout(timer);
    };
  }, [playing, scene, line, voice, rate, ln.text, advance, canSpeak, sc.lines.length]);

  useEffect(() => () => void (canSpeak && speechSynthesis.cancel()), [canSpeak]);

  const go = (s: number) => {
    setScene(Math.max(0, Math.min(film.scenes.length - 1, s)));
    setLine(0);
  };

  const removed = film.verification.removed;
  const download = () => {
    const blob = new Blob([filmScript(film, paperTitle)], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "paper-film-script.md";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-3 sm:px-5 py-5 space-y-3">
        {/* Stage */}
        <div ref={stage} className="relative aspect-video rounded-2xl overflow-hidden bg-[#0b0f1a] text-white select-none" aria-live="polite">
          <div
            className="film-glow absolute inset-0 pointer-events-none"
            style={{ background: `radial-gradient(70% 70% at ${20 + scene * 9}% 30%, rgba(57,135,229,0.28), transparent 70%)` }}
          />
          <div className="absolute top-3 left-4 right-4 flex items-center gap-2 text-[0.7rem] uppercase tracking-[0.18em] text-white/60 z-10">
            <span className="font-mono">{String(scene + 1).padStart(2, "0")}</span>
            <span>{KIND[sc.kind]}</span>
          </div>
          <div key={scene} className="absolute inset-0 pt-10 pb-24 px-5 sm:px-10 flex flex-col">
            {sc.visual.type !== "title" && <h3 className="film-rise text-lg sm:text-2xl font-semibold leading-tight">{sc.heading}</h3>}
            <div className="flex-1 min-h-0 mt-3">
              <Visual v={sc.visual} film={film} paperTitle={paperTitle} file={file} />
            </div>
          </div>
          {/* Caption */}
          <div className="absolute bottom-0 inset-x-0 p-3 sm:p-4 bg-gradient-to-t from-black/85 via-black/60 to-transparent">
            <p key={`${scene}-${line}`} className="film-rise text-sm sm:text-base leading-snug max-w-3xl">
              {ln.text}{" "}
              <button
                onClick={() => {
                  setPlaying(false);
                  onCite(ln.page, ln.text);
                }}
                className="ml-1 align-middle rounded-md bg-white/15 hover:bg-white/30 px-1.5 py-0.5 text-[0.68rem] font-mono"
                title="Open this page in the PDF"
              >
                p. {ln.page}
              </button>
            </p>
          </div>
          {!playing && scene === 0 && line === 0 && (
            <button
              onClick={() => setPlaying(true)}
              className="absolute inset-0 grid place-items-center bg-black/25 hover:bg-black/15 transition-colors z-20"
              aria-label="Play the film"
            >
              <span className="w-16 h-16 rounded-full bg-white text-[#0b0f1a] grid place-items-center text-2xl shadow-xl">▶</span>
            </button>
          )}
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => go(scene - 1)} className="tool-btn px-2" aria-label="Previous scene">
            ⏮
          </button>
          <button onClick={() => setPlaying(!playing)} className="h-9 rounded-lg bg-accent text-white px-4 text-sm font-medium hover:opacity-90">
            {playing ? "❚❚ Pause" : "▶ Play"}
          </button>
          <button onClick={() => go(scene + 1)} className="tool-btn px-2" aria-label="Next scene">
            ⏭
          </button>
          <div className="flex-1 min-w-[8rem] flex gap-1" role="tablist" aria-label="Scenes">
            {film.scenes.map((s, i) => (
              <button
                key={i}
                role="tab"
                aria-selected={i === scene}
                title={`${i + 1}. ${s.heading}`}
                onClick={() => go(i)}
                className="flex-1 h-2 rounded-full overflow-hidden bg-surface-2"
              >
                <span
                  className="block h-full bg-accent transition-all"
                  style={{ width: i < scene ? "100%" : i === scene ? `${((line + 1) / s.lines.length) * 100}%` : "0%" }}
                />
              </button>
            ))}
          </div>
          {canSpeak && (
            <button onClick={() => setVoice(!voice)} className="tool-btn px-2 text-xs" aria-pressed={voice} title={voice ? "Narration on" : "Narration off (captions only)"}>
              {voice ? "🔊 Voice" : "🔇 Captions"}
            </button>
          )}
          <button onClick={() => setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length])} className="tool-btn px-2 text-xs font-mono" title="Speed">
            {rate}×
          </button>
          <button
            onClick={() => (document.fullscreenElement ? document.exitFullscreen() : stage.current?.requestFullscreen())?.catch(() => {})}
            className="tool-btn px-2"
            title="Full screen"
            aria-label="Full screen"
          >
            ⛶
          </button>
        </div>

        {/* Trust strip */}
        <p className="text-xs text-ink-3">
          Read {film.read.passages} passages in {film.read.parts} parts. {film.verification.lines_kept} narration lines, each traced to
          a page of the paper{removed.length > 0 ? `; ${removed.length} line(s) or visual(s) cut by the checks` : "; nothing had to be cut"}.
          Narration is in the AI&rsquo;s own words; flows and bullet points marked &ldquo;sketch&rdquo; are its summary, not the paper&rsquo;s.
          {film.cached ? " (Cached film.)" : ""}
        </p>

        {/* Panels */}
        <div className="rounded-2xl border border-line bg-surface">
          <div className="flex items-center gap-1 border-b border-line px-2 pt-2" role="tablist">
            {(
              [
                ["chapters", "Chapters"],
                ["script", "Script"],
                ["checks", `Checks${removed.length ? ` · ${removed.length} cut` : ""}`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                role="tab"
                aria-selected={panel === k}
                onClick={() => setPanel(k)}
                className={`rounded-t-lg px-3 py-1.5 text-xs font-medium ${panel === k ? "bg-surface-2 text-ink" : "text-ink-3 hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
            <span className="flex-1" />
            <button onClick={download} className="text-xs text-ink-3 hover:text-ink px-2">
              Download script
            </button>
            <button onClick={onRemake} className="text-xs text-ink-3 hover:text-ink px-2" title="Make a new film">
              Remake
            </button>
          </div>
          <div className="p-3 max-h-80 overflow-y-auto">
            {panel === "chapters" && (
              <ol className="space-y-1">
                {film.scenes.map((s, i) => (
                  <li key={i}>
                    <button
                      onClick={() => go(i)}
                      className={`w-full text-left rounded-lg px-3 py-2 text-sm flex gap-3 ${i === scene ? "bg-accent-soft text-accent-ink" : "hover:bg-surface-2"}`}
                    >
                      <span className="font-mono text-xs pt-0.5 w-5">{i + 1}</span>
                      <span className="flex-1">
                        <span className="font-medium">{s.heading}</span>
                        <span className="block text-xs text-ink-3">{KIND[s.kind]}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {panel === "script" && (
              <div className="space-y-4 text-sm leading-relaxed">
                {film.scenes.map((s, i) => (
                  <div key={i}>
                    <p className="font-semibold">
                      {i + 1}. {s.heading}
                    </p>
                    {s.lines.map((l, j) => (
                      <p key={j} className="text-ink-2">
                        {l.text}{" "}
                        <button onClick={() => onCite(l.page, l.text)} className="rounded bg-surface-2 border border-line px-1 text-[0.68rem] font-mono hover:text-accent-ink">
                          p. {l.page}
                        </button>
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {panel === "checks" &&
              (removed.length === 0 ? (
                <p className="text-sm text-ink-2">Every line and visual passed: each line cites a passage, and its numbers appear in that passage.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {removed.map((r, i) => (
                    <li key={i} className="rounded-lg bg-surface-2 p-2.5">
                      <span className="text-xs font-medium text-bad">
                        {r.reason === "no_source" ? "Cut: cited nothing in the paper" : r.reason === "number_not_in_source" ? "Cut: a number the paper does not contain" : "Visual replaced: not found in the paper"}
                      </span>
                      <p className="text-ink-2 mt-0.5">
                        {r.scene}: {r.text}
                      </p>
                    </li>
                  ))}
                </ul>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Visual({ v, film, paperTitle, file }: { v: FilmVisual; film: Film; paperTitle: string; file: string | { data: Uint8Array } | null }) {
  switch (v.type) {
    case "title":
      return (
        <div className="h-full grid place-items-center text-center">
          <div>
            <p className="film-rise text-xs uppercase tracking-[0.2em] text-white/50" style={{ animationDelay: "0.2s" }}>
              A film about
            </p>
            <p className="film-rise mt-2 text-sm sm:text-base text-white/80 max-w-xl mx-auto line-clamp-2" style={{ animationDelay: "0.4s" }}>
              {paperTitle}
            </p>
            <p className="film-rise mt-4 text-2xl sm:text-4xl font-semibold tracking-tight" style={{ animationDelay: "0.7s" }}>
              {film.title}
            </p>
            <p className="film-rise mt-3 text-sm sm:text-base text-white/70 max-w-xl mx-auto" style={{ animationDelay: "1.1s" }}>
              {film.logline}
            </p>
          </div>
        </div>
      );
    case "figure":
      return (
        <div className="h-full flex flex-col">
          <div className="flex-1 min-h-0 rounded-xl overflow-hidden bg-white/5">
            {file ? <FilmFigure file={file} page={v.page} label={v.label} /> : <p className="p-4 text-sm text-white/60">The PDF is not available on this device.</p>}
          </div>
          <p className="film-rise mt-2 text-xs sm:text-sm text-white/75 line-clamp-2" style={{ animationDelay: "0.6s" }}>
            <span className="font-semibold text-white">{v.label}</span> · {v.caption} <span className="font-mono text-white/50">(p. {v.page})</span>
          </p>
        </div>
      );
    case "stat":
      return (
        <div className="h-full grid place-items-center text-center">
          <div>
            <CountUp value={v.value} />
            <p className="film-rise mt-3 text-base sm:text-xl text-white/80 max-w-lg mx-auto" style={{ animationDelay: "0.5s" }}>
              {v.label}
            </p>
            <p className="film-rise mt-2 text-xs font-mono text-white/45" style={{ animationDelay: "0.8s" }}>
              from page {v.page}
            </p>
          </div>
        </div>
      );
    case "quote":
      return (
        <div className="h-full grid place-items-center">
          <blockquote className="film-rise max-w-2xl border-l-4 border-[#3987e5] pl-5" style={{ animationDelay: "0.3s" }}>
            <p className="text-base sm:text-2xl leading-snug font-medium">“{v.quote}”</p>
            <footer className="mt-3 text-xs text-white/55">The paper, page {v.page} (word for word)</footer>
          </blockquote>
        </div>
      );
    case "compare": {
      const max = Math.max(...v.bars.map((b) => b.number), 1e-9);
      return (
        <div className="h-full flex flex-col justify-center gap-3 max-w-2xl">
          {v.label && <p className="film-rise text-sm text-white/70">{v.label}</p>}
          {v.bars.map((b, i) => (
            <div key={b.label + i} className="film-rise" style={{ animationDelay: `${0.3 + i * 0.25}s` }}>
              <div className="flex justify-between text-xs sm:text-sm mb-1">
                <span className="text-white/85">{b.label}</span>
                <span className="font-mono">{b.value}</span>
              </div>
              <div className="h-3 sm:h-4 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="film-grow h-full rounded-full"
                  style={{ width: `${Math.max(4, (b.number / max) * 100)}%`, background: ["#3987e5", "#7fd49a", "#f0b75c", "#b49bff", "#f08a8a"][i % 5], animationDelay: `${0.4 + i * 0.25}s` }}
                />
              </div>
            </div>
          ))}
          <p className="text-[0.68rem] font-mono text-white/45">numbers from page {v.page}</p>
        </div>
      );
    }
    case "flow":
      return (
        <div className="h-full flex flex-col justify-center">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {v.items.map((s, i) => (
              <div key={i} className="film-rise flex items-center gap-2 sm:gap-3" style={{ animationDelay: `${0.3 + i * 0.45}s` }}>
                <div className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 sm:px-4 sm:py-3 text-xs sm:text-sm max-w-[13rem]">
                  <span className="block font-mono text-[0.65rem] text-[#8cb8f0]">step {i + 1}</span>
                  {s}
                </div>
                {i < v.items.length - 1 && <span className="text-white/40 text-lg" aria-hidden="true">→</span>}
              </div>
            ))}
          </div>
          {v.sketch && <p className="mt-3 text-[0.68rem] text-white/45">Sketch in the AI&rsquo;s words</p>}
        </div>
      );
    case "points":
      return (
        <div className="h-full flex flex-col justify-center">
          <ul className="space-y-2 sm:space-y-3 max-w-2xl">
            {v.items.map((s, i) => (
              <li key={i} className="film-rise flex gap-3 text-sm sm:text-lg leading-snug" style={{ animationDelay: `${0.3 + i * 0.5}s` }}>
                <span className="mt-2 w-2 h-2 rounded-full bg-[#3987e5] shrink-0" aria-hidden="true" />
                {s}
              </li>
            ))}
          </ul>
          {v.sketch && <p className="mt-3 text-[0.68rem] text-white/45">Sketch in the AI&rsquo;s words</p>}
        </div>
      );
  }
}

/** The number counts up to its printed value; the text around it stays exactly as printed. */
function CountUp({ value }: { value: string }) {
  const m = useMemo(() => value.match(/^(.*?)(\d[\d,]*(?:\.\d+)?)(.*)$/), [value]);
  const target = m ? parseFloat(m[2].replace(/,/g, "")) : NaN;
  const decimals = m && m[2].includes(".") ? m[2].split(".")[1].length : 0;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!Number.isFinite(target)) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = requestAnimationFrame(() => setShown(target));
      return () => cancelAnimationFrame(id);
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 1400);
      setShown(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  // Long values ("(6.5 ± 0.7) × 10^9 solar masses") get a smaller size so they never run into the caption.
  const size = value.length > 22 ? "text-2xl sm:text-4xl" : value.length > 12 ? "text-3xl sm:text-5xl" : "text-5xl sm:text-7xl";
  if (!m || !Number.isFinite(target)) return <p className={`film-rise font-semibold tracking-tight ${size}`}>{value}</p>;
  const done = Math.abs(shown - target) < 1e-9;
  return (
    <p className={`film-rise font-semibold tracking-tight font-mono ${size}`}>
      {m[1]}
      {done ? m[2] : shown.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {m[3]}
    </p>
  );
}
