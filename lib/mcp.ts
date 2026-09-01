import {
  bridgeHighLevelStatus,
  getContact,
  highLevelRequest,
  listCalendars,
  listContacts,
  listCustomFields,
  listLocations,
  listProducts,
  listWorkflows,
  verifyLocation,
} from "./highlevel";

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
const SERVER_VERSION = "0.3.2";

const locationIdProperty = {
  type: "string",
  description: "HighLevel client/sub-account location ID. Required for every client-scoped operation.",
} as const;

const tools = [
  {
    name: "arms_status",
    title: "ARMS Bridge Status",
    description: "Check agency-level HighLevel bridge readiness and fallback configuration. Never returns secrets.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "arms_list_locations",
    title: "List ARMS Clients",
    description: "List or search HighLevel sub-accounts accessible to the ARMS agency credential.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Optional client name/email search text." },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 100 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "arms_verify_location",
    title: "Verify ARMS Client",
    description: "Verify direct access to one explicit HighLevel client/sub-account.",
    inputSchema: {
      type: "object",
      required: ["location_id"],
      properties: { location_id: locationIdProperty },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "arms_list_contacts",
    title: "List Client Contacts",
    description: "List recent contacts in one HighLevel client/sub-account. Optionally search by name, email, or phone text supported by HighLevel.",
    inputSchema: {
      type: "object",
      required: ["location_id"],
      properties: {
        location_id: locationIdProperty,
        search: { type: "string", description: "Optional contact search text." },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "arms_get_contact",
    title: "Get Client Contact",
    description: "Read one contact from one HighLevel client/sub-account.",
    inputSchema: {
      type: "object",
      required: ["location_id", "contact_id"],
      properties: {
        location_id: locationIdProperty,
        contact_id: { type: "string", description: "HighLevel contact ID." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "arms_list_workflows",
    title: "List Client Workflows",
    description: "List workflows for one HighLevel client/sub-account.",
    inputSchema: {
      type: "object",
      required: ["location_id"],
      properties: { location_id: locationIdProperty },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "arms_list_custom_fields",
    title: "List Client Custom Fields",
    description: "List custom fields for one HighLevel client/sub-account.",
    inputSchema: {
      type: "object",
      required: ["location_id"],
      properties: {
        location_id: locationIdProperty,
        model: { type: "string", default: "contact", description: "HighLevel field model, normally contact." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "arms_list_calendars",
    title: "List Client Calendars",
    description: "List calendars for one HighLevel client/sub-account.",
    inputSchema: {
      type: "object",
      required: ["location_id"],
      properties: {
        location_id: locationIdProperty,
        show_drafted: { type: "boolean", default: true },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "arms_list_products",
    title: "List Client Products",
    description: "List products for one HighLevel client/sub-account.",
    inputSchema: {
      type: "object",
      required: ["location_id"],
      properties: {
        location_id: locationIdProperty,
        search: { type: "string", description: "Optional product search text." },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 100 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "arms_highlevel_get",
    title: "Read HighLevel API (Advanced)",
    description: "Advanced fallback GET against the official HighLevel API. Prefer the typed ARMS tools above.",
    inputSchema: {
      type: "object",
      required: [],
      properties: {
        api_path: { type: "string", description: "Relative HighLevel API path beginning with /. Prefer this field over path." },
        path: { type: "string", description: "Legacy alias for api_path." },
        location_id: { type: "string", description: "Required for location-scoped requests." },
        auth_mode: { type: "string", enum: ["location", "agency"], default: "location" },
        query: { type: "object", additionalProperties: true },
        version: { type: "string" },
        max_chars: { type: "integer", minimum: 1000, maximum: 150000, default: 80000 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "arms_highlevel_mutate",
    title: "Modify HighLevel API (Advanced)",
    description: "Advanced approved write operation against HighLevel. Read current state first and prefer future typed write tools when available.",
    inputSchema: {
      type: "object",
      required: ["method"],
      properties: {
        method: { type: "string", enum: ["POST", "PUT", "PATCH", "DELETE"] },
        api_path: { type: "string", description: "Relative HighLevel API path beginning with /. Prefer this field over path." },
        path: { type: "string", description: "Legacy alias for api_path." },
        location_id: { type: "string", description: "Required for location-scoped requests." },
        auth_mode: { type: "string", enum: ["location", "agency"], default: "location" },
        query: { type: "object", additionalProperties: true },
        body: {},
        version: { type: "string" },
        max_chars: { type: "integer", minimum: 1000, maximum: 150000, default: 80000 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
] as const;

function idOf(request: McpRequest): string | number | null { return request.id ?? null; }
function ok(request: McpRequest, result: unknown): McpResponse { return { jsonrpc: "2.0", id: idOf(request), result }; }
function fail(request: McpRequest, code: number, message: string, data?: unknown): McpResponse {
  return { jsonrpc: "2.0", id: idOf(request), error: { code, message, ...(data === undefined ? {} : { data }) } };
}
function numberArg(value: unknown, fallback: number): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function stringArg(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function requiredStringArg(value: unknown, name: string): string {
  const parsed = stringArg(value);
  if (!parsed) throw new Error(`${name} is required`);
  return parsed;
}
function boolArg(value: unknown, fallback: boolean): boolean { return typeof value === "boolean" ? value : fallback; }
function objectArg(value: unknown): Record<string, string | number | boolean | null | undefined | Array<string | number | boolean>> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, string | number | boolean | null | undefined | Array<string | number | boolean>>)
    : undefined;
}
function hasScope(scope: string | undefined, required: "arms.read" | "arms.write"): boolean {
  return new Set((scope ?? "").split(/\s+/).filter(Boolean)).has(required);
}

async function callTool(name: string, args: Record<string, unknown>, scope?: string): Promise<unknown> {
  if (name === "arms_status") {
    if (!hasScope(scope, "arms.read")) throw new Error("insufficient_scope: arms.read is required");
    return { service: "arms-client-bridge", version: SERVER_VERSION, ...bridgeHighLevelStatus() };
  }
  if (name === "arms_list_locations") {
    if (!hasScope(scope, "arms.read")) throw new Error("insufficient_scope: arms.read is required");
    return listLocations(stringArg(args.search), numberArg(args.limit, 100));
  }
  if (name === "arms_verify_location") {
    if (!hasScope(scope, "arms.read")) throw new Error("insufficient_scope: arms.read is required");
    return verifyLocation(requiredStringArg(args.location_id, "location_id"));
  }
  if (name === "arms_list_contacts") {
    if (!hasScope(scope, "arms.read")) throw new Error("insufficient_scope: arms.read is required");
    return listContacts(requiredStringArg(args.location_id, "location_id"), stringArg(args.search), numberArg(args.limit, 20));
  }
  if (name === "arms_get_contact") {
    if (!hasScope(scope, "arms.read")) throw new Error("insufficient_scope: arms.read is required");
    return getContact(requiredStringArg(args.location_id, "location_id"), requiredStringArg(args.contact_id, "contact_id"));
  }
  if (name === "arms_list_workflows") {
    if (!hasScope(scope, "arms.read")) throw new Error("insufficient_scope: arms.read is required");
    return listWorkflows(requiredStringArg(args.location_id, "location_id"));
  }
  if (name === "arms_list_custom_fields") {
    if (!hasScope(scope, "arms.read")) throw new Error("insufficient_scope: arms.read is required");
    return listCustomFields(requiredStringArg(args.location_id, "location_id"), stringArg(args.model) ?? "contact");
  }
  if (name === "arms_list_calendars") {
    if (!hasScope(scope, "arms.read")) throw new Error("insufficient_scope: arms.read is required");
    return listCalendars(requiredStringArg(args.location_id, "location_id"), boolArg(args.show_drafted, true));
  }
  if (name === "arms_list_products") {
    if (!hasScope(scope, "arms.read")) throw new Error("insufficient_scope: arms.read is required");
    return listProducts(requiredStringArg(args.location_id, "location_id"), numberArg(args.limit, 100), stringArg(args.search));
  }
  if (name === "arms_highlevel_get") {
    if (!hasScope(scope, "arms.read")) throw new Error("insufficient_scope: arms.read is required");
    const path = requiredStringArg(args.api_path ?? args.path, "api_path");
    const authMode = args.auth_mode === "agency" ? "agency" : "location";
    const rawQuery = args.query && typeof args.query === "object" && !Array.isArray(args.query)
      ? (args.query as Record<string, unknown>)
      : {};
    const compatibilityResource = stringArg(rawQuery.arms_resource);

    if (path === "/" && compatibilityResource) {
      const locationId = requiredStringArg(args.location_id, "location_id");
      if (compatibilityResource === "workflows") return listWorkflows(locationId);
      if (compatibilityResource === "contacts") {
        return listContacts(locationId, stringArg(rawQuery.search), numberArg(rawQuery.limit, 20));
      }
      if (compatibilityResource === "contact") {
        return getContact(locationId, requiredStringArg(rawQuery.contact_id, "contact_id"));
      }
      if (compatibilityResource === "custom_fields") {
        return listCustomFields(locationId, stringArg(rawQuery.model) ?? "contact");
      }
      if (compatibilityResource === "calendars") {
        return listCalendars(locationId, boolArg(rawQuery.show_drafted, true));
      }
      if (compatibilityResource === "products") {
        return listProducts(locationId, numberArg(rawQuery.limit, 100), stringArg(rawQuery.search));
      }
      if (compatibilityResource === "location") return verifyLocation(locationId);
      throw new Error(`Unknown compatibility resource: ${compatibilityResource}`);
    }

    return highLevelRequest({ method: "GET", path, locationId: stringArg(args.location_id), authMode, query: objectArg(args.query), version: stringArg(args.version), maxChars: numberArg(args.max_chars, 80_000) });
  }
  if (name === "arms_highlevel_mutate") {
    if (!hasScope(scope, "arms.write")) throw new Error("insufficient_scope: arms.write is required");
    const path = requiredStringArg(args.api_path ?? args.path, "api_path");
    const method = requiredStringArg(args.method, "method").toUpperCase();
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) throw new Error("method must be POST, PUT, PATCH, or DELETE");
    const authMode = args.auth_mode === "agency" ? "agency" : "location";
    return highLevelRequest({ method: method as "POST" | "PUT" | "PATCH" | "DELETE", path, locationId: stringArg(args.location_id), authMode, query: objectArg(args.query), body: args.body, version: stringArg(args.version), maxChars: numberArg(args.max_chars, 80_000) });
  }
  throw new Error(`Unknown tool: ${name}`);
}

function textContent(value: unknown): Array<{ type: "text"; text: string }> { return [{ type: "text", text: JSON.stringify(value, null, 2) }]; }

export async function handleMcpRequest(request: McpRequest, scope?: string): Promise<McpResponse | null> {
  if (request.jsonrpc !== "2.0" || !request.method) return fail(request, -32600, "Invalid Request");
  if (request.method === "notifications/initialized" || request.method.startsWith("notifications/")) return null;
  if (request.method === "initialize") {
    const requestedVersion = stringArg(request.params?.protocolVersion) ?? PROTOCOL_VERSION;
    return ok(request, {
      protocolVersion: requestedVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "ARMS Client Bridge", version: SERVER_VERSION },
      instructions: "Agency-first ARMS bridge for HighLevel. Search/list clients with agency auth, then pass an explicit location_id for all client CRM operations. Read current state before writes.",
    });
  }
  if (request.method === "ping") return ok(request, {});
  if (request.method === "tools/list") return ok(request, { tools });
  if (request.method === "tools/call") {
    const name = stringArg(request.params?.name);
    const args = request.params?.arguments && typeof request.params.arguments === "object" && !Array.isArray(request.params.arguments)
      ? (request.params.arguments as Record<string, unknown>) : {};
    if (!name) return fail(request, -32602, "Tool name is required");
    try {
      const value = await callTool(name, args, scope);
      return ok(request, { content: textContent(value), isError: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool execution failed";
      return ok(request, { content: textContent({ error: message }), isError: true });
    }
  }
  return fail(request, -32601, `Method not found: ${request.method}`);
}
