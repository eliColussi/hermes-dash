import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, adminCreds, makeToken } from "@/lib/session";
import { timingSafeEqual } from "crypto";

export const runtime = "nodejs"; // crypto + env access — keep off the edge

function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// In-process brute-force gate: 5 failed attempts per IP per 15 min window.
// Resets on redeploy, which is acceptable for a single-tenant single-container
// deploy. Successful login clears the counter for that IP.
const MAX_FAILURES = Number(process.env.LOGIN_MAX_FAILURES || 5);
const WINDOW_MS = Number(process.env.LOGIN_WINDOW_MS || 15 * 60 * 1000);
const failures = new Map<string, { count: number; firstFail: number }>();

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

function checkRateLimit(ip: string): { blocked: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const slot = failures.get(ip);
  if (!slot) return { blocked: false };
  if (now - slot.firstFail > WINDOW_MS) {
    failures.delete(ip);
    return { blocked: false };
  }
  if (slot.count >= MAX_FAILURES) {
    return {
      blocked: true,
      retryAfterSec: Math.ceil((WINDOW_MS - (now - slot.firstFail)) / 1000),
    };
  }
  return { blocked: false };
}

function recordFailure(ip: string): void {
  const now = Date.now();
  const slot = failures.get(ip);
  if (!slot || now - slot.firstFail > WINDOW_MS) {
    failures.set(ip, { count: 1, firstFail: now });
  } else {
    slot.count += 1;
  }
}

// Cookie should be Secure on any HTTPS connection — not just NODE_ENV=production.
// Railway forwards x-forwarded-proto=https; we also accept the request URL's
// own protocol so direct HTTPS hits work too. Local http://localhost dev stays
// non-Secure so the cookie still works without TLS.
function isHttps(req: NextRequest): boolean {
  const proto = req.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0]!.trim() === "https";
  return req.nextUrl.protocol === "https:";
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const gate = checkRateLimit(ip);
  if (gate.blocked) {
    return NextResponse.json(
      {
        error: "Too many failed attempts. Try again in a few minutes.",
      },
      {
        status: 429,
        headers: { "Retry-After": String(gate.retryAfterSec ?? 60) },
      },
    );
  }

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const creds = adminCreds();
  if (!creds) {
    return NextResponse.json(
      {
        error:
          "Login isn't set up yet on this deploy. Your team needs to set " +
          "STAFFROOM_ADMIN_PASSWORD in Railway before anyone can sign in.",
      },
      { status: 503 },
    );
  }
  const { username = "", password = "" } = body;
  if (!safeEq(username.trim().toLowerCase(), creds.user.trim().toLowerCase()) ||
      !safeEq(password, creds.password)) {
    recordFailure(ip);
    return NextResponse.json({ error: "Wrong username or password." }, { status: 401 });
  }

  failures.delete(ip);
  const token = makeToken(creds.user);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isHttps(req),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
  return res;
}
