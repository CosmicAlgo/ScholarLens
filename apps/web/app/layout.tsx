import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Analytics } from "@/components/analytics";
import { Suspense } from "react";
import { HeaderShell, SiteHeader } from "@/components/site-header";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "ScholarLens: read papers with an AI that cites the page", template: "%s · ScholarLens" },
  description:
    "A research workspace for scholars and labs: read open-access or your own PDFs, highlight a passage to ask, explain or verify it, build evidence matrices, and check ideas against prior work. Every AI claim cites the page it came from.",
  openGraph: { siteName: "ScholarLens", type: "website" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <Analytics />
        <Suspense fallback={<HeaderShell path="" />}>
          <SiteHeader />
        </Suspense>
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
