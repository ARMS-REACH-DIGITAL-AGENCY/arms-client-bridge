import { list, put } from "@vercel/blob";

const HIGHLEVEL_BASE_URL = "https://services.leadconnectorhq.com";
const TOKEN_PATH = "arms-client-bridge/highlevel-agency-oauth.json";

type AgencyTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  companyId?: string;
};

let cachedTokens: AgencyTokens | null = null;

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function oauthConfigured(): boolean {
  return Boolean(env("HIGHLEVEL_OAUTH_CLIENT_ID") && env("HIGHLEVEL_OAUTH_CLIENT_SECRET"));
}

function blobConfigured(): boolean {
  return Boolean(env("BLOB_READ_WRITE_TOKEN") && env("BRIDGE_SIGNING_SECRET"));
}

function encodeBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

async function encryptionKey(): Promise<CryptoKey> {
  const material = new TextEncoder().encode(env("BRIDGE_SIGNING_SECRET"));
  const digest = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encrypt(value: AgencyTokens): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return `${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(encrypted))}`;
}

async function decrypt(value: string): Promise<AgencyTokens> {
  const [ivValue, encryptedValue, extra] = value.split(".");
  if (!ivValue || !encryptedValue || extra) throw new Error("Invalid OAuth token store format");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decodeBase64Url(ivValue) as unknown as BufferSource },
    await encryptionKey(),
    decodeBase64Url(encryptedValue) as unknown as BufferSource,
  );
  const parsed = JSON.parse(new TextDecoder().decode(plain)) as Partial<AgencyTokens>;
  if (!parsed.accessToken || !parsed.refreshToken || !parsed.expiresAt) {
    throw new Error("OAuth token store is incomplete");
  }
  return {
    accessToken: String(parsed.accessToken),
    refreshToken: String(parsed.refreshToken),
    expiresAt: Number(parsed.expiresAt),
    ...(parsed.companyId ? { companyId: String(parsed.companyId) } : {}),
  };
}

async function loadTokens(): Promise<AgencyTokens | null> {
  if (!blobConfigured()) return null;
  if (cachedTokens) return cachedTokens;

  const stored = await list({ prefix: TOKEN_PATH, limit: 1 });
  const blob = stored.blobs.find((entry) => entry.pathname === TOKEN_PATH);
  if (!blob) return null;

  const response = await fetch(blob.url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to read OAuth token store (${response.status})`);
  cachedTokens = await decrypt(await response.text());
  return cachedTokens;
}

async function saveTokens(tokens: AgencyTokens): Promise<void> {
  if (!blobConfigured()) {
    throw new Error("BLOB_READ_WRITE_TOKEN and BRIDGE_SIGNING_SECRET are required to store HighLevel OAuth tokens");
  }
  await put(TOKEN_PATH, await encrypt(tokens), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "text/plain",
    cacheControlMaxAge: 60,
  });
  cachedTokens = tokens;
}

async function requestTokens(parameters: Record<string, string>): Promise<AgencyTokens> {
  if (!oauthConfigured()) {
    throw new Error("HIGHLEVEL_OAUTH_CLIENT_ID and HIGHLEVEL_OAUTH_CLIENT_SECRET are required for HighLevel OAuth");
  }

  const form = new URLSearchParams({
    client_id: env("HIGHLEVEL_OAUTH_CLIENT_ID"),
    client_secret: env("HIGHLEVEL_OAUTH_CLIENT_SECRET"),
    ...parameters,
  });
  const response = await fetch(`${HIGHLEVEL_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      Version: "v3",
    },
    body: form.toString(),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message = String(body.error_description ?? body.message ?? body.error ?? "unknown error");
    throw new Error(`HighLevel OAuth token request failed (${response.status}): ${message.slice(0, 400)}`);
  }

  const accessToken = String(body.access_token ?? "");
  const refreshToken = String(body.refresh_token ?? "");
  if (!accessToken || !refreshToken) throw new Error("HighLevel OAuth token request returned no access or refresh token");

  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + Math.max(300, Number(body.expires_in ?? 86_400) - 120) * 1000,
    ...(body.companyId ? { companyId: String(body.companyId) } : {}),
  };
}

export async function completeAgencyOAuthAuthorization(code: string): Promise<void> {
  const baseUrl = env("BRIDGE_BASE_URL");
  if (!baseUrl) throw new Error("BRIDGE_BASE_URL is required for HighLevel OAuth");
  const tokens = await requestTokens({
    grant_type: "authorization_code",
    code,
    user_type: "Company",
    redirect_uri: `${baseUrl.replace(/\/$/, "")}/api/oauth/callback`,
  });
  await saveTokens(tokens);
}

export async function agencyOAuthAccessToken(): Promise<string | null> {
  const tokens = await loadTokens();
  if (!tokens) return null;
  if (tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken;

  const refreshed = await requestTokens({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
    user_type: "Company",
  });
  await saveTokens(refreshed);
  return refreshed.accessToken;
}

export function highLevelOAuthStatus(): Record<string, boolean> {
  return {
    highlevel_oauth_client_configured: oauthConfigured(),
    highlevel_oauth_token_storage_configured: blobConfigured(),
  };
}
