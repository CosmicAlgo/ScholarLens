"use client";

// Sign in (optional) to sync the workspace, Briefings and Films across devices.
// Email code or Google. Uploaded PDFs never leave the device.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { authClient } from "@/lib/auth/client";
import { API_URL } from "@/lib/api";
import { apiToken, refreshAccount, signOut, useAccount } from "@/lib/account";
import { setWS } from "@/lib/store";
import { forgetSyncState, startSync, syncNow, useSyncStatus } from "@/lib/sync";
import { EMPTY } from "@/lib/workspace";
import { track } from "./analytics";

function ago(t: number) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

function errText(e: unknown, fallback: string) {
  const m = (e as { message?: string; error?: { message?: string } })?.error?.message || (e as { message?: string })?.message;
  return typeof m === "string" && m ? m : fallback;
}

/** Remove this browser's copy of the work (for shared or library computers). */
async function clearThisDevice() {
  // Empty the live workspace first: it saves itself when the page unloads and would write the work back.
  setWS(() => EMPTY);
  for (const k of ["sl_workspace_v1", "sl_briefings_v1", "sl_films_v1"]) {
    try {
      localStorage.removeItem(k);
    } catch {}
  }
  forgetSyncState();
  await new Promise<void>((r) => {
    try {
      const req = indexedDB.deleteDatabase("scholarlens");
      req.onsuccess = req.onerror = req.onblocked = () => r();
    } catch {
      r();
    }
  });
}

export function AccountMenu() {
  const account = useAccount();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => startSync(), []);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  if (account.status === "off") return null;
  if (account.status === "loading") return <span className="w-8 h-8 rounded-full bg-surface-2 animate-pulse" aria-hidden="true" />;

  if (account.status === "signed_out")
    return (
      <>
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center rounded-lg border border-line px-3 h-9 text-sm text-ink-2 hover:text-ink hover:bg-surface-2"
        >
          Sign in
        </button>
        {/* Portalled: the header's backdrop blur would otherwise trap a fixed overlay inside it. */}
        {open && createPortal(<SignInDialog onClose={() => setOpen(false)} />, document.body)}
      </>
    );

  const u = account.user;
  return (
    <div className="relative" ref={wrap}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Account: ${u.email}`}
        className="w-9 h-9 rounded-full bg-accent-soft text-accent-ink text-sm font-semibold grid place-items-center hover:opacity-90 overflow-hidden"
      >
        {u.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- the provider's avatar URL, any host
          <img src={u.image} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          (u.name || u.email).slice(0, 1).toUpperCase()
        )}
      </button>
      {open && <AccountPanel email={u.email} name={u.name} onClose={() => setOpen(false)} />}
    </div>
  );
}

function AccountPanel({ email, name, onClose }: { email: string; name: string; onClose: () => void }) {
  const sync = useSyncStatus();
  const [step, setStep] = useState<"menu" | "signout" | "erase">("menu");
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 20_000);
    return () => clearInterval(t);
  }, []);

  const doSignOut = async (clear: boolean) => {
    setBusy(true);
    await syncNow(false).catch(() => {});
    await signOut();
    track("signed_out", { cleared: clear });
    if (clear) {
      await clearThisDevice();
      location.reload();
    } else {
      forgetSyncState();
      onClose();
    }
  };

  const erase = async () => {
    setBusy(true);
    const t = await apiToken();
    await fetch(`${API_URL}/api/me/erase`, { method: "POST", headers: t ? { Authorization: `Bearer ${t}` } : {} }).catch(() => {});
    forgetSyncState();
    await signOut();
    track("synced_data_erased");
    onClose();
  };

  return (
    <div role="dialog" aria-label="Your account" className="absolute right-0 top-11 z-50 w-72 rounded-xl border border-line bg-surface shadow-xl p-4 text-sm">
      <p className="font-medium text-ink truncate">{name || email}</p>
      {name && <p className="text-ink-3 truncate">{email}</p>}

      {step === "menu" && (
        <>
          <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2">
            <p className="text-ink-2">
              {sync.state === "syncing"
                ? "Syncing…"
                : sync.state === "error"
                  ? sync.error || "Sync failed. It will try again."
                  : sync.at
                    ? `Synced ${ago(sync.at)}`
                    : "Sync is on"}
            </p>
            <p className="mt-1 text-xs text-ink-3">Papers, notes, highlights, reading list, chat, Briefings and Films. Uploaded PDFs stay on each device.</p>
          </div>
          <button onClick={() => syncNow(true)} disabled={sync.state === "syncing"} className="mt-3 w-full rounded-lg border border-line h-9 hover:bg-surface-2 disabled:opacity-50">
            Sync now
          </button>
          <button onClick={() => setStep("signout")} className="mt-2 w-full rounded-lg border border-line h-9 hover:bg-surface-2">
            Sign out
          </button>
          <button onClick={() => setStep("erase")} className="mt-3 w-full text-xs text-ink-3 hover:text-ink underline">
            Delete my synced data
          </button>
        </>
      )}

      {step === "signout" && (
        <div className="mt-3">
          <p className="text-ink-2">Keep your work in this browser after signing out?</p>
          <p className="mt-1 text-xs text-ink-3">On a shared or library computer, remove it. It stays safe in your account.</p>
          <button disabled={busy} onClick={() => doSignOut(true)} className="mt-3 w-full rounded-lg bg-accent text-white h-9 font-medium hover:opacity-90 disabled:opacity-50">
            Sign out and remove from this browser
          </button>
          <button disabled={busy} onClick={() => doSignOut(false)} className="mt-2 w-full rounded-lg border border-line h-9 hover:bg-surface-2 disabled:opacity-50">
            Sign out and keep it here
          </button>
          <button onClick={() => setStep("menu")} className="mt-2 w-full text-xs text-ink-3 hover:text-ink">
            Cancel
          </button>
        </div>
      )}

      {step === "erase" && (
        <div className="mt-3">
          <p className="text-ink-2">Delete everything synced to your account? Your work in this browser is kept. This cannot be undone.</p>
          <button disabled={busy} onClick={erase} className="mt-3 w-full rounded-lg bg-red-600 text-white h-9 font-medium hover:opacity-90 disabled:opacity-50">
            Delete synced data and sign out
          </button>
          <button onClick={() => setStep("menu")} className="mt-2 w-full text-xs text-ink-3 hover:text-ink">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function SignInDialog({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const codeBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (step === "code") codeBox.current?.focus();
  }, [step]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { error } = await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: "sign-in" });
      if (error) throw error;
      setStep("code");
      track("signin_code_sent");
    } catch (e) {
      setError(errText(e, "Could not send the code. Check the address and try again."));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { error } = await authClient.signIn.emailOtp({ email: email.trim(), otp: code.trim() });
      if (error) throw error;
      track("signed_in", { method: "email" });
      await refreshAccount();
      onClose();
    } catch (e) {
      setError(errText(e, "That code did not work. Check it, or send a new one."));
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    setError("");
    track("signin_google_started");
    try {
      const { error } = await authClient.signIn.social({ provider: "google", callbackURL: window.location.href });
      if (error) throw error;
    } catch (e) {
      setError(errText(e, "Google sign-in did not start. Try the email code instead."));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="signin-title"
        className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="signin-title" className="text-lg font-semibold text-ink">
          Sign in to sync
        </h2>
        <p className="mt-1 text-sm text-ink-2">
          Your papers, notes, reading list, chat, Briefings and Films on every device, and your own AI allowance. Optional: everything
          works without an account. Uploaded PDFs stay on each device.
        </p>

        {step === "email" ? (
          <>
            <button
              onClick={google}
              disabled={busy}
              className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-lg border border-line h-10 text-sm font-medium hover:bg-surface-2 disabled:opacity-50"
            >
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
              </svg>
              Continue with Google
            </button>
            <div className="my-4 flex items-center gap-3 text-xs text-ink-3">
              <span className="h-px flex-1 bg-line" />
              or get a code by email
              <span className="h-px flex-1 bg-line" />
            </div>
            <form onSubmit={send}>
              <label htmlFor="signin-email" className="text-sm text-ink-2">
                Email (your university address works)
              </label>
              <input
                id="signin-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 h-10 text-sm text-ink outline-none focus:border-accent"
              />
              <button type="submit" disabled={busy || !email.trim()} className="mt-3 w-full rounded-lg bg-accent text-white h-10 text-sm font-medium hover:opacity-90 disabled:opacity-50">
                {busy ? "Sending…" : "Email me a code"}
              </button>
            </form>
          </>
        ) : (
          <form onSubmit={verify} className="mt-5">
            <label htmlFor="signin-code" className="text-sm text-ink-2">
              Enter the code sent to <span className="text-ink font-medium">{email}</span>
            </label>
            <input
              id="signin-code"
              ref={codeBox}
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\s/g, ""))}
              className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 h-10 text-lg tracking-[0.3em] text-ink outline-none focus:border-accent"
            />
            <p className="mt-1 text-xs text-ink-3">Not there? Check spam. It comes from Neon Auth, our sign-in provider.</p>
            <button type="submit" disabled={busy || code.length < 4} className="mt-3 w-full rounded-lg bg-accent text-white h-10 text-sm font-medium hover:opacity-90 disabled:opacity-50">
              {busy ? "Checking…" : "Sign in"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setCode("");
                setError("");
              }}
              className="mt-2 w-full text-xs text-ink-3 hover:text-ink"
            >
              Use a different email or resend
            </button>
          </form>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}
        <button onClick={onClose} className="mt-4 w-full text-xs text-ink-3 hover:text-ink">
          Not now
        </button>
      </div>
    </div>
  );
}
