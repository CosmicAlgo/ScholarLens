import { createNeonAuth } from "@neon/auth/next/server";

// Optional accounts (Neon Auth, managed Better Auth). Without these env vars accounts are off and the
// site works exactly as before: everything stays in the browser.
const baseUrl = process.env.NEON_AUTH_BASE_URL;
const secret = process.env.NEON_AUTH_COOKIE_SECRET;

export const auth = baseUrl && secret ? createNeonAuth({ baseUrl, cookies: { secret } }) : null;
