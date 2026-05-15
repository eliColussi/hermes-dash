import { NextRequest, NextResponse } from "next/server";

const BRIDGE = process.env.BRIDGE_URL || "http://127.0.0.1:8787";
const TOKEN = process.env.STAFFROOM_AUTH_TOKEN || "";

export const dynamic = "force-dynamic";

async function proxy(req: NextRequest, params: Promise<{ path: string[] }>) {
  const { path } = await params;
  const url = new URL(`/api/${path.join("/")}`, BRIDGE);
  url.search = req.nextUrl.search;

  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("content-length");
  if (TOKEN) headers.set("authorization", `Bearer ${TOKEN}`);

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: "manual",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer();
  }

  const upstream = await fetch(url.toString(), init);
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
