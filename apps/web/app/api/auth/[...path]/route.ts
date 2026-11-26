import { auth } from "@/lib/auth/server";

// Neon Auth's endpoints, proxied on our own origin so the session cookie is first-party.
const off = () => Response.json({ error: "Accounts are not enabled." }, { status: 404 });
const h = auth?.handler();

export const GET = h?.GET ?? off;
export const POST = h?.POST ?? off;
export const PUT = h?.PUT ?? off;
export const PATCH = h?.PATCH ?? off;
export const DELETE = h?.DELETE ?? off;
