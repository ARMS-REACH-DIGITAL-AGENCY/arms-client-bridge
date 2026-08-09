import { bridgeBaseUrl, safeEqual, verifyToken } from "./security";

type BridgeAccessPayload = {
  typ: string;
  iat: number;
  exp: number;
  jti: string;
  scope?: string;
  client_id?: string;
};

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

export function bridgeAuthConfigured(): boolean {
  return Boolean(
    process.env.BRIDGE_API_KEY?.trim() ||
      (process.env.BRIDGE_SIGNING_SECRET?.trim() && process.env.BRIDGE_ADMIN_PASSWORD?.trim()),
  );
}

export function authorizeBridgeRequest(request: Request): {
  ok: boolean;
  mode?: "api_key" | "oauth";
  scope?: string;
} {
  const token = bearerToken(request);
  if (!token) return { ok: false };

  const apiKey = process.env.BRIDGE_API_KEY?.trim();
  if (apiKey && safeEqual(token, apiKey)) return { ok: true, mode: "api_key", scope: "arms.read arms.write" };

  try {
    const payload = verifyToken<BridgeAccessPayload>(token, "bridge_access");
    return { ok: true, mode: "oauth", scope: payload.scope ?? "arms.read" };
  } catch {
    return { ok: false };
  }
}

export function unauthorizedResponse(request: Request): Response {
  const base = bridgeBaseUrl(request.url);
  const metadataUrl = `${base}/.well-known/oauth-protected-resource/mcp`;
  return Response.json(
    { error: "unauthorized", message: "ARMS Client Bridge authentication is required." },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl}"`,
        "Cache-Control": "no-store",
      },
    },
  );
}
