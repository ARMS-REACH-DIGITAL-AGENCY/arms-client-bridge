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

function defaultLocationId(): string {
  return env("HIGHLEVEL_DEFAULT_LOCATION_ID");
}

function locationPitMap(): Record<string, string> {
  const raw = env("HIGHLEVEL_LOCATION_PITS");
  let parsed: Record<string, string> = {};
  if (raw) {
    try {
      const value = JSON.parse(raw) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        parsed = Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .filter(([, token]) => typeof token === "string" && token.trim())
            .map(([id, token]) => [id, (token as string).trim()]),
        );
      }
    } catch {
      throw new Error("HIGHLEVEL_LOCATION_PITS must be a JSON object mapping location IDs to PITs");
    }
  }

  const legacySusiePit = env("HIGHLEVEL_SUSIE_PIT");
  const defaultId = defaultLocationId();
  if (legacySusiePit && defaultId && !parsed[defaultId]) parsed[defaultId] = legacySusiePit;
  return parsed;
}

function validatePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("://")) {
    throw new Error("path must be a relative HighLevel API path beginning with /");
  }
  const normalized = trimmed.toLowerCase();
  if (normalized === "/oauth" || normalized.startsWith("/oauth/")) {
    throw new Error("OAuth/token endpoints are blocked from the generic bridge tools");
  }
  return trimmed;
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
    throw new Error(
      `No location PIT is configured for ${locationId}, and HIGHLEVEL_AGENCY_PIT is not configured`,
    );
  }
  if (!agencyCompanyId) {
    throw new Error(
      `No location PIT is configured for ${locationId}. Set HIGHLEVEL_COMPANY_ID so the agency token can be exchanged for a location token.`,
    );
  }

  // HighLevel's documented agency -> location exchange. A Private Integration
  // Token is a fixed OAuth2 access token; if the agency PIT is not accepted by
  // this endpoint, configure a location PIT in HIGHLEVEL_LOCATION_PITS instead.
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
      `HighLevel agency-to-location token exchange failed (${response.status}). Configure a location PIT for ${locationId}. ${fallbackMessage.slice(0, 1200)}`,
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

  const resolvedLocationId = locationId?.trim() || defaultLocationId();
  if (!resolvedLocationId) {
    throw new Error("location_id is required unless HIGHLEVEL_DEFAULT_LOCATION_ID is configured");
  }
  return deriveLocationAccessToken(resolvedLocationId);
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

export async function highLevelRequest(options: RequestOptions): Promise<JsonObject> {
  const method = options.method ?? "GET";
  const path = validatePath(options.path);
  const authMode = options.authMode ?? "location";
  const resolvedLocationId = options.locationId?.trim() || defaultLocationId();
  const token = await resolveToken(authMode, resolvedLocationId);
  const url = new URL(`${HIGHLEVEL_BASE_URL}${path}`);
  addQuery(url, options.query);

  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    Version: options.version?.trim() || "2021-07-28",
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
    version: "2021-07-28",
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
    highlevel_default_location_id: defaultLocationId() || null,
    highlevel_location_pit_count: locationPitCount,
    highlevel_location_pit_configuration_error: locationPitParseError,
  };
}
