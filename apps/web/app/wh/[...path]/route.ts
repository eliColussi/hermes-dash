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

export const dynamic = "force-dynamic";

async function proxy(req: NextRequest, params: Promise<{ path: string[] }>) {
  const { path } = await params;
  const url = new URL(`/webhooks/${path.join("/")}`, HERMES_WEBHOOK_BASE);
  url.search = req.nextUrl.search;

  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("content-length");

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: "manual",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), init);
  } catch (err) {
    return NextResponse.json(
      {
        error: "webhook_adapter_unreachable",
        detail: String(err),
        hint: "Make sure `hermes gateway` is running with webhook platform enabled.",
      },
      { status: 502 },
    );
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
