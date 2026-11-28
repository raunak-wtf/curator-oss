import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { PreviewAccessMode } from "./types";

const scryptAsync = promisify(scryptCallback);

export const PREVIEW_GRANT_COOKIE = "__cognix_preview_grant";
export const PREVIEW_GRANT_QUERY_PARAM = "__cognix_preview_grant";
export const PREVIEW_OWNER_LEASE_MS = 2 * 60_000; // 2 minutes per heartbeat ping
export const PREVIEW_GUEST_LEASE_MS = 10 * 60_000; // 10 minutes after an authorized guest opens the link

export type PreviewGrantRole = "owner" | "invited" | "passcode";

export type PreviewGrantPayload = {
  /** Project UUID. */
  pid: string;
  /** Preview hostname (e.g. golden-delta-60b6e4dc.curatorsite.in). */
  host: string;
  /** Role granted by Curator auth verification. */
  role: PreviewGrantRole;
  /** Project previewAccessVersion at issuance; bumping version invalidates guest grants. */
  ver: number;
  /** Normalized email of the authenticated Curator viewer (for owner / invited roles). */
  email?: string;
  /** Share record ID for private email invites. */
  sid?: string;
  /** Expiration Unix timestamp in seconds. */
  exp: number;
};

function signingSecret(override?: string): string {
  const explicit = override?.trim() || process.env.COGNIX_EDGE_SECRET?.trim() || "";
  if (explicit) return explicit;

  // Local development fallback when COGNIX_EDGE_SECRET is unset: derive a domain-separated key
  // so the raw AUTH0_SECRET is never used directly as a preview grant HMAC key.
  const auth0Fallback = process.env.AUTH0_SECRET?.trim() || "";
  if (auth0Fallback) {
    return createHmac("sha256", "cognix-preview-grant-local-fallback-v1")
      .update(auth0Fallback, "utf8")
      .digest("hex");
  }

  throw new Error("COGNIX_EDGE_SECRET or AUTH0_SECRET must be set to sign preview access tokens.");
}

export function createPreviewShareKey(): string {
  return randomBytes(24).toString("base64url");
}

export async function hashPreviewPasscode(passcode: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(passcode, salt, 32)) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

export async function verifyPreviewPasscode(
  passcode: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  if (!storedHash || !storedHash.startsWith("scrypt:")) return false;
  const parts = storedHash.split(":");
  if (parts.length !== 3) return false;
  const [, salt, hex] = parts;
  if (!salt || !hex || hex.length % 2 !== 0) return false;
  const expected = Buffer.from(hex, "hex");
  if (expected.length !== 32) return false;
  const actual = (await scryptAsync(passcode, salt, 32)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Mints a compact HMAC-SHA256 signed token (`cg1.<base64url-json>.<base64url-hmac>`)
 * verifiable offline in Next.js, the Node edge proxy, and Cloudflare Workers.
 */
export function signPreviewGrant(
  payload: Omit<PreviewGrantPayload, "exp"> & { ttlSeconds?: number; exp?: number },
  secretOverride?: string,
): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const ttl = Math.max(60, Math.min(7 * 24 * 3600, Math.trunc(payload.ttlSeconds ?? 12 * 3600)));
  const full: PreviewGrantPayload = {
    pid: payload.pid,
    host: payload.host.toLowerCase(),
    role: payload.role,
    ver: payload.ver,
    ...(payload.email ? { email: payload.email.trim().toLowerCase() } : {}),
    ...(payload.sid ? { sid: payload.sid } : {}),
    exp: payload.exp ?? nowSec + ttl,
  };
  const body = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  const sig = createHmac("sha256", signingSecret(secretOverride))
    .update(`cg1.${body}`, "utf8")
    .digest("base64url");
  return `cg1.${body}.${sig}`;
}

export function verifyPreviewGrant(
  token: string | null | undefined,
  expectedHost?: string,
  secretOverride?: string,
): PreviewGrantPayload | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "cg1") return null;
  const [, body, sig] = parts;
  if (!body || !sig) return null;

  try {
    const expectedSig = createHmac("sha256", signingSecret(secretOverride))
      .update(`cg1.${body}`, "utf8")
      .digest();
    const actualSig = Buffer.from(sig, "base64url");
    if (expectedSig.length !== actualSig.length || !timingSafeEqual(expectedSig, actualSig)) {
      return null;
    }
    const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PreviewGrantPayload;
    if (!decoded || typeof decoded.pid !== "string" || typeof decoded.host !== "string") return null;
    if (typeof decoded.exp !== "number" || decoded.exp <= Math.floor(Date.now() / 1000)) return null;
    if (expectedHost && decoded.host.toLowerCase() !== expectedHost.trim().toLowerCase()) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function isPublicPreviewActive(
  mode: PreviewAccessMode,
  publicExpiresAt: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (mode !== "public") return false;
  if (!publicExpiresAt) return false;
  const expMs = Date.parse(publicExpiresAt);
  return Number.isFinite(expMs) && expMs > nowMs;
}

/**
 * Strictly normalizes a relative in-app path, blocking `//evil.com`, `/\evil.com` authority confusion,
 * control characters, and cross-origin resolution.
 */
export function sanitizeRelativePath(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "/";
  const trimmed = raw.trim().slice(0, 500);
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(trimmed)
  ) {
    return "/";
  }
  try {
    const parsed = new URL(trimmed, "https://cognix.invalid");
    if (parsed.origin !== "https://cognix.invalid") return "/";
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/";
  }
}

export function buildPrivateShareUrl(previewUrl: string, shareKey: string): string {
  const url = new URL(previewUrl);
  url.pathname = "/auth";
  url.search = `?key=${encodeURIComponent(shareKey)}`;
  url.hash = "";
  return url.toString();
}

export function buildOwnerPreviewFrameUrl(previewUrl: string, grantToken: string, nextPath = "/"): string {
  const baseOrigin = new URL(previewUrl).origin;
  const safeNext = sanitizeRelativePath(nextPath);
  const url = new URL(safeNext, baseOrigin);
  if (url.origin !== baseOrigin) {
    throw new Error("Cross-origin preview redirect blocked.");
  }
  url.searchParams.set(PREVIEW_GRANT_QUERY_PARAM, grantToken);
  url.hash = "";
  return url.toString();
}

export function normalizeInviteEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
