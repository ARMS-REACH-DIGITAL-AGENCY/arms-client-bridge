import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.json({ ok: false, error }, { status: 400 });
  }

  if (!code) {
    return NextResponse.json(
      { ok: false, error: "missing_authorization_code" },
      { status: 400 },
    );
  }

  // Token exchange and secure persistence will be enabled after the
  // HighLevel app Client ID/Secret and final redirect URL are configured.
  return NextResponse.json({
    ok: true,
    status: "authorization_code_received",
    next: "configure_token_exchange",
  });
}
