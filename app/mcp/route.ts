import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM_MCP_URL = "https://services.leadconnectorhq.com/mcp/";

const REQUEST_HEADERS = [
  "authorization",
  "accept",
  "content-type",
  "mcp-protocol-version",
  "mcp-session-id",
  "last-event-id",
  "locationid",
  "location-id",
] as const;

const RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "mcp-session-id",
  "www-authenticate",
  "location",
] as const;

async function proxy(request: NextRequest): Promise<Response> {
  const headers = new Headers();

  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  // MCP clients commonly negotiate both JSON and Server-Sent Events.
  if (!headers.has("accept")) {
    headers.set("accept", "application/json, text/event-stream");
  }

  let body: ArrayBuffer | undefined;
  if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "DELETE") {
    body = await request.arrayBuffer();
  }

  const upstreamUrl = new URL(UPSTREAM_MCP_URL);
  upstreamUrl.search = request.nextUrl.search;

  const upstream = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body,
    redirect: "manual",
    cache: "no-store",
  });

  const responseHeaders = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  // Make the proxy identity explicit without changing the MCP payload.
  responseHeaders.set("x-arms-client-bridge", "leadconnector-mcp-proxy");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export async function GET(request: NextRequest) {
  return proxy(request);
}

export async function POST(request: NextRequest) {
  return proxy(request);
}

export async function DELETE(request: NextRequest) {
  return proxy(request);
}
