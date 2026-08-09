export default function HomePage() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "64px 24px" }}>
      <h1 style={{ fontSize: 36, marginBottom: 12 }}>ARMS Client Bridge</h1>
      <p style={{ lineHeight: 1.6 }}>
        Internal ARMS integration service for securely connecting agency systems to client CRM sub-accounts.
      </p>
      <p style={{ lineHeight: 1.6 }}>
        Status: bootstrap deployed. OAuth callback endpoint: <code>/api/oauth/callback</code>
      </p>
    </main>
  );
}
