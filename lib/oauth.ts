import { createHash } from "crypto";
import { bridgeBaseUrl, pkceChallenge, safeEqual, signToken, verifyToken } from "./security";

type BaseSigned = {
  typ: string;
  iat: number;
  exp: number;
  jti: string;
};

type ClientPayload = BaseSigned & {
  redirect_uris: string[];
  client_name?: string;
  token_endpoint_auth_method?: string;
};

type ClientSecretPayload = BaseSigned & {
  client_hash: string;
};

type AuthorizationCodePayload = BaseSigned & {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
};

type RefreshPayload = BaseSigned & {
  client_id: string;
  scope: string;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function oauthMetadata(requestUrl?: string) {
  const base = bridgeBaseUrl(requestUrl);
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
    scopes_supported: ["arms.read", "arms.write", "offline_access"],
  };
}

export function resourceMetadata(requestUrl?: string) {
  const base = bridgeBaseUrl(requestUrl);
  return {
    resource: `${base}/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    scopes_supported: ["arms.read", "arms.write", "offline_access"],
    resource_documentation: base,
  };
}

export function registerOAuthClient(input: {
  redirect_uris: string[];
  client_name?: string;
  token_endpoint_auth_method?: string;
}) {
  const redirectUris = input.redirect_uris
    .filter((value) => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!redirectUris.length) throw new Error("redirect_uris is required");
  for (const redirectUri of redirectUris) {
    const url = new URL(redirectUri);
    if (url.protocol !== "https:" && url.hostname !== "localhost") {
      throw new Error("redirect URIs must use HTTPS (localhost is allowed for development)");
    }
  }

  const authMethod = input.token_endpoint_auth_method || "client_secret_post";
  if (!["client_secret_basic", "client_secret_post", "none"].includes(authMethod)) {
    throw new Error("unsupported token_endpoint_auth_method");
  }
  const clientId = signToken(
    "oauth_client",
    {
      redirect_uris: redirectUris,
      client_name: input.client_name?.slice(0, 200) || "ChatGPT MCP Client",
      token_endpoint_auth_method: authMethod,
    },
    365 * 24 * 60 * 60,
  );
  const clientSecret = signToken(
    "oauth_client_secret",
    { client_hash: sha256(clientId) },
    365 * 24 * 60 * 60,
  );

  return {
    client_id: clientId,
    client_secret: clientSecret,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_secret_expires_at: 0,
    redirect_uris: redirectUris,
    client_name: input.client_name || "ChatGPT MCP Client",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: authMethod,
  };
}

export function verifyOAuthClient(clientId: string): ClientPayload {
  return verifyToken<ClientPayload>(clientId, "oauth_client");
}

export function verifyOAuthClientSecret(clientId: string, clientSecret?: string): void {
  const client = verifyOAuthClient(clientId);
  const method = client.token_endpoint_auth_method || "client_secret_post";
  if (method === "none") {
    if (clientSecret) throw new Error("invalid_client");
    return;
  }
  if (!clientSecret) throw new Error("invalid_client");
  const payload = verifyToken<ClientSecretPayload>(clientSecret, "oauth_client_secret");
  if (!safeEqual(payload.client_hash, sha256(clientId))) throw new Error("invalid_client");
}

export function assertRedirectUri(clientId: string, redirectUri: string): ClientPayload {
  const client = verifyOAuthClient(clientId);
  if (!client.redirect_uris.includes(redirectUri)) throw new Error("invalid_redirect_uri");
  return client;
}

export function createAuthorizationCode(input: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
}): string {
  assertRedirectUri(input.clientId, input.redirectUri);
  if (!input.codeChallenge) throw new Error("PKCE code_challenge is required");
  return signToken(
    "oauth_code",
    {
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      code_challenge: input.codeChallenge,
      scope: normalizeScope(input.scope),
    },
    5 * 60,
  );
}

export function exchangeAuthorizationCode(input: {
  code: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  codeVerifier: string;
}) {
  verifyOAuthClientSecret(input.clientId, input.clientSecret);
  const code = verifyToken<AuthorizationCodePayload>(input.code, "oauth_code");
  if (!safeEqual(code.client_id, input.clientId)) throw new Error("invalid_grant");
  if (!safeEqual(code.redirect_uri, input.redirectUri)) throw new Error("invalid_grant");
  if (!input.codeVerifier || !safeEqual(pkceChallenge(input.codeVerifier), code.code_challenge)) {
    throw new Error("invalid_grant");
  }
  return issueTokens(input.clientId, code.scope);
}

export function refreshBridgeToken(input: {
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
  scope?: string;
}) {
  verifyOAuthClientSecret(input.clientId, input.clientSecret);
  const refresh = verifyToken<RefreshPayload>(input.refreshToken, "bridge_refresh");
  if (!safeEqual(refresh.client_id, input.clientId)) throw new Error("invalid_grant");

  const originalScope = normalizeScope(refresh.scope);
  const requestedScope = input.scope ? normalizeScope(input.scope) : originalScope;
  const original = new Set(originalScope.split(/\s+/).filter(Boolean));
  const requested = requestedScope.split(/\s+/).filter(Boolean);
  if (requested.some((scope) => !original.has(scope))) throw new Error("invalid_scope");

  return issueTokens(input.clientId, requestedScope);
}

function normalizeScope(scope: string): string {
  const allowed = new Set(["arms.read", "arms.write", "offline_access"]);
  const requested = scope
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => allowed.has(item));
  if (!requested.includes("arms.read")) requested.unshift("arms.read");
  return Array.from(new Set(requested)).join(" ");
}

function issueTokens(clientId: string, scope: string) {
  const normalizedScope = normalizeScope(scope);
  return {
    access_token: signToken(
      "bridge_access",
      { client_id: clientId, scope: normalizedScope },
      60 * 60,
    ),
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: signToken(
      "bridge_refresh",
      { client_id: clientId, scope: normalizedScope },
      90 * 24 * 60 * 60,
    ),
    scope: normalizedScope,
  };
}

export function adminPasswordMatches(value: string): boolean {
  const expected = process.env.BRIDGE_ADMIN_PASSWORD?.trim();
  return Boolean(expected && safeEqual(value, expected));
}
