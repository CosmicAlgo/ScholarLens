"use client";

// Product analytics (PostHog). Off unless NEXT_PUBLIC_POSTHOG_KEY is set, so local dev and forks send nothing.
// We record page views and a few product events (searches, compares, AI reports) to learn who finds this useful.

import posthog from "posthog-js";
import { useEffect } from "react";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com";

let started = false;

export function Analytics() {
  useEffect(() => {
    if (!KEY || started) return;
    started = true;
    posthog.init(KEY, {
      api_host: HOST,
      defaults: "2025-05-24", // SPA page views via history changes
      person_profiles: "identified_only", // anonymous visitors don't create person records
      disable_session_recording: true,
      respect_dnt: true,
    });
  }, []);
  return null;
}

export function track(event: string, props?: Record<string, unknown>) {
  if (KEY && started) posthog.capture(event, props);
}
