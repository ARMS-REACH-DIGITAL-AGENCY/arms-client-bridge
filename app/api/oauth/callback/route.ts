import { NextRequest, NextResponse } from "next/server";
import { completeAgencyOAuthAuthorization } from "../../../../lib/highlevel-oauth";

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

  try {
    await completeAgencyOAuthAuthorization(code);
    return NextResponse.json({
      ok: true,
      status: "agency_oauth_connected",
      message: "ARMS Client Bridge can now obtain sub-account access tokens on demand.",
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Unable to complete HighLevel OAuth authorization";
    return NextResponse.json({ ok: false, error: "oauth_connection_failed", message }, { status: 500 });
  }
}
