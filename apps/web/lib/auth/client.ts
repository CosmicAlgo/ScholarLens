"use client";

import { createAuthClient } from "@neon/auth/next";

/** Talks to this site's /api/auth proxy, which forwards to Neon Auth. */
export const authClient = createAuthClient();

/** Accounts are switched on per deployment, so a site without Neon Auth configured never shows sign-in. */
export const ACCOUNTS_ON = process.env.NEXT_PUBLIC_ACCOUNTS === "1";
