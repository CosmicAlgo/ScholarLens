"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import "@/lib/copilot-run"; // answers keep streaming (and resume) on every page
import { isAnswering, useWorkspace } from "@/lib/store";
import { Wordmark } from "./brand";

const NAV = [
  { href: "/workspace", label: "Workspace", hint: "Read, highlight and ask" },
  { href: "/trends", label: "Trends", hint: "Where a field is heading" },
  { href: "/compare", label: "Compare", hint: "Topics side by side" },
  { href: "/ask", label: "Briefings", hint: "A cited report on a question" },
  { href: "/about", label: "How it works", hint: "Method, trust and privacy" },
];

export function SiteHeader() {
  return <HeaderShell path={usePathname()} />;
}

/** Rendered with an empty path while the real path streams in (prerendered pages). */
export function HeaderShell({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  const active = (href: string) => (href === "/trends" ? path.startsWith("/trends") || path.startsWith("/topic") : path.startsWith(href));
  const inWorkspace = path.startsWith("/workspace");
  const answering = isAnswering(useWorkspace());

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-line bg-surface/85 backdrop-blur supports-[backdrop-filter]:bg-surface/70">
      <div className="h-full flex items-center gap-3 px-4">
        <Link href="/" aria-label="ScholarLens home" className="shrink-0">
          <Wordmark />
        </Link>
        <span className="hidden md:inline rounded-full border border-line px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wider text-ink-3">
          Beta
        </span>

        <nav aria-label="Main" className="hidden md:flex items-center gap-1 ml-4">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(n.href) ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                active(n.href) ? "bg-surface-2 text-ink font-medium" : "text-ink-2 hover:text-ink hover:bg-surface-2"
              }`}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <span className="flex-1" />
        {!inWorkspace && answering && (
          <Link
            href="/workspace"
            className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent-soft px-3 h-8 text-xs font-medium text-accent-ink"
            title="Copilot is still writing your answer. It keeps going while you browse."
          >
            <span className="w-2 h-2 rounded-full bg-accent animate-pulse" aria-hidden="true" />
            <span className="hidden sm:inline">Copilot is answering</span>
            <span className="sm:hidden">Answering</span>
          </Link>
        )}
        {!inWorkspace && (
          <Link
            href="/workspace"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-accent text-white text-sm font-medium px-3.5 h-9 hover:opacity-90"
          >
            Open workspace
            <span aria-hidden="true">→</span>
          </Link>
        )}

        <button
          className="md:hidden -mr-1 w-10 h-10 grid place-items-center rounded-lg hover:bg-surface-2"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((o) => !o)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>

      {open && (
        <>
          <button aria-hidden="true" tabIndex={-1} className="md:hidden fixed inset-0 top-14 bg-black/30" onClick={() => setOpen(false)} />
          <nav id="mobile-nav" aria-label="Main" className="md:hidden absolute inset-x-0 top-14 border-b border-line bg-surface shadow-lg">
            <ul className="p-2">
              {NAV.map((n) => (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={active(n.href) ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={`flex flex-col rounded-xl px-4 py-3 ${active(n.href) ? "bg-accent-soft" : "active:bg-surface-2"}`}
                  >
                    <span className={`text-base ${active(n.href) ? "text-accent-ink font-semibold" : "text-ink font-medium"}`}>{n.label}</span>
                    <span className="text-xs text-ink-3">{n.hint}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </>
      )}
    </header>
  );
}
