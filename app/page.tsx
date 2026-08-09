export default function HomePage() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "64px 24px" }}>
      <h1 style={{ fontSize: 36, marginBottom: 12 }}>ARMS Client Bridge</h1>
      <p style={{ lineHeight: 1.6 }}>
        Internal ARMS integration service for securely connecting ChatGPT to ARMS / LeadConnector CRM data and actions.
      </p>
      <p style={{ lineHeight: 1.6 }}>
        Status: MCP bridge deployed. Endpoint: <code>/mcp</code>
      </p>
      <p style={{ lineHeight: 1.6 }}>
        Authentication is delegated to LeadConnector OAuth and forwarded end-to-end; the bridge does not store CRM access tokens.
      </p>
    </main>
  );
}
