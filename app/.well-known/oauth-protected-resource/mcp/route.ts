import { resourceMetadata } from "../../../../lib/oauth";

export async function GET(request: Request) {
  return Response.json(resourceMetadata(request.url), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
