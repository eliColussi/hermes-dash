// Public-facing webhook proxy: forwards POSTs to HERMÉS's webhook adapter
// running on 127.0.0.1:8644 inside the same container. The HMAC signature
// validation happens INSIDE the HERMÉS adapter; we just forward bytes and
// headers verbatim.
//
// This sits OUTSIDE /api/* deliberately — the bridge bearer token is not
// applied. Each route's HMAC secret is the security layer.
//
// Mounted at /wh/[...] (not /webhooks/[...]) to avoid colliding with the
// admin UI page at /webhooks. HERMÉS's adapter still expects paths starting
// with /webhooks/ internally, so we rewrite below.

import { NextRequest, NextResponse } from "next/server";

const HERMES_WEBHOOK_BASE =
  process.env.HERMES_WEBHOOK_URL || "http://127.0.0.1:8644";

// Hard limits — keep these consistent with HERMÉS's webhook adapter defaults.
const MAX_BODY_BYTES = Number(process.env.WEBHOOK_MAX_BODY_BYTES || 1_048_576); // 1 MB
const UPSTREAM_TIMEOUT_MS = Number(process.env.WEBHOOK_TIMEOUT_MS || 30_000);
const RATE_LIMIT_PER_MIN = Number(process.env.WEBHOOK_RATE_LIMIT_PER_MIN || 60);

export const dynamic = "force-dynamic";

// Tiny in-process token bucket per IP. Resets on redeploy, which is fine
// for a single-container deploy. A real edge cache would persist across
// restarts but for v1 this is enough to stop curl-loop abuse.
const buckets = new Map<string, { count: number; windowStart: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const slot = buckets.get(ip);
  if (!slot || now - slot.windowStart > 60_000) {
    buckets.set(ip, { count: 1, windowStart: now });
    return false;
  }
  slot.count += 1;
  return slot.count > RATE_LIMIT_PER_MIN;
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

async function proxy(req: NextRequest, params: Promise<{ path: string[] }>) {
  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "rate_limited", detail: "Too many webhook requests." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const { path } = await params;
  const url = new URL(`/webhooks/${path.join("/")}`, HERMES_WEBHOOK_BASE);
  url.search = req.nextUrl.search;

  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("content-length");

  let body: ArrayBuffer | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    // Enforce body cap before buffering the whole payload into memory.
    const declared = Number(req.headers.get("content-length") || 0);
    if (declared && declared > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "payload_too_large", limit_bytes: MAX_BODY_BYTES },
        { status: 413 },
      );
    }
    body = await req.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "payload_too_large", limit_bytes: MAX_BODY_BYTES },
        { status: 413 },
      );
    }
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), {
      method: req.method,
      headers,
      body,
      redirect: "manual",
      signal: ac.signal,
    });
  } catch (err) {
    const aborted = (err as { name?: string })?.name === "AbortError";
    return NextResponse.json(
      {
        error: aborted ? "upstream_timeout" : "webhook_adapter_unreachable",
        hint: "Make sure `hermes gateway` is running with webhook platform enabled.",
      },
      { status: aborted ? 504 : 502 },
    );
  } finally {
    clearTimeout(timer);
  }
  const resHeaders = new Headers(upstream.headers);
  resHeaders.delete("transfer-encoding");
  resHeaders.delete("content-encoding");

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: resHeaders,
  });
}

export const GET = (req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) =>
  proxy(req, params);
export const POST = (req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) =>
  proxy(req, params);
export const PUT = (req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) =>
  proxy(req, params);
export const PATCH = (req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) =>
  proxy(req, params);
export const DELETE = (req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) =>
  proxy(req, params);
