import { createHash, createHmac, randomUUID, timingSafeEqual } from "crypto";

export type SignedPayload = {
  typ: string;
  iat: number;
  exp: number;
  jti: string;
  [key: string]: unknown;
};

function signingSecret(): string {
  const value = process.env.BRIDGE_SIGNING_SECRET?.trim();
  if (!value || value.length < 32) {
    throw new Error("BRIDGE_SIGNING_SECRET must be configured with at least 32 characters");
  }
  return value;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signPart(value: string): string {
  return createHmac("sha256", signingSecret()).update(value).digest("base64url");
}

export function signToken(
  typ: string,
  data: Record<string, unknown>,
  ttlSeconds: number,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SignedPayload = {
    ...data,
    typ,
    iat: now,
    exp: now + ttlSeconds,
    jti: randomUUID(),
  };
  const body = encode(payload);
  return `${body}.${signPart(body)}`;
}

export function verifyToken<T = SignedPayload>(token: string, expectedType?: string): T {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) throw new Error("invalid_token");

  const expected = signPart(body);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new Error("invalid_token_signature");
  }

  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SignedPayload;
  if (expectedType && payload.typ !== expectedType) throw new Error("invalid_token_type");
  if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) throw new Error("token_expired");
  return payload as T;
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function bridgeBaseUrl(requestUrl?: string): string {
  const configured = process.env.BRIDGE_BASE_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  if (requestUrl) return new URL(requestUrl).origin;
  return "https://client-bridge.armsreachdigital.agency";
}
