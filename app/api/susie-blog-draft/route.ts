import { createHash, timingSafeEqual } from "crypto";
import { highLevelRequest } from "../../../lib/highlevel";

const SUSIE_LOCATION_ID = "QLS1wvtsvzL1YsLFxYcM";
const ACCESS_KEY_SHA256 = "f0886bee642d9fc4eb35d7cd108bca4cd3b79a4325dab886654cd913b81442da";
const DEFAULT_IMAGE_URL = "https://www.susiesculpts.com/images/logo.png";

type JsonObject = Record<string, unknown>;

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function validAccessKey(value: string): boolean {
  if (!value) return false;
  const digest = createHash("sha256").update(value).digest("hex");
  const expected = Buffer.from(ACCESS_KEY_SHA256, "hex");
  const actual = Buffer.from(digest, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || `article-${Date.now()}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function contentToHtml(value: string): string {
  // Treat partner submissions as text by default. This prevents scripts or
  // unsafe HTML from being injected into a draft while preserving paragraphs.
  return value
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}

function arrayFromResponse(result: JsonObject, key: string): JsonObject[] {
  const data = result.data;
  if (!data || typeof data !== "object") return [];
  const object = data as JsonObject;
  const direct = object[key];
  if (Array.isArray(direct)) return direct.filter((item): item is JsonObject => Boolean(item) && typeof item === "object");
  if (key === "data" && Array.isArray(object.data)) {
    return object.data.filter((item): item is JsonObject => Boolean(item) && typeof item === "object");
  }
  return [];
}

function objectId(value: JsonObject): string {
  return stringValue(value._id) || stringValue(value.id);
}

function wordCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

export async function POST(request: Request): Promise<Response> {
  const token = bearerToken(request);
  if (!validAccessKey(token)) {
    return Response.json({ success: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as JsonObject;
    const title = stringValue(body.title);
    const content = stringValue(body.content);

    if (!title || !content) {
      return Response.json(
        { success: false, error: "title_and_content_required" },
        { status: 400 },
      );
    }

    const [sitesResult, authorsResult, categoriesResult] = await Promise.all([
      highLevelRequest({
        method: "GET",
        path: "/blogs/site/all",
        locationId: SUSIE_LOCATION_ID,
        authMode: "location",
        version: "v3",
        maxChars: 40_000,
      }),
      highLevelRequest({
        method: "GET",
        path: "/blogs/authors",
        locationId: SUSIE_LOCATION_ID,
        authMode: "location",
        query: { locationId: SUSIE_LOCATION_ID, limit: 50, offset: 0 },
        version: "v3",
        maxChars: 40_000,
      }),
      highLevelRequest({
        method: "GET",
        path: "/blogs/categories",
        locationId: SUSIE_LOCATION_ID,
        authMode: "location",
        query: { locationId: SUSIE_LOCATION_ID, limit: 50, offset: 0 },
        version: "v3",
        maxChars: 40_000,
      }),
    ]);

    const sites = arrayFromResponse(sitesResult, "data");
    const authors = arrayFromResponse(authorsResult, "authors");
    const categories = arrayFromResponse(categoriesResult, "categories");
    const blogId = sites[0] ? objectId(sites[0]) : "";
    const authorId = authors[0] ? objectId(authors[0]) : "";

    if (!blogId || !authorId) {
      return Response.json(
        {
          success: false,
          error: "blog_not_initialized",
          message: "Create the Susie Sculpts blog container and at least one blog author in HighLevel before accepting partner drafts.",
          missing: {
            blog: !blogId,
            author: !authorId,
          },
        },
        { status: 409 },
      );
    }

    const requestedCategory = stringValue(body.category).toLowerCase();
    const categoryIds = requestedCategory
      ? categories
          .filter((category) => stringValue(category.name).toLowerCase() === requestedCategory)
          .map(objectId)
          .filter(Boolean)
      : [];

    const tags = stringValue(body.tags)
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 12);
    const source = stringValue(body.source);
    const notes = stringValue(body.notes);
    const metaDescription = stringValue(body.metaDescription).slice(0, 320);
    const imageUrl = stringValue(body.featuredImageUrl) || DEFAULT_IMAGE_URL;
    const editorialMetadata = [
      source ? `Source/manufacturer: ${source}` : "",
      notes ? `Partner notes: ${notes}` : "",
    ].filter(Boolean).join(" | ");
    const rawHTML = `${contentToHtml(content)}${editorialMetadata ? `\n<!-- ${escapeHtml(editorialMetadata)} -->` : ""}`;

    const createResult = await highLevelRequest({
      method: "POST",
      path: "/blogs/posts",
      locationId: SUSIE_LOCATION_ID,
      authMode: "location",
      version: "v3",
      maxChars: 60_000,
      body: {
        title,
        locationId: SUSIE_LOCATION_ID,
        blogId,
        imageUrl,
        description: metaDescription || content.slice(0, 220),
        rawHTML,
        status: "DRAFT",
        imageAltText: title,
        categories: categoryIds,
        tags,
        author: authorId,
        urlSlug: slugify(title),
        publishedAt: new Date().toISOString(),
        wordCount: wordCount(content),
      },
    });

    if (!createResult.ok) {
      console.error("[ARMS] Susie blog draft creation failed", createResult);
      return Response.json(
        {
          success: false,
          error: "highlevel_draft_create_failed",
          message: "HighLevel rejected the draft submission.",
          highLevelStatus: createResult.status,
        },
        { status: 502 },
      );
    }

    return Response.json({
      success: true,
      status: "DRAFT",
      title,
      blogId,
      submittedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[ARMS] Susie blog draft endpoint error", error);
    return Response.json(
      { success: false, error: "server_error" },
      { status: 500 },
    );
  }
}
