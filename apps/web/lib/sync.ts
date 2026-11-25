"use client";

// Keeps a signed-in user's workspace, saved Briefings and Films the same on every device.
//
// Each kind is one JSON document on the server with a version number. A write names the version it
// started from; if another device wrote in between, the server answers 409 with its copy, and this
// device merges (keeping work from both) and writes again. When this device has no unsynced changes,
// a newer server copy simply replaces the local one, so closing a paper on one device sticks.
// Uploaded PDFs are never sent: they stay in this browser's IndexedDB.

import { useSyncExternalStore } from "react";
import { apiToken, dropToken, getAccount, onAccount, refreshAccount } from "./account";
import { API_URL } from "./api";
import { loadSaved, mergeBriefings, writeSaved, type SavedBriefing } from "./briefings";
import { mergeFilms, readFilms, writeFilms, type SavedFilms } from "./film";
import { getWS, isAnswering, setWS, subscribe } from "./store";
import { arrived, type SyncKind } from "./sync-events";
import { EMPTY, mergeWorkspace, persistable, type WorkspaceState } from "./workspace";

type Adapter<T> = { read(): T; apply(v: T): void; merge(local: T, remote: T): T; empty(v: T): boolean; busy?(): boolean };

const finish = (s: WorkspaceState): WorkspaceState => ({
  ...EMPTY,
  ...s,
  messages: (s.messages || []).map((m) => (m.role === "assistant" && !m.done ? { ...m, done: true, error: m.error || "Interrupted." } : m)),
});

const ADAPTERS: { [K in SyncKind]: Adapter<unknown> } = {
  workspace: {
    read: () => persistable(getWS()),
    apply: (v) => setWS(() => finish(v as WorkspaceState)),
    merge: (l, r) => mergeWorkspace(l as WorkspaceState, r as WorkspaceState),
    empty: (v) => {
      const s = v as WorkspaceState;
      return !s.papers.length && !s.highlights.length && !s.queue.length && !s.messages.length && !s.recent.length;
    },
    // Never swap the workspace under an answer that is still being written.
    busy: () => isAnswering(getWS()),
  },
  briefings: {
    read: () => loadSaved(),
    apply: (v) => {
      writeSaved(v as SavedBriefing[]);
      arrived("briefings");
    },
    merge: (l, r) => mergeBriefings(l as SavedBriefing[], r as SavedBriefing[]),
    empty: (v) => !(v as SavedBriefing[]).length,
  },
  films: {
    read: () => readFilms(),
    apply: (v) => {
      writeFilms(v as SavedFilms);
      arrived("films");
    },
    merge: (l, r) => mergeFilms(l as SavedFilms, r as SavedFilms),
    empty: (v) => !Object.keys(v as SavedFilms).length,
  },
};
const KINDS = Object.keys(ADAPTERS) as SyncKind[];

// ---- what this device last agreed with the server (survives reloads) ----
const META_KEY = "sl_sync_v1";
type Meta = { user: string; v: Partial<Record<SyncKind, number>>; synced: Partial<Record<SyncKind, string>> };

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return `${s.length}:${(h >>> 0).toString(36)}`;
}

function loadMeta(user: string): Meta {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY) || "null") as Meta | null;
    if (m && m.user === user) return m;
  } catch {}
  // A different (or first) account on this device: the first sync merges instead of replacing.
  return { user, v: {}, synced: {} };
}
let meta: Meta | null = null;
const saveMeta = () => {
  try {
    if (meta) localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {}
};

export function forgetSyncState() {
  meta = null;
  try {
    localStorage.removeItem(META_KEY);
  } catch {}
}

// ---- status, for the account menu ----
export type SyncStatus = { state: "idle" | "syncing" | "ok" | "error"; at: number; error?: string };
let status: SyncStatus = { state: "idle", at: 0 };
const statusSubs = new Set<() => void>();
const setStatus = (s: SyncStatus) => {
  status = s;
  statusSubs.forEach((f) => f());
};
function onStatus(f: () => void) {
  statusSubs.add(f);
  return () => {
    statusSubs.delete(f);
  };
}
const getStatus = () => status;
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(onStatus, getStatus, getStatus);
}

// ---- server calls ----
class AuthLost extends Error {}

async function call(path: string, body?: unknown): Promise<Response> {
  const t = await apiToken();
  if (!t) throw new AuthLost();
  const res = await fetch(`${API_URL}/api/me${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${t}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    dropToken();
    throw new AuthLost();
  }
  return res;
}

type Remote = { data: unknown; version: number } | null;

async function push(kind: SyncKind) {
  const A = ADAPTERS[kind];
  for (let i = 0; i < 4; i++) {
    const data = A.read();
    const res = await call(`/docs/${kind}`, { data, base_version: meta!.v[kind] ?? 0 });
    if (res.ok) {
      meta!.v[kind] = (await res.json()).version;
      meta!.synced[kind] = hash(JSON.stringify(data));
      saveMeta();
      return;
    }
    if (res.status !== 409) {
      let msg = `Sync failed (${res.status}).`;
      try {
        const b = await res.json();
        if (typeof b?.detail === "string") msg = b.detail;
      } catch {}
      throw new Error(msg);
    }
    // Another device wrote first: take its copy into ours and try again.
    const cur = ((await res.json()) as { current: Remote }).current;
    if (!cur) {
      meta!.v[kind] = 0;
      continue;
    }
    if (A.busy?.()) return;
    A.apply(A.merge(A.read(), cur.data));
    meta!.v[kind] = cur.version;
    saveMeta();
  }
  throw new Error("Sync kept colliding with another device. It will try again shortly.");
}

/** Bring one kind in step. `remote` undefined = not fetched (just send local changes). */
async function syncKind(kind: SyncKind, remote?: Remote) {
  const A = ADAPTERS[kind];
  if (A.busy?.()) return;
  const known = meta!.v[kind] ?? 0;
  const dirty = hash(JSON.stringify(A.read())) !== meta!.synced[kind];
  if (remote === null && known) meta!.v[kind] = 0; // erased on the server
  if (remote && remote.version !== known) {
    // The server moved on. With no local changes, take it as is; otherwise keep work from both.
    const next = dirty || !known ? A.merge(A.read(), remote.data) : remote.data;
    A.apply(next);
    meta!.v[kind] = remote.version;
    const now = JSON.stringify(A.read());
    if (now === JSON.stringify(remote.data)) {
      meta!.synced[kind] = hash(now);
      saveMeta();
      return;
    }
  }
  const local = A.read();
  if (hash(JSON.stringify(local)) === meta!.synced[kind]) return;
  if (!meta!.v[kind] && A.empty(local)) return; // nothing worth creating
  await push(kind);
}

let running: Promise<void> | null = null;
let again = false;
let lastFull = 0;

async function run(full: boolean, kinds: SyncKind[] = KINDS) {
  const a = getAccount();
  if (a.status !== "signed_in") return;
  meta = meta && meta.user === a.user.id ? meta : loadMeta(a.user.id);
  setStatus({ ...status, state: "syncing" });
  try {
    if (full) {
      const res = await call("/docs");
      if (!res.ok) throw new Error(`Sync failed (${res.status}).`);
      const docs = (await res.json()) as Record<string, { data: unknown; version: number }>;
      for (const k of KINDS) await syncKind(k, docs[k] ?? null);
      lastFull = Date.now();
    } else {
      for (const k of kinds) await syncKind(k);
    }
    setStatus({ state: "ok", at: Date.now() });
  } catch (e) {
    if (e instanceof AuthLost) {
      await refreshAccount();
      setStatus({ state: "idle", at: status.at });
    } else setStatus({ state: "error", at: status.at, error: e instanceof Error ? e.message : "Sync failed." });
  }
}

/** Run a sync; overlapping requests fold into one follow-up run. */
export function syncNow(full = true) {
  if (running) {
    again = true;
    return running;
  }
  running = run(full).finally(() => {
    running = null;
    if (again) {
      again = false;
      void syncNow(true);
    }
  });
  return running;
}

// ---- triggers ----
let pushTimer: ReturnType<typeof setTimeout> | undefined;
const pending = new Set<SyncKind>();
function schedule(kind: SyncKind) {
  if (getAccount().status !== "signed_in") return;
  pending.add(kind);
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const kinds = [...pending];
    pending.clear();
    if (running) again = true;
    else {
      running = run(false, kinds).finally(() => {
        running = null;
        if (again) {
          again = false;
          void syncNow(true);
        }
      });
    }
  }, 2500);
}

let installed = false;
let lastUser: string | null = null;

/** Start listening. Safe to call more than once. */
export function startSync() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  subscribe(() => schedule("workspace"));
  window.addEventListener("sl:changed", (e) => schedule((e as CustomEvent).detail as SyncKind));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastFull > 30_000) void syncNow(true);
  });
  window.addEventListener("pagehide", () => {
    if (pending.size) void run(false, [...pending]);
  });
  const onChange = () => {
    const a = getAccount();
    const id = a.status === "signed_in" ? a.user.id : null;
    if (id && id !== lastUser) void syncNow(true);
    if (!id) setStatus({ state: "idle", at: 0 });
    lastUser = id;
  };
  onAccount(onChange);
  onChange();
}
