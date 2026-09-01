import { handleMcpRequest, type McpRequest, type McpResponse } from "./mcp";

const MODERN_PROTOCOL_VERSION = "2026-07-28";
const SERVER_INFO = { name: "ARMS Client Bridge", version: "0.3.3" };
const INSTRUCTIONS = "Agency-first ARMS bridge for HighLevel. Search/list clients with agency auth, then pass an explicit location_id for all client CRM operations. Read current state before writes.";

function modernResult(result: unknown): unknown {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  return {
    ...result,
    resultType: "complete",
    _meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO },
  };
}

function response(request: McpRequest, result: unknown): McpResponse {
  return { jsonrpc: "2.0", id: request.id ?? null, result: modernResult(result) };
}

export async function handleCompatibleMcpRequest(
  request: McpRequest,
  scope: string | undefined,
  protocolVersion: string,
): Promise<McpResponse | null> {
  if (protocolVersion === MODERN_PROTOCOL_VERSION && request.method === "server/discover") {
    return response(request, {
      supportedVersions: [MODERN_PROTOCOL_VERSION, "2025-06-18"],
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: INSTRUCTIONS,
    });
  }

  const result = await handleMcpRequest(request, scope);
  if (protocolVersion !== MODERN_PROTOCOL_VERSION || !result || result.error) return result;
  return { ...result, result: modernResult(result.result) };
}
