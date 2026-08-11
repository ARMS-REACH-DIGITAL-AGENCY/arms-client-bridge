const HIGHLEVEL_BASE_URL = "https://services.leadconnectorhq.com";

type JsonObject = Record<string, unknown>;
type QueryValue = string | number | boolean | null | undefined | Array<string | number | boolean>;

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  locationId?: string;
  authMode?: "agency" | "location";
  query?: Record<string, QueryValue>;
  body?: unknown;
  version?: string;
  maxChars?: number;
};

type CachedLocationToken = {
  token: string;
  expiresAt: number;
};

const locationTokenCache = new Map<string, CachedLocationToken>();

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function agencyPit(): string {
  return env("HIGHLEVEL_AGENCY_PIT");
}

function companyId(): string {
  return env("HIGHLEVEL_COMPANY_ID");
}

function requiredLocationId(locationId?: string): string {
  const resolved = locationId?.trim();
  if (!resolved) throw new Error("location_id is required for client/sub-account operations");
  return resolved;
}

function locationPitMap(): Record<string, string> {
  const raw = env("HIGHLEVEL_LOCATION_PITS");
  if (!raw) return {};

  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("HIGHLEVEL_LOCATION_PITS must be a JSON object mapping location IDs to PITs");
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, token]) => typeof token === "string" && token.trim())
        .map(([id, token]) => [id, (token as string).trim()]),
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("HIGHLEVEL_LOCATION_PITS")) throw error;
    throw new Error("HIGHLEVEL_LOCATION_PITS must be a JSON object mapping location IDs to PITs");
  }
}

function decodePathname(value: string): string {
  let decoded = value;
  for (let i = 0; i < 3; i += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded.toLowerCase();
}

function buildHighLevelUrl(path: string): { path: string; url: URL } {
  const trimmed = path.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("://")) {
    throw new Error("path must be a relative HighLevel API path beginning with /");
  }
  if (trimmed.includes("\\") || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error("path contains unsupported characters");
  }

  const url = new URL(`${HIGHLEVEL_BASE_URL}${trimmed}`);
  if (url.origin !== HIGHLEVEL_BASE_URL) {
    throw new Error("HighLevel requests are restricted to services.leadconnectorhq.com");
  }

  const normalizedPathname = decodePathname(url.pathname);
  if (normalizedPathname === "/oauth" || normalizedPathname.startsWith("/oauth/")) {
    throw new Error("OAuth/token endpoints are blocked from generic bridge tools");
  }

  return { path: trimmed, url };
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[max-depth]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (!value || typeof value !== "object") return value;

  const result: JsonObject = {};
  for (const [key, item] of Object.entries(value as JsonObject)) {
    if (/token|secret|authorization|password|api[-_]?key/i.test(key)) {
      result[key] = "[redacted]";
    } else {
      result[key] = redact(item, depth + 1);
    }
  }
  return result;
}

async function responseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function truncate(value: unknown, maxChars: number): { data: unknown; truncated: boolean } {
  const redacted = redact(value);
  const serialized = JSON.stringify(redacted);
  if (serialized.length <= maxChars) return { data: redacted, truncated: false };
  return {
    data: `${serialized.slice(0, maxChars)}…`,
    truncated: true,
  };
}

async function deriveLocationAccessToken(locationId: string): Promise<string> {
  const directPit = locationPitMap()[locationId];
  if (directPit) return directPit;

  const cached = locationTokenCache.get(locationId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const agencyToken = agencyPit();
  const agencyCompanyId = companyId();
  if (!agencyToken) {
    throw new Error(`HIGHLEVEL_AGENCY_PIT is required to derive access for ${locationId}`);
  }
  if (!agencyCompanyId) {
    throw new Error(
      `HIGHLEVEL_COMPANY_ID is required to derive location access for ${locationId}; configure a location PIT only as a fallback`,
    );
  }

  const form = new URLSearchParams({ companyId: agencyCompanyId, locationId });
  const response = await fetch(`${HIGHLEVEL_BASE_URL}/oauth/locationToken`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${agencyToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Version: "2021-07-28",
    },
    body: form.toString(),
    cache: "no-store",
  });

  const data = (await responseBody(response)) as JsonObject | string | null;
  if (!response.ok) {
    const fallbackMessage =
      typeof data === "string" ? data : JSON.stringify(redact(data ?? { status: response.status }));
    throw new Error(
      `HighLevel agency-to-location token exchange failed (${response.status}) for ${locationId}. ${fallbackMessage.slice(0, 1200)}`,
    );
  }

  const token =
    data && typeof data === "object"
      ? String((data as JsonObject).access_token ?? (data as JsonObject).accessToken ?? "")
      : "";
  if (!token) throw new Error("HighLevel location token exchange returned no access token");

  const expiresIn =
    data && typeof data === "object" ? Number((data as JsonObject).expires_in ?? 3600) : 3600;
  locationTokenCache.set(locationId, {
    token,
    expiresAt: Date.now() + Math.max(300, expiresIn - 120) * 1000,
  });
  return token;
}

async function resolveToken(authMode: "agency" | "location", locationId?: string): Promise<string> {
  if (authMode === "agency") {
    const token = agencyPit();
    if (!token) throw new Error("HIGHLEVEL_AGENCY_PIT is not configured");
    return token;
  }
  return deriveLocationAccessToken(requiredLocationId(locationId));
}

function addQuery(url: URL, query?: Record<string, QueryValue>): void {
  if (!query) return;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      value.forEach((item) => url.searchParams.append(key, String(item)));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
}

function inferredVersion(path: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  if (path === "/locations/search" || /^\/locations\/[^/]+$/.test(path)) return "v3";
  return "2021-07-28";
}

export async function highLevelRequest(options: RequestOptions): Promise<JsonObject> {
  const method = options.method ?? "GET";
  const built = buildHighLevelUrl(options.path);
  const path = built.path;
  const url = built.url;
  const authMode = options.authMode ?? "location";
  const resolvedLocationId = authMode === "location" ? requiredLocationId(options.locationId) : options.locationId?.trim();
  const token = await resolveToken(authMode, resolvedLocationId);
  addQuery(url, options.query);

  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    Version: inferredVersion(path, options.version),
  };

  const init: RequestInit = { method, headers, cache: "no-store" };
  if (method !== "GET" && method !== "DELETE" && options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  if (method === "DELETE" && options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, init);
  const raw = await responseBody(response);
  const maxChars = Math.min(Math.max(options.maxChars ?? 80_000, 1_000), 150_000);
  const limited = truncate(raw, maxChars);

  return {
    ok: response.ok,
    status: response.status,
    method,
    path,
    auth_mode: authMode,
    location_id: resolvedLocationId || null,
    request_id: response.headers.get("x-request-id") ?? response.headers.get("trace-id") ?? null,
    truncated: limited.truncated,
    data: limited.data,
  };
}

export async function listLocations(search?: string, limit = 100): Promise<JsonObject> {
  const query: Record<string, QueryValue> = {
    limit: Math.min(Math.max(limit, 1), 100),
  };
  const agencyCompanyId = companyId();
  if (agencyCompanyId) query.companyId = agencyCompanyId;
  if (search?.trim()) query.search = search.trim();

  return highLevelRequest({
    method: "GET",
    path: "/locations/search",
    authMode: "agency",
    query,
    version: "v3",
    maxChars: 120_000,
  });
}

export async function verifyLocation(locationId: string): Promise<JsonObject> {
  const resolvedLocationId = requiredLocationId(locationId);
  return highLevelRequest({
    method: "GET",
    path: `/locations/${encodeURIComponent(resolvedLocationId)}`,
    locationId: resolvedLocationId,
    authMode: "location",
    version: "v3",
    maxChars: 40_000,
  });
}

export async function listContacts(
  locationId: string,
  search?: string,
  limit = 20,
): Promise<JsonObject> {
  const resolvedLocationId = requiredLocationId(locationId);
  return highLevelRequest({
    method: "GET",
    path: "/contacts/",
    locationId: resolvedLocationId,
    authMode: "location",
    query: {
      locationId: resolvedLocationId,
      limit: Math.min(Math.max(limit, 1), 100),
      ...(search?.trim() ? { query: search.trim() } : {}),
    },
    version: "2021-07-28",
    maxChars: 120_000,
  });
}

export async function getContact(locationId: string, contactId: string): Promise<JsonObject> {
  const resolvedLocationId = requiredLocationId(locationId);
  const resolvedContactId = contactId.trim();
  if (!resolvedContactId) throw new Error("contact_id is required");
  return highLevelRequest({
    method: "GET",
    path: `/contacts/${encodeURIComponent(resolvedContactId)}`,
    locationId: resolvedLocationId,
    authMode: "location",
    version: "2021-07-28",
    maxChars: 80_000,
  });
}

export async function listWorkflows(locationId: string): Promise<JsonObject> {
  const resolvedLocationId = requiredLocationId(locationId);
  return highLevelRequest({
    method: "GET",
    path: "/workflows/",
    locationId: resolvedLocationId,
    authMode: "location",
    query: { locationId: resolvedLocationId },
    version: "v3",
    maxChars: 120_000,
  });
}

export async function listCustomFields(locationId: string, model = "contact"): Promise<JsonObject> {
  const resolvedLocationId = requiredLocationId(locationId);
  return highLevelRequest({
    method: "GET",
    path: `/locations/${encodeURIComponent(resolvedLocationId)}/customFields`,
    locationId: resolvedLocationId,
    authMode: "location",
    query: { model },
    version: "2023-02-21",
    maxChars: 120_000,
  });
}

export async function listCalendars(locationId: string, showDrafted = true): Promise<JsonObject> {
  const resolvedLocationId = requiredLocationId(locationId);
  return highLevelRequest({
    method: "GET",
    path: "/calendars/",
    locationId: resolvedLocationId,
    authMode: "location",
    query: { locationId: resolvedLocationId, showDrafted },
    version: "v3",
    maxChars: 120_000,
  });
}

export async function listProducts(locationId: string, limit = 100, search?: string): Promise<JsonObject> {
  const resolvedLocationId = requiredLocationId(locationId);
  return highLevelRequest({
    method: "GET",
    path: "/products/",
    locationId: resolvedLocationId,
    authMode: "location",
    query: {
      locationId: resolvedLocationId,
      limit: Math.min(Math.max(limit, 1), 100),
      ...(search?.trim() ? { search: search.trim() } : {}),
    },
    version: "v3",
    maxChars: 120_000,
  });
}

export function bridgeHighLevelStatus(): JsonObject {
  let locationPitCount = 0;
  let locationPitParseError: string | null = null;
  try {
    locationPitCount = Object.keys(locationPitMap()).length;
  } catch (error) {
    locationPitParseError = error instanceof Error ? error.message : "invalid location PIT configuration";
  }

  return {
    highlevel_agency_pit_configured: Boolean(agencyPit()),
    highlevel_company_id_configured: Boolean(companyId()),
    highlevel_agency_first_ready: Boolean(agencyPit() && companyId()),
    highlevel_location_pit_fallback_count: locationPitCount,
    highlevel_location_pit_configuration_error: locationPitParseError,
  };
}
