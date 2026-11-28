import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { PreviewAccessMode } from "./types";

export const PREVIEW_GRANT_COOKIE = "__cognix_preview_grant";
export const PREVIEW_GRANT_QUERY_PARAM = "__cognix_preview_grant";
export const PREVIEW_AUTH_CALLBACK_PATH = "/__cognix_preview_auth";
export const DEFAULT_PUBLIC_PREVIEW_HOURS = 24;
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
  const secret = (
    override ??
    process.env.COGNIX_EDGE_SECRET ??
    process.env.AUTH0_SECRET ??
    ""
  ).trim();
  if (!secret) {
    throw new Error("COGNIX_EDGE_SECRET or AUTH0_SECRET must be set to sign preview access tokens.");
  }
  return secret;
}

export function createPreviewShareKey(): string {
  return randomBytes(24).toString("base64url");
}

export function hashPreviewPasscode(passcode: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(passcode, salt, 32).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

export function verifyPreviewPasscode(passcode: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !storedHash.startsWith("scrypt:")) return false;
  const parts = storedHash.split(":");
  if (parts.length !== 3) return false;
  const [, salt, hex] = parts;
  if (!salt || !hex) return false;
  const expected = Buffer.from(hex, "hex");
  const actual = scryptSync(passcode, salt, 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Mints a compact HMAC-SHA256 signed token (`cg1.<base64url-json>.<base64url-hmac>`)
 * verifiable offline in both Next.js and the zero-dependency Node edge proxy.
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
      .digest("base64url");
    const expectedBuf = Buffer.from(expectedSig, "utf8");
    const actualBuf = Buffer.from(sig, "utf8");
    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
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

export function buildPrivateShareUrl(previewUrl: string, shareKey: string): string {
  const url = new URL(previewUrl);
  url.pathname = "/auth";
  url.search = `?key=${encodeURIComponent(shareKey)}`;
  url.hash = "";
  return url.toString();
}

export function buildOwnerPreviewFrameUrl(previewUrl: string, grantToken: string, nextPath = "/"): string {
  const safeNext = nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";
  const url = new URL(safeNext, new URL(previewUrl).origin);
  url.searchParams.set(PREVIEW_GRANT_QUERY_PARAM, grantToken);
  url.hash = "";
  return url.toString();
}

export function normalizeInviteEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
