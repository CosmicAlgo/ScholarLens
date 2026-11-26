import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/server";

// Finishes a Google sign-in. Google returns to Neon Auth, which sends the user back here with a one-time
// `neon_auth_session_verifier`; Neon's middleware swaps it for the session cookie and redirects to the same
// page without it. Every page stays public, and the matcher keeps this off all other requests.
const PUBLIC = ["/", "/workspace", "/trends", "/topic", "/compare", "/ask", "/people", "/verify", "/about", "/paper", "/briefings", "/researchers"];
const finishSignIn = auth?.middleware({ loginUrl: "/", publicRoutes: PUBLIC });

export default function proxy(request: NextRequest) {
  return finishSignIn ? finishSignIn(request) : NextResponse.next();
}

export const config = {
  matcher: [{ source: "/((?!_next/|api/|favicon).*)", has: [{ type: "query", key: "neon_auth_session_verifier" }] }],
};
