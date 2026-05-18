import { NextRequest, NextResponse } from "next/server";

// Auth gate: everything goes through here. Unauthenticated requests get
// redirected to /login except for:
//   * /login itself (the form)
//   * /api/auth/* (login + logout endpoints)
//   * /api/health (Railway / monitoring probes)
//   * /wh/* (external webhook receivers — Stripe, GitHub, etc.)
//   * /_next/*, /favicon.ico (Next.js static)
//
// Token verification uses a constant-time HMAC compare against the cookie.
// Edge runtime can't use Node's `crypto`, so we re-implement signature
// checking with Web Crypto here.

const SESSION_COOKIE = "staffroom_session";
const SECRET = process.env.STAFFROOM_SESSION_SECRET || "";

async function verifyEdge(token: string): Promise<boolean> {
  if (!SECRET || !token) return false;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return false;
  const body = token.slice(0, dot);
  const provided = token.slice(dot + 1);

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sigBuf = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(body),
    );
    const expected = base64url(new Uint8Array(sigBuf));
    if (expected.length !== provided.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
    }
    if (diff !== 0) return false;
    // Check expiry from the payload
    const payload = JSON.parse(
      new TextDecoder().decode(base64urlDecode(body)),
    );
    return typeof payload?.exp === "number" && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b = atob(input.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i);
  return bytes;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public surfaces — never gate these.
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/health" ||
    pathname.startsWith("/wh/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const ok = token ? await verifyEdge(token) : false;
  if (ok) return NextResponse.next();

  // API requests: return 401 JSON instead of redirecting (so fetch fails
  // cleanly and the React Query layer surfaces an error the user can act on).
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  // Page requests: redirect to login, preserving the destination as ?next=
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  if (pathname !== "/") url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything; the function itself decides what to pass through.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
