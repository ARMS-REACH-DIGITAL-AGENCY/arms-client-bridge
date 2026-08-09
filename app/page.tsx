import { bridgeAuthConfigured } from "../lib/bridge-auth";
import { bridgeHighLevelStatus } from "../lib/highlevel";

export const dynamic = "force-dynamic";

function Status({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span style={{ color: ok ? "#0a7a32" : "#9a5b00", fontWeight: 600 }}>
      {ok ? "Configured" : "Needs setup"}: {children}
    </span>
  );
}

export default function HomePage() {
  const highLevel = bridgeHighLevelStatus();
  const bridgeAuth = bridgeAuthConfigured();
  const defaultLocation = String(highLevel.highlevel_default_location_id ?? "");

  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "64px 24px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 38, marginBottom: 10 }}>ARMS Client Bridge</h1>
      <p style={{ lineHeight: 1.65, color: "#555", fontSize: 17 }}>
        Internal MCP gateway for securely connecting ChatGPT to ARMS HighLevel agency and client sub-accounts.
      </p>

      <section style={{ marginTop: 32, padding: 24, border: "1px solid #e4e4e4", borderRadius: 14 }}>
        <h2 style={{ marginTop: 0 }}>Bridge status</h2>
        <p><Status ok={bridgeAuth}>ChatGPT bridge authentication</Status></p>
        <p>
          <Status ok={Boolean(highLevel.highlevel_agency_pit_configured)}>
            HighLevel agency credential
          </Status>
        </p>
        <p>
          <Status ok={Boolean(defaultLocation)}>
            Default HighLevel location{defaultLocation ? ` (${defaultLocation})` : ""}
          </Status>
        </p>
        <p>
          Location PITs configured: <strong>{String(highLevel.highlevel_location_pit_count ?? 0)}</strong>
        </p>
      </section>

      <section style={{ marginTop: 24, padding: 24, border: "1px solid #e4e4e4", borderRadius: 14 }}>
        <h2 style={{ marginTop: 0 }}>Endpoints</h2>
        <p>MCP: <code>/mcp</code></p>
        <p>Health: <code>/api/health</code></p>
        <p>OAuth discovery: <code>/.well-known/oauth-authorization-server</code></p>
        <p>OAuth resource metadata: <code>/.well-known/oauth-protected-resource/mcp</code></p>
      </section>

      <section style={{ marginTop: 24, padding: 24, border: "1px solid #e4e4e4", borderRadius: 14 }}>
        <h2 style={{ marginTop: 0 }}>Security model</h2>
        <p style={{ lineHeight: 1.6, color: "#555" }}>
          HighLevel Private Integration Tokens stay server-side in Vercel environment variables. ChatGPT authenticates to this bridge separately using OAuth (recommended) or a dedicated bridge API key. HighLevel credentials are never returned by MCP tools.
        </p>
      </section>
    </main>
  );
}
