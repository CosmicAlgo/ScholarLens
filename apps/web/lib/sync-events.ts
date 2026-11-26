// Tiny event bus so stores can say "I changed" and pages can hear "synced data arrived", without
// importing the sync engine (and its auth client) everywhere.

export type SyncKind = "workspace" | "briefings" | "films";

export function changed(kind: SyncKind) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("sl:changed", { detail: kind }));
}

export function arrived(kind: SyncKind) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("sl:arrived", { detail: kind }));
}

/** Run `fn` when synced data for `kind` was written into this browser. Returns an unsubscribe. */
export function onArrived(kind: SyncKind, fn: () => void) {
  const h = (e: Event) => (e as CustomEvent).detail === kind && fn();
  window.addEventListener("sl:arrived", h);
  return () => window.removeEventListener("sl:arrived", h);
}
