import { authorizeBridgeRequest, unauthorizedResponse } from "../../lib/bridge-auth";
import { handleCompatibleMcpRequest } from "../../lib/mcp-protocol";
import { type McpRequest } from "../../lib/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET() {
  return Response.json(
    {
      ok: true,
      service: "arms-client-bridge",
      transport: "streamable-http",
      endpoint: "/mcp",
      note: "Use POST with MCP JSON-RPC requests.",
    },
    { headers: { ...corsHeaders, "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = authorizeBridgeRequest(request);
  if (!auth.ok) {
    const response = unauthorizedResponse(request);
    Object.entries(corsHeaders).forEach(([key, value]) => response.headers.set(key, value));
    return response;
  }

  let payload: McpRequest | McpRequest[];
  try {
    payload = (await request.json()) as McpRequest | McpRequest[];
  } catch {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400, headers: corsHeaders },
    );
  }

  const protocolVersion = request.headers.get("mcp-protocol-version") ?? "2025-06-18";
  const headers = {
    ...corsHeaders,
    "Cache-Control": "no-store",
    "MCP-Protocol-Version": protocolVersion,
  };

  if (Array.isArray(payload)) {
    const results = (await Promise.all(payload.map((item) => handleCompatibleMcpRequest(item, auth.scope, protocolVersion)))).filter(Boolean);
    if (results.length === 0) return new Response(null, { status: 202, headers });
    return Response.json(results, { headers });
  }

  const result = await handleCompatibleMcpRequest(payload, auth.scope, protocolVersion);
  if (!result) return new Response(null, { status: 202, headers });
  return Response.json(result, { headers });
}
