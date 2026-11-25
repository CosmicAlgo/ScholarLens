"use client";

// The signed-in account, if any. Accounts are optional: signed out, everything works as before and
// lives only in this browser. Signed in, AI calls carry a short-lived token (so the API counts the
// user's own allowance instead of their network's) and the sync engine keeps devices in step.

import { useSyncExternalStore } from "react";
import { ACCOUNTS_ON, authClient } from "./auth/client";
import { clientId } from "./client-id";

export type AccountUser = { id: string; email: string; name: string; image?: string | null };
export type Account =
  | { status: "off" }
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "signed_in"; user: AccountUser };

let account: Account = { status: ACCOUNTS_ON ? "loading" : "off" };
const subs = new Set<() => void>();
let started = false;

function set(a: Account) {
  if (a.status !== "signed_in" || (account.status === "signed_in" && account.user.id !== a.user.id)) jwt = null;
  account = a;
  subs.forEach((f) => f());
}

type SessionResult = { data?: { user?: AccountUser | null; session?: { token?: string } | null } | null };

async function session(): Promise<SessionResult["data"]> {
  try {
    const r = (await authClient.getSession()) as SessionResult;
    return r?.data ?? null;
  } catch {
    return null;
  }
}

/** Re-read the session (after sign-in, sign-out, or when the tab comes back). */
export async function refreshAccount(): Promise<Account> {
  if (!ACCOUNTS_ON) return account;
  const d = await session();
  const u = d?.user;
  set(u ? { status: "signed_in", user: { id: u.id, email: u.email, name: u.name, image: u.image } } : { status: "signed_out" });
  return account;
}

export function getAccount(): Account {
  if (ACCOUNTS_ON && !started && typeof window !== "undefined") {
    started = true;
    void refreshAccount();
  }
  return account;
}

export function onAccount(fn: () => void) {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

const SERVER: Account = { status: ACCOUNTS_ON ? "loading" : "off" };

export function useAccount(): Account {
  return useSyncExternalStore(onAccount, getAccount, () => SERVER);
}

// The API token is a signed JWT (EdDSA, 15 minutes) from Neon Auth's /token, not the session id.
let jwt: { token: string; exp: number } | null = null;
let jwtInFlight: Promise<string | null> | null = null;

function expiry(token: string) {
  try {
    const p = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof p.exp === "number" ? p.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/** The signed-in user's API token, reused until a minute before it expires; null when signed out. */
export async function apiToken(): Promise<string | null> {
  if (account.status !== "signed_in") return null;
  if (jwt && jwt.exp - Date.now() > 60_000) return jwt.token;
  jwtInFlight ??= (async () => {
    try {
      // Neon Auth's JWT endpoint, through this site's /api/auth proxy (the session cookie is first-party).
      const r = await fetch("/api/auth/token", { credentials: "same-origin" });
      const t = r.ok ? ((await r.json()) as { token?: string }).token : undefined;
      jwt = t ? { token: t, exp: expiry(t) } : null;
      return jwt?.token ?? null;
    } catch {
      return null;
    } finally {
      jwtInFlight = null;
    }
  })();
  return jwtInFlight;
}

/** Forget the cached token (the API said it expired or was revoked). */
export function dropToken() {
  jwt = null;
}

/** Headers for an API call: the browser's client id, plus the account token when signed in. */
export async function authHeaders(json = true): Promise<Record<string, string>> {
  const h: Record<string, string> = { "X-Client-Id": clientId() };
  if (json) h["Content-Type"] = "application/json";
  const t = await apiToken();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

export async function signOut() {
  try {
    await authClient.signOut();
  } finally {
    set({ status: "signed_out" });
  }
}
