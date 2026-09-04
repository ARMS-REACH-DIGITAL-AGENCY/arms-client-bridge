import { highLevelRequest } from "../../../lib/highlevel";

export const dynamic = "force-dynamic";

const SUSIE_LOCATION_ID = "QLS1wvtsvzL1YsLFxYcM";
const SUSIE_BLOG_ID = "LMd8jdhNZD3TYrhuhqia";
const CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=600";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function categoryLabels(value: unknown): string[] {
  return arrayValue(value)
    .map((category) => stringValue(asObject(category).label))
    .filter(Boolean);
}

function isPublished(post: JsonObject): boolean {
  return (
    stringValue(post.status).toUpperCase() === "PUBLISHED" &&
    post.archived !== true &&
    post.deleted !== true
  );
}

function publicSummary(post: JsonObject): JsonObject {
  return {
    id: stringValue(post._id),
    title: stringValue(post.title),
    description: stringValue(post.description),
    slug: stringValue(post.urlSlug),
    imageUrl: stringValue(post.imageUrl),
    imageAltText: stringValue(post.imageAltText),
    categories: categoryLabels(post.categories),
    tags: arrayValue(post.tags).map(stringValue).filter(Boolean),
    publishedAt: stringValue(post.publishedAt),
    updatedAt: stringValue(post.updatedAt),
    readTimeInMinutes: Number(post.readTimeInMinutes) || 0,
  };
}

async function publishedPosts(): Promise<JsonObject[]> {
  const result = await highLevelRequest({
    method: "GET",
    path: "/blogs/posts/all",
    locationId: SUSIE_LOCATION_ID,
    authMode: "location",
    query: {
      locationId: SUSIE_LOCATION_ID,
      blogId: SUSIE_BLOG_ID,
      limit: 50,
      offset: 0,
      status: "PUBLISHED",
    },
    version: "2023-02-21",
    maxChars: 100_000,
  });

  if (!result.ok) {
    throw new Error(`HighLevel published-post listing failed (${result.status})`);
  }

  return arrayValue(asObject(result.data).blogs)
    .map(asObject)
    .filter(isPublished);
}

async function authorName(authorId: string): Promise<string> {
  if (!authorId) return "Susie Sculpts";

  const result = await highLevelRequest({
    method: "GET",
    path: "/blogs/authors",
    locationId: SUSIE_LOCATION_ID,
    authMode: "location",
    query: { locationId: SUSIE_LOCATION_ID, limit: 50, offset: 0 },
    version: "v3",
    maxChars: 40_000,
  });

  if (!result.ok) return "Susie Sculpts";

  const author = arrayValue(asObject(result.data).authors)
    .map(asObject)
    .find((candidate) => stringValue(candidate._id) === authorId);
  if (!author) return "Susie Sculpts";

  return stringValue(author.name) || stringValue(author.fullName) || "Susie Sculpts";
}

export async function GET(request: Request): Promise<Response> {
  try {
    const slug = new URL(request.url).searchParams.get("slug")?.trim() ?? "";
    const posts = await publishedPosts();

    if (!slug) {
      return Response.json(
        { posts: posts.map(publicSummary) },
        { headers: { "Cache-Control": CACHE_CONTROL } },
      );
    }

    const summary = posts.find((post) => stringValue(post.urlSlug) === slug);
    if (!summary) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    const postId = stringValue(summary._id);
    const detailResult = await highLevelRequest({
      method: "GET",
      path: `/blogs/posts/${encodeURIComponent(postId)}`,
      locationId: SUSIE_LOCATION_ID,
      authMode: "location",
      query: { locationId: SUSIE_LOCATION_ID },
      version: "2023-02-21",
      maxChars: 100_000,
    });
    const detail = asObject(asObject(detailResult.data).blogPost);

    // The listing check above and this second check prevent a direct request
    // from ever turning a draft, archived, or another blog's post into public content.
    if (
      !detailResult.ok ||
      stringValue(detail._id) !== postId ||
      stringValue(detail.blogId) !== SUSIE_BLOG_ID ||
      !isPublished(detail)
    ) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    return Response.json(
      {
        post: {
          ...publicSummary(detail),
          rawHTML: stringValue(detail.rawHTML),
          authorName: await authorName(stringValue(detail.author)),
        },
      },
      { headers: { "Cache-Control": CACHE_CONTROL } },
    );
  } catch (error) {
    console.error("[ARMS] Susie public blog read failed", error);
    return Response.json({ error: "unavailable" }, { status: 502 });
  }
}
