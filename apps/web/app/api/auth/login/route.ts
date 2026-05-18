import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, adminCreds, makeToken } from "@/lib/session";
import { timingSafeEqual } from "crypto";

export const runtime = "nodejs"; // crypto + env access — keep off the edge

function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function POST(req: NextRequest) {
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
    return NextResponse.json({ error: "Wrong username or password." }, { status: 401 });
  }

  const token = makeToken(creds.user);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
  return res;
}
