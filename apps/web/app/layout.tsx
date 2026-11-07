import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Analytics } from "@/components/analytics";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "ScholarLens: where is research really heading?", template: "%s · ScholarLens" },
  description:
    "Track how research topics rise, peak and fade across 250M+ papers. Honest trend maths, trust badges for retracted and unreviewed work, and AI briefings where every claim cites a source.",
  openGraph: { siteName: "ScholarLens", type: "website" },
};

const NAV = [
  { href: "/", label: "Explore" },
  { href: "/compare", label: "Compare" },
  { href: "/ask", label: "Ask" },
  { href: "/about", label: "How it works" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <Analytics />
        <header className="border-b border-line bg-surface/80 backdrop-blur sticky top-0 z-20">
          <div className="mx-auto max-w-5xl px-4 h-14 flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <LensMark />
              ScholarLens
            </Link>
            <nav className="flex gap-4 text-sm text-ink-2 overflow-x-auto">
              {NAV.slice(1).map((n) => (
                <Link key={n.href} href={n.href} className="hover:text-ink whitespace-nowrap">
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line text-sm text-ink-3">
          <div className="mx-auto max-w-5xl px-4 py-6 flex flex-wrap gap-x-6 gap-y-2 justify-between">
            <p>
              Paper data from{" "}
              <a className="underline hover:text-ink" href="https://openalex.org" target="_blank" rel="noreferrer">
                OpenAlex
              </a>{" "}
              (CC0). Free during beta.
            </p>
            <p className="flex gap-4">
              <Link href="/about" className="hover:text-ink">
                Method
              </Link>
              <Link href="/about#privacy" className="hover:text-ink">
                Privacy
              </Link>
              <a
                href="https://github.com/CosmicAlgo/ScholarLens"
                className="hover:text-ink"
                target="_blank"
                rel="noreferrer"
              >
                GitHub
              </a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}

function LensMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10" cy="10" r="7" fill="none" stroke="var(--accent)" strokeWidth="2.2" />
      <path d="M6 12.5 L8.5 9.5 L10.5 11 L14 7" fill="none" stroke="var(--text)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.2 15.2 L21 21" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
