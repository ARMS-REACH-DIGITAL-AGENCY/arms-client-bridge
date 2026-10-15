import { timingSafeEqual } from "node:crypto";
import { highLevelRequest } from "../../../../lib/highlevel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const YATSTATS_LOCATION_ID = "8eYj1Uj7Ugt0PDUGHblx";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Contact = { id?: string; email?: string };
type ApiResult = { ok?: boolean; status?: number; data?: unknown };
type ObjectValue = Record<string, unknown>;

function object(value: unknown): ObjectValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
}

function authorized(request: Request): boolean {
  const secret = process.env.YATSTATS_CONTACT_SYNC_SECRET?.trim() ?? "";
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !header.startsWith("Bearer ")) return false;
  const received = header.slice(7).trim();
  const a = Buffer.from(secret);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

function tagsFor(homeHsid: string): string[] {
  return [
    "source:yatstats",
    `hsid:${homeHsid}`,
    ...(homeHsid === "5004" ? ["hamilton", "hamilton-pilot:registered"] : []),
  ];
}

async function findByEmail(email: string): Promise<string | null> {
  // HighLevel's GET /contacts/search?email=... returns 400. The supported
  // location contacts list accepts query=email; use an exact match to prevent
  // accidentally linking a similarly named contact.
  const result = await highLevelRequest({
    method: "GET",
    path: "/contacts/",
    locationId: YATSTATS_LOCATION_ID,
    query: { locationId: YATSTATS_LOCATION_ID, query: email, limit: 20 },
    version: "2023-02-21",
    maxChars: 30_000,
  }) as ApiResult;
  if (!result.ok) throw new Error(`Contact lookup failed (${result.status})`);
  const data = object(result.data);
  const contacts = Array.isArray(data.contacts) ? data.contacts : [];
  const matched = contacts
    .map((entry) => object(entry) as Contact)
    .find((entry) => String(entry.email ?? "").toLowerCase() === email.toLowerCase());
  return matched?.id ?? null;
}

async function createContact(email: string, firstName: string, lastName: string, tags: string[]): Promise<string> {
  const result = await highLevelRequest({
    method: "POST",
    path: "/contacts/",
    locationId: YATSTATS_LOCATION_ID,
    version: "2021-07-28",
    body: {
      locationId: YATSTATS_LOCATION_ID,
      email,
      firstName: firstName || "Fan",
      lastName,
      source: "YAT?STATS Website",
      tags,
    },
    maxChars: 12_000,
  }) as ApiResult;
  if (result.ok) {
    const createdId = String(object(object(result.data).contact).id ?? "");
    if (createdId) return createdId;
  }
  // Concurrent registration or an existing social contact can produce a
  // duplicate response. Recover its ID without creating a duplicate.
  if (result.status === 409 || result.status === 422) {
    const existing = await findByEmail(email);
    if (existing) return existing;
  }
  throw new Error(`Contact create failed (${result.status})`);
}

async function ensureTags(contactId: string, tags: string[]): Promise<void> {
  const result = await highLevelRequest({
    method: "POST",
    path: `/contacts/${encodeURIComponent(contactId)}/tags`,
    locationId: YATSTATS_LOCATION_ID,
    version: "2021-07-28",
    body: { tags },
    maxChars: 8_000,
  }) as ApiResult;
  if (!result.ok) throw new Error(`Contact tag update failed (${result.status})`);
}

export async function POST(request: Request): Promise<Response> {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (Number(request.headers.get("content-length") || 0) > 16_384) {
    return Response.json({ error: "Request too large" }, { status: 413 });
  }

  try {
    const body = object(await request.json());
    const email = String(body.email ?? "").trim().toLowerCase();
    const firstName = String(body.firstName ?? "").trim().slice(0, 100);
    const lastName = String(body.lastName ?? "").trim().slice(0, 100);
    const homeHsid = String(body.homeHsid ?? "").trim();
    if (!EMAIL_PATTERN.test(email) || email.length > 254 || !/^\d{1,7}$/.test(homeHsid)) {
      return Response.json({ error: "Valid email and numeric homeHsid are required" }, { status: 400 });
    }

    const tags = tagsFor(homeHsid);
    let contactId = await findByEmail(email);
    if (!contactId) contactId = await createContact(email, firstName, lastName, tags);
    await ensureTags(contactId, tags);

    return Response.json(
      { ok: true, contactId, locationId: YATSTATS_LOCATION_ID },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[yatstats/contact-sync] sync failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "ARMS contact sync unavailable" }, { status: 502 });
  }
}
