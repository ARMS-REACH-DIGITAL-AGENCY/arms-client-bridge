import { oauthMetadata } from "../../../lib/oauth";

export async function GET(request: Request) {
  return Response.json(oauthMetadata(request.url), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
