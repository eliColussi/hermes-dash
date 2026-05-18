/**
 * Tiny signed-cookie session, no dependencies.
 *
 * Cookie value: base64url("<payload-json>.<hmac-sha256(payload, SECRET)>")
 * Payload: { u: "<username>", exp: <unix-seconds> }
 *
 * Secret comes from STAFFROOM_SESSION_SECRET env var (minted at first boot
 * in start.sh and persisted to the data volume). Admin credentials live in
 * STAFFROOM_ADMIN_USER / STAFFROOM_ADMIN_PASSWORD on Railway.
 */
import { createHmac, timingSafeEqual } from "crypto";

const SECRET = process.env.STAFFROOM_SESSION_SECRET || "";
const DEFAULT_TTL_SEC = 60 * 60 * 24 * 14; // 14 days

export interface SessionPayload {
  u: string;
  exp: number;
}

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

export function makeToken(username: string, ttlSec = DEFAULT_TTL_SEC): string {
  const payload: SessionPayload = {
    u: username,
    exp: Math.floor(Date.now() / 1000) + ttlSec,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyToken(token: string | undefined): SessionPayload | null {
  if (!token || !SECRET) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = sign(body);
  // Constant-time compare to avoid leaking secret bytes via timing.
  let a: Buffer, b: Buffer;
  try {
    a = Buffer.from(provided, "base64url");
    b = Buffer.from(expected, "base64url");
  } catch {
    return null;
  }
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let parsed: SessionPayload;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf-8"));
  } catch {
    return null;
  }
  if (typeof parsed.exp !== "number" || parsed.exp < Math.floor(Date.now() / 1000)) return null;
  if (typeof parsed.u !== "string") return null;
  return parsed;
}

export const SESSION_COOKIE = "staffroom_session";

export function adminCreds(): { user: string; password: string } | null {
  const password = process.env.STAFFROOM_ADMIN_PASSWORD;
  if (!password) return null;
  const user = process.env.STAFFROOM_ADMIN_USER || "admin";
  return { user, password };
}
