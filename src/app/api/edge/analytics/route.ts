import { createHash } from "node:crypto";
import { z } from "zod";
import { isTrustedEdgeRequest } from "@/lib/domains";
import { recordProjectAnalyticsEvents } from "@/lib/store";
import type { AnalyticsDevice } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOT_UA_RE = /\b(?:bot|crawler|spider|headless|lighthouse|pingdom|uptimerobot|curl|wget|python-requests)\b/i;
const STATIC_ASSET_RE =
  /^(?:\/_next\/|\/__cognix|\/\.well-known\/|\/favicon|\/robots\.txt$|\/sitemap\.xml$)|(?:\.(?:js|mjs|css|map|png|jpg|jpeg|gif|webp|avif|svg|ico|woff2?|ttf|eot|json|xml|txt))$/i;

const eventInputSchema = z.object({
  projectId: z.string().uuid(),
  hostname: z.string().min(1).max(255),
  path: z.string().min(1).max(400),
  referrer: z.string().max(1_000).nullish(),
  userAgent: z.string().max(500).nullish(),
  clientIp: z.string().max(120).nullish(),
  statusCode: z.number().int().min(100).max(599).optional().default(200),
  timestamp: z.string().datetime().optional(),
});

function classifyDevice(ua: string): AnalyticsDevice {
  if (/\b(?:ipad|tablet|playbook|silk)\b|(?:android(?!.*mobile))/i.test(ua)) return "tablet";
  if (/\b(?:mobi|iphone|ipod|android.*mobile|windows phone)\b/i.test(ua)) return "mobile";
  return "desktop";
}

function extractReferrerHost(referrer: string | null | undefined, ownHost: string): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
    const normalizedOwn = ownHost.toLowerCase().replace(/^www\./, "");
    if (!host || host === normalizedOwn) return null;
    return host;
  } catch {
    return null;
  }
}

/**
 * Privacy-preserving cookieless daily visitor identifier:
 * SHA-256(UTC_YYYY_MM_DD + projectId + clientIp + userAgent + serverSalt).
 * Raw client IP and user-agent strings are discarded immediately and never persisted.
 */
function computeDailyVisitorHash(projectId: string, clientIp: string, userAgent: string, dateIso: string): string {
  const day = dateIso.slice(0, 10);
  const salt = process.env.COGNIX_EDGE_SECRET || process.env.COGNIX_SECRETS_KEY || "cognix-analytics";
  return createHash("sha256")
    .update(`${day}:${projectId}:${clientIp}:${userAgent}:${salt}`)
    .digest("hex")
    .slice(0, 32);
}

export async function POST(request: Request) {
  if (!isTrustedEdgeRequest(request.headers)) {
    return Response.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const body = z.object({ events: z.array(eventInputSchema).min(1).max(100) }).parse(await request.json());
    const nowIso = new Date().toISOString();

    const accepted = body.events.flatMap((item) => {
      const ua = item.userAgent?.trim() ?? "";
      if (ua && BOT_UA_RE.test(ua)) return [];
      const cleanPath = (item.path.split("?")[0] || "/").slice(0, 400);
      if (STATIC_ASSET_RE.test(cleanPath)) return [];
      const createdAt = item.timestamp ?? nowIso;
      return [
        {
          projectId: item.projectId,
          hostname: item.hostname.toLowerCase(),
          path: cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`,
          referrerHost: extractReferrerHost(item.referrer, item.hostname),
          device: classifyDevice(ua),
          visitorHash: computeDailyVisitorHash(item.projectId, item.clientIp?.trim() || "0.0.0.0", ua, createdAt),
          statusCode: item.statusCode,
          createdAt,
        },
      ];
    });

    const recorded = await recordProjectAnalyticsEvents(accepted);
    return Response.json({ ok: true, recorded }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Invalid analytics payload." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
