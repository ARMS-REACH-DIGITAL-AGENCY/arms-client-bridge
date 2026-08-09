import { adminPasswordMatches, assertRedirectUri, createAuthorizationCode } from "../../../lib/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function errorResponse(message: string, status = 400): Response {
  return new Response(`<!doctype html><html><body style="font-family:system-ui;padding:40px"><h1>ARMS Client Bridge</h1><p>${esc(message)}</p></body></html>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("client_id") ?? "";
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const responseType = url.searchParams.get("response_type") ?? "";
  const codeChallenge = url.searchParams.get("code_challenge") ?? "";
  const codeChallengeMethod = url.searchParams.get("code_challenge_method") ?? "";
  const scope = url.searchParams.get("scope") ?? "arms.read arms.write offline_access";

  try {
    if (responseType !== "code") throw new Error("Only response_type=code is supported");
    if (!clientId || !redirectUri) throw new Error("client_id and redirect_uri are required");
    if (!codeChallenge || codeChallengeMethod.toUpperCase() !== "S256") {
      throw new Error("PKCE with code_challenge_method=S256 is required");
    }
    assertRedirectUri(clientId, redirectUri);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Invalid authorization request");
  }

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Authorize ARMS Client Bridge</title>
</head>
<body style="margin:0;background:#f7f7f7;color:#202124;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <main style="max-width:560px;margin:9vh auto;padding:32px;background:white;border:1px solid #e5e5e5;border-radius:16px;box-shadow:0 10px 35px rgba(0,0,0,.07)">
    <h1 style="margin:0 0 12px;font-size:28px">Authorize ARMS Client Bridge</h1>
    <p style="line-height:1.55;color:#555">This grants the connected ChatGPT workspace access to the internal ARMS bridge. HighLevel credentials remain server-side in Vercel and are never sent to ChatGPT.</p>
    <form method="post" action="/oauth/authorize" style="margin-top:24px">
      <input type="hidden" name="client_id" value="${esc(clientId)}" />
      <input type="hidden" name="redirect_uri" value="${esc(redirectUri)}" />
      <input type="hidden" name="state" value="${esc(state)}" />
      <input type="hidden" name="code_challenge" value="${esc(codeChallenge)}" />
      <input type="hidden" name="scope" value="${esc(scope)}" />
      <label style="display:block;font-weight:600;margin-bottom:8px" for="password">Bridge admin password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required style="box-sizing:border-box;width:100%;padding:12px 14px;border:1px solid #bbb;border-radius:10px;font-size:16px" />
      <button type="submit" style="margin-top:18px;width:100%;padding:12px 14px;border:0;border-radius:10px;background:#202124;color:#fff;font-size:16px;font-weight:600;cursor:pointer">Authorize</button>
    </form>
  </main>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const clientId = String(form.get("client_id") ?? "");
  const redirectUri = String(form.get("redirect_uri") ?? "");
  const state = String(form.get("state") ?? "");
  const codeChallenge = String(form.get("code_challenge") ?? "");
  const scope = String(form.get("scope") ?? "arms.read arms.write offline_access");
  const password = String(form.get("password") ?? "");

  try {
    if (!adminPasswordMatches(password)) return errorResponse("Invalid bridge admin password.", 401);
    assertRedirectUri(clientId, redirectUri);
    const code = createAuthorizationCode({ clientId, redirectUri, codeChallenge, scope });
    const redirect = new URL(redirectUri);
    redirect.searchParams.set("code", code);
    if (state) redirect.searchParams.set("state", state);
    return Response.redirect(redirect.toString(), 302);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Authorization failed");
  }
}
