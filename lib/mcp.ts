import { bridgeHighLevelStatus, highLevelRequest, listLocations } from "./highlevel";

export type McpRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

export type McpResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

const PROTOCOL_VERSION = "2025-06-18";

const tools = [
  {
    name: "arms_status",
    title: "ARMS Bridge Status",
    description:
      "Check whether the ARMS Client Bridge is configured for HighLevel agency and sub-account access. Returns configuration flags only; never returns secrets.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "arms_list_locations",
    title: "List ARMS Sub-Accounts",
    description:
      "List or search HighLevel sub-accounts accessible to the configured ARMS agency credential. Use this to resolve a client/location ID before making location-scoped requests.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Optional location name/email search text." },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 100 },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "arms_highlevel_get",
    title: "Read HighLevel API",
    description:
      "Perform a read-only GET request against the official HighLevel API through the ARMS bridge. The path must be relative (for example /contacts/ or /calendars/). OAuth/token endpoints are blocked. Use auth_mode=location for client CRM data and auth_mode=agency for agency-level endpoints.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string", pattern: "^/", description: "HighLevel API path beginning with /." },
        location_id: { type: "string", description: "HighLevel sub-account/location ID. Optional when a default location is configured." },
        auth_mode: { type: "string", enum: ["location", "agency"], default: "location" },
        query: { type: "object", description: "Query-string parameters.", additionalProperties: true },
        version: { type: "string", default: "2021-07-28", description: "HighLevel Version header, such as 2021-07-28, 2023-02-21, or v3." },
        max_chars: { type: "integer", minimum: 1000, maximum: 150000, default: 80000 },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "arms_highlevel_mutate",
    title: "Modify HighLevel API",
    description:
      "Perform an approved HighLevel write operation (POST, PUT, PATCH, or DELETE) through the ARMS bridge. Use only after reading the current object/configuration and confirming the intended change. OAuth/token endpoints are blocked.",
    inputSchema: {
      type: "object",
      required: ["method", "path"],
      properties: {
        method: { type: "string", enum: ["POST", "PUT", "PATCH", "DELETE"] },
        path: { type: "string", pattern: "^/", description: "HighLevel API path beginning with /." },
        location_id: { type: "string", description: "HighLevel sub-account/location ID. Optional when a default location is configured." },
        auth_mode: { type: "string", enum: ["location", "agency"], default: "location" },
        query: { type: "object", description: "Query-string parameters.", additionalProperties: true },
        body: { description: "JSON request body. Omit when the endpoint requires no body." },
        version: { type: "string", default: "2021-07-28", description: "HighLevel Version header, such as 2021-07-28, 2023-02-21, or v3." },
        max_chars: { type: "integer", minimum: 1000, maximum: 150000, default: 80000 },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
] as const;

function idOf(request: McpRequest): string | number | null {
  return request.id ?? null;
}

function ok(request: McpRequest, result: unknown): McpResponse {
  return { jsonrpc: "2.0", id: idOf(request), result };
}

function fail(request: McpRequest, code: number, message: string, data?: unknown): McpResponse {
  return { jsonrpc: "2.0", id: idOf(request), error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function numberArg(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringArg(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function objectArg(value: unknown): Record<string, string | number | boolean | null | undefined | Array<string | number | boolean>> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, string | number | boolean | null | undefined | Array<string | number | boolean>>)
    : undefined;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === "arms_status") {
    return {
      service: "arms-client-bridge",
      version: "0.2.0",
      ...bridgeHighLevelStatus(),
    };
  }

  if (name === "arms_list_locations") {
    return listLocations(stringArg(args.search), numberArg(args.limit, 100));
  }

  if (name === "arms_highlevel_get") {
    const path = stringArg(args.path);
    if (!path) throw new Error("path is required");
    const authMode = args.auth_mode === "agency" ? "agency" : "location";
    return highLevelRequest({
      method: "GET",
      path,
      locationId: stringArg(args.location_id),
      authMode,
      query: objectArg(args.query),
      version: stringArg(args.version),
      maxChars: numberArg(args.max_chars, 80_000),
    });
  }

  if (name === "arms_highlevel_mutate") {
    const path = stringArg(args.path);
    const method = stringArg(args.method)?.toUpperCase();
    if (!path) throw new Error("path is required");
    if (!method || !["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      throw new Error("method must be POST, PUT, PATCH, or DELETE");
    }
    const authMode = args.auth_mode === "agency" ? "agency" : "location";
    return highLevelRequest({
      method: method as "POST" | "PUT" | "PATCH" | "DELETE",
      path,
      locationId: stringArg(args.location_id),
      authMode,
      query: objectArg(args.query),
      body: args.body,
      version: stringArg(args.version),
      maxChars: numberArg(args.max_chars, 80_000),
    });
  }

  throw new Error(`Unknown tool: ${name}`);
}

function textContent(value: unknown): Array<{ type: "text"; text: string }> {
  return [{ type: "text", text: JSON.stringify(value, null, 2) }];
}

export async function handleMcpRequest(request: McpRequest): Promise<McpResponse | null> {
  if (request.jsonrpc !== "2.0" || !request.method) {
    return fail(request, -32600, "Invalid Request");
  }

  if (request.method === "notifications/initialized" || request.method.startsWith("notifications/")) {
    return null;
  }

  if (request.method === "initialize") {
    const requestedVersion = stringArg(request.params?.protocolVersion) ?? PROTOCOL_VERSION;
    return ok(request, {
      protocolVersion: requestedVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "ARMS Client Bridge", version: "0.2.0" },
      instructions:
        "Internal ARMS bridge for HighLevel agency and client sub-account operations. Read current state before writes. Use location-scoped auth for client CRM data and agency-scoped auth for agency resources.",
    });
  }

  if (request.method === "ping") return ok(request, {});

  if (request.method === "tools/list") {
    return ok(request, { tools });
  }

  if (request.method === "tools/call") {
    const name = stringArg(request.params?.name);
    const args =
      request.params?.arguments && typeof request.params.arguments === "object" && !Array.isArray(request.params.arguments)
        ? (request.params.arguments as Record<string, unknown>)
        : {};
    if (!name) return fail(request, -32602, "Tool name is required");

    try {
      const value = await callTool(name, args);
      return ok(request, { content: textContent(value), isError: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool execution failed";
      return ok(request, { content: textContent({ error: message }), isError: true });
    }
  }

  return fail(request, -32601, `Method not found: ${request.method}`);
}
