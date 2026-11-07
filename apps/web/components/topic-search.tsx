"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { topicSlug } from "@/lib/api";
import { track } from "./analytics";

export function TopicSearch({ initial = "", autoFocus = false, size = "lg" }: { initial?: string; autoFocus?: boolean; size?: "lg" | "md" }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const big = size === "lg";

  return (
    <form
      role="search"
      className="flex gap-2 w-full"
      onSubmit={(e) => {
        e.preventDefault();
        const topic = q.trim();
        if (topic.length < 2) return;
        track("topic_searched", { topic });
        router.push(`/topic/${topicSlug(topic)}`);
      }}
    >
      <label htmlFor="topic-q" className="sr-only">
        Research topic
      </label>
      <input
        id="topic-q"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus={autoFocus}
        maxLength={200}
        placeholder="A research topic, e.g. graph neural networks"
        className={`flex-1 min-w-0 rounded-xl border border-line bg-surface px-4 outline-none focus:border-accent ${
          big ? "h-12 text-base" : "h-10 text-sm"
        }`}
      />
      <button
        type="submit"
        className={`rounded-xl bg-accent text-white font-medium px-4 hover:opacity-90 ${big ? "h-12" : "h-10 text-sm"}`}
      >
        Explore
      </button>
    </form>
  );
}
