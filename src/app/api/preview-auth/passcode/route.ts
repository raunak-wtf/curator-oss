import { z } from "zod";
import { parseAppsHostname } from "@/lib/domains";
import {
  buildOwnerPreviewFrameUrl,
  isPublicPreviewActive,
  PREVIEW_GUEST_LEASE_MS,
  sanitizeRelativePath,
  signPreviewGrant,
} from "@/lib/preview-access";
import { getProjectForEdgePreview, touchProjectPreviewSession, verifyProjectPreviewPasscode } from "@/lib/store";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };

const RATE_WINDOW_MS = 5 * 60_000;
const MAX_FAILED_ATTEMPTS = 8;
const MAX_TRACKED_KEYS = 2_000;

declare global {
  var __cognixPasscodeAttempts: Map<string, number[]> | undefined;
}

const failedAttempts =
  globalThis.__cognixPasscodeAttempts ?? (globalThis.__cognixPasscodeAttempts = new Map<string, number[]>());

function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first.slice(0, 80);
  }
  return request.headers.get("x-real-ip")?.trim().slice(0, 80) || "unknown";
}

function checkRateLimit(key: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const recent = (failedAttempts.get(key) ?? []).filter((ts) => now - ts < RATE_WINDOW_MS);
  if (recent.length === 0) {
    failedAttempts.delete(key);
    return { allowed: true, retryAfterSeconds: 0 };
  }
  failedAttempts.set(key, recent);
  if (recent.length >= MAX_FAILED_ATTEMPTS) {
    const oldest = recent[0] ?? now;
    const retryAfterSeconds = Math.max(5, Math.ceil((RATE_WINDOW_MS - (now - oldest)) / 1000));
    return { allowed: false, retryAfterSeconds };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

function recordFailedAttempt(key: string) {
  const now = Date.now();
  const recent = (failedAttempts.get(key) ?? []).filter((ts) => now - ts < RATE_WINDOW_MS);
  if (failedAttempts.size >= MAX_TRACKED_KEYS && !failedAttempts.has(key)) {
    const oldestKey = failedAttempts.keys().next().value;
    if (oldestKey) failedAttempts.delete(oldestKey);
  }
  recent.push(now);
  failedAttempts.set(key, recent);
}

const bodySchema = z.object({
  host: z.string().trim().min(3).max(255),
  passcode: z.string().trim().min(1).max(64),
  next: z.string().trim().max(500).optional(),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const normalizedHost = body.host.toLowerCase();
    const rateKey = `${clientIp(request)}:${normalizedHost}`;
    const rate = checkRateLimit(rateKey);
    if (!rate.allowed) {
      return Response.json(
        { error: `Too many incorrect passcode attempts. Wait ${rate.retryAfterSeconds} seconds and try again.` },
        {
          status: 429,
          headers: { ...noStore, "Retry-After": String(rate.retryAfterSeconds) },
        },
      );
    }

    const appsMatch = parseAppsHostname(normalizedHost);
    if (!appsMatch || appsMatch.kind !== "preview") {
      return Response.json({ error: "Preview not found." }, { status: 404, headers: noStore });
    }
    const project = await getProjectForEdgePreview({
      slug: appsMatch.slug,
      hex8: appsMatch.hex8,
      projectId: appsMatch.projectId,
    });
    if (!project) {
      return Response.json({ error: "Preview not found." }, { status: 404, headers: noStore });
    }

    const publicActive = isPublicPreviewActive(project.previewAccessMode ?? "owner", project.previewPublicExpiresAt);
    if (!publicActive) {
      return Response.json(
        { error: "Public preview access has expired or been disabled." },
        { status: 403, headers: noStore },
      );
    }

    const valid = await verifyProjectPreviewPasscode(project.id, body.passcode);
    if (!valid) {
      recordFailedAttempt(rateKey);
      return Response.json(
        { error: "Incorrect passcode. Check with the project owner and try again." },
        { status: 401, headers: noStore },
      );
    }

    failedAttempts.delete(rateKey);
    await touchProjectPreviewSession(project.id, PREVIEW_GUEST_LEASE_MS);
    const ttlSeconds = project.previewPublicExpiresAt
      ? Math.max(300, Math.floor((Date.parse(project.previewPublicExpiresAt) - Date.now()) / 1000))
      : 3600;
    const grant = signPreviewGrant({
      pid: project.id,
      host: normalizedHost,
      role: "passcode",
      ver: project.previewAccessVersion ?? 1,
      ttlSeconds,
    });
    const safeNext = sanitizeRelativePath(body.next);
    const redirectUrl = buildOwnerPreviewFrameUrl(`https://${normalizedHost}`, grant, safeNext);
    return Response.json({ redirectUrl }, { headers: noStore });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Could not verify passcode.";
    return Response.json({ error: msg }, { status: 400, headers: noStore });
  }
}
