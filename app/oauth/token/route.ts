import { exchangeAuthorizationCode, refreshBridgeToken, verifyOAuthClient } from "../../../lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Record<string, string>;

async function readParams(request: Request): Promise<Params> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(body).map(([key, value]) => [key, typeof value === "string" ? value : String(value ?? "")]),
    );
  }
  const form = await request.formData();
  const params: Params = {};
  form.forEach((value, key) => {
    if (typeof value === "string") params[key] = value;
  });
  return params;
}

function basicClient(request: Request): { clientId?: string; clientSecret?: string } {
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("basic ")) return {};
  try {
    const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return {};
    return {
      clientId: decodeURIComponent(decoded.slice(0, separator)),
      clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
    };
  } catch {
    return {};
  }
}

function oauthError(error: string, description: string, status = 400) {
  return Response.json(
    { error, error_description: description },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  let params: Params;
  try {
    params = await readParams(request);
  } catch {
    return oauthError("invalid_request", "Unable to parse token request");
  }

  const basic = basicClient(request);
  const clientId = basic.clientId || params.client_id || params.clientId || "";
  const clientSecret = basic.clientSecret || params.client_secret || params.clientSecret || undefined;
  const grantType = params.grant_type || params.grantType || "";

  try {
    if (!clientId) return oauthError("invalid_client", "client_id is required", 401);
    verifyOAuthClient(clientId);

    if (grantType === "authorization_code") {
      const code = params.code || "";
      const redirectUri = params.redirect_uri || params.redirectUri || "";
      const codeVerifier = params.code_verifier || params.codeVerifier || "";
      if (!code || !redirectUri || !codeVerifier) {
        return oauthError("invalid_request", "code, redirect_uri, and code_verifier are required");
      }
      const tokens = exchangeAuthorizationCode({
        code,
        clientId,
        clientSecret,
        redirectUri,
        codeVerifier,
      });
      return Response.json(tokens, { headers: { "Cache-Control": "no-store" } });
    }

    if (grantType === "refresh_token") {
      const refreshToken = params.refresh_token || params.refreshToken || "";
      if (!refreshToken) return oauthError("invalid_request", "refresh_token is required");
      const tokens = refreshBridgeToken({
        refreshToken,
        clientId,
        clientSecret,
        scope: params.scope,
      });
      return Response.json(tokens, { headers: { "Cache-Control": "no-store" } });
    }

    return oauthError("unsupported_grant_type", "Supported grants: authorization_code, refresh_token");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Token request failed";
    const status = message === "invalid_client" ? 401 : 400;
    return oauthError(message === "invalid_client" ? "invalid_client" : "invalid_grant", message, status);
  }
}
