import { bridgeAuthConfigured } from "../../lib/bridge-auth";
import { bridgeHighLevelStatus } from "../../lib/highlevel";

export const dynamic = "force-dynamic";

function Status({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span style={{ color: ok ? "#0a7a32" : "#9a5b00", fontWeight: 600 }}>
      {ok ? "Configured" : "Needs setup"}: {children}
    </span>
  );
}

export default function StatusPage() {
  const highLevel = bridgeHighLevelStatus();
  const bridgeAuth = bridgeAuthConfigured();
  const defaultLocation = String(highLevel.highlevel_default_location_id ?? "");

  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "64px 24px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 38, marginBottom: 10 }}>ARMS Client Bridge</h1>
      <section style={{ marginTop: 32, padding: 24, border: "1px solid #e4e4e4", borderRadius: 14 }}>
        <p><Status ok={bridgeAuth}>ChatGPT bridge authentication</Status></p>
        <p><Status ok={Boolean(highLevel.highlevel_agency_pit_configured)}>HighLevel agency credential</Status></p>
        <p><Status ok={Boolean(defaultLocation)}>Default HighLevel location</Status></p>
        <p>Location PITs configured: <strong>{String(highLevel.highlevel_location_pit_count ?? 0)}</strong></p>
      </section>
    </main>
  );
}
