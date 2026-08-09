import { bridgeAuthConfigured } from "../../../lib/bridge-auth";
import { bridgeHighLevelStatus } from "../../../lib/highlevel";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    {
      ok: true,
      service: "arms-client-bridge",
      version: "0.2.0",
      mcp_endpoint: "/mcp",
      oauth_discovery: "/.well-known/oauth-authorization-server",
      bridge_auth_configured: bridgeAuthConfigured(),
      ...bridgeHighLevelStatus(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
