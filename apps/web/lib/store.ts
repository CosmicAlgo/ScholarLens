"use client";

// The workspace lives here, outside any page component, so work in progress (a Copilot answer,
// a matrix fill, a figure reading) keeps going and keeps its results while the user visits other
// pages. Saved to localStorage; restored once per tab.

import { useSyncExternalStore } from "react";
import { EMPTY, loadState, saveState, type WorkspaceState } from "./workspace";

export type Live = { matrixStatus: Record<string, string>; figStatus: Record<string, string> };
const LIVE0: Live = { matrixStatus: {}, figStatus: {} };

let ws: WorkspaceState = EMPTY;
let live: Live = LIVE0;
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const subs = new Set<() => void>();
const onLoad: ((s: WorkspaceState) => void)[] = [];

function ensure() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  ws = loadState();
  window.addEventListener("pagehide", () => saveState(ws));
  const restored = ws;
  queueMicrotask(() => onLoad.forEach((f) => f(restored)));
}

const emit = () => subs.forEach((f) => f());

export function getWS(): WorkspaceState {
  ensure();
  return ws;
}

export function setWS(fn: (s: WorkspaceState) => WorkspaceState) {
  ensure();
  ws = fn(ws);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveState(ws), 300);
  emit();
}

export function getLive(): Live {
  return live;
}

export function setLive(fn: (l: Live) => Live) {
  live = fn(live);
  emit();
}

/** Run once when the saved workspace is first restored in this tab (e.g. resume an answer). */
export function whenRestored(fn: (s: WorkspaceState) => void) {
  if (loaded) {
    const restored = ws;
    queueMicrotask(() => fn(restored));
  } else onLoad.push(fn);
}

function subscribe(cb: () => void) {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

export function useWorkspace(): WorkspaceState {
  return useSyncExternalStore(subscribe, getWS, () => EMPTY);
}

export function useLive(): Live {
  return useSyncExternalStore(subscribe, getLive, () => LIVE0);
}

/** True while the newest Copilot answer is still being written. */
export function isAnswering(s: WorkspaceState) {
  const m = s.messages.at(-1);
  return m?.role === "assistant" && !m.done;
}
