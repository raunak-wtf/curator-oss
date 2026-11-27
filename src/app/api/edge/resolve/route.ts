import { getPreviewProxyTarget, getPublishedProxyTarget, publishedProxyHeaders } from "@/lib/daytona";
import { hostnameFromHeader, isTrustedEdgeRequest, parseAppsHostname } from "@/lib/domains";
import { badgeHrefFor } from "@/lib/remix";
import { getProjectForEdgePreview, getPublishedProject, getPublishedProjectByHostname } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** How long the edge proxy may reuse an answer before asking again. */
const EDGE_CACHE_SECONDS = 60;
const RESTARTING_RETRY_SECONDS = 5;
const PREVIEW_RETRY_SECONDS = 3;

const noStore = { "cache-control": "no-store" };

/**
 * Tells the Cognix edge proxy (`vm/edge-proxy.mjs` or `cloudflare/edge-worker.js`) where to forward:
 *   1. `preview-<projectId>.<COGNIX_APPS_DOMAIN>` -> live development preview on Daytona port 3000
 *   2. `<slug>.<COGNIX_APPS_DOMAIN>` -> published production release on Daytona port 3001
 *   3. Attached customer custom domains -> published production release on Daytona port 3001
 *
 * Only the edge proxy can call this, authenticated by COGNIX_EDGE_SECRET.
 */
export async function GET(request: Request) {
  if (!isTrustedEdgeRequest(request.headers)) {
    return Response.json({ error: "Not found." }, { status: 404, headers: noStore });
  }

  const url = new URL(request.url);
  const hostname = hostnameFromHeader(url.searchParams.get("host"));
  if (!hostname) {
    return Response.json({ error: "Add the host query parameter." }, { status: 400, headers: noStore });
  }

  const fresh = url.searchParams.get("fresh") === "1";
  const appsMatch = parseAppsHostname(hostname);

  if (appsMatch?.kind === "root" || appsMatch?.kind === "reserved") {
    return Response.json({ error: "No live publication on this domain.", cacheSeconds: 60 }, { status: 404, headers: noStore });
  }

  if (appsMatch?.kind === "preview") {
    const project = await getProjectForEdgePreview({
      slug: appsMatch.slug,
      hex8: appsMatch.hex8,
      projectId: appsMatch.projectId,
    });
    if (!project) {
      return Response.json({ error: "Preview unavailable.", cacheSeconds: 15 }, { status: 404, headers: noStore });
    }
    const target = await getPreviewProxyTarget(project, { fresh }).catch(() => null);
    if (!target) {
      return Response.json(
        { error: "This preview is starting.", retryAfter: PREVIEW_RETRY_SECONDS, kind: "preview" },
        { status: 503, headers: { ...noStore, "retry-after": String(PREVIEW_RETRY_SECONDS) } },
      );
    }
    return Response.json(
      {
        kind: "preview",
        upstream: target.upstream,
        headers: publishedProxyHeaders(target, hostname),
        title: project.title,
        badge: null,
        cacheSeconds: EDGE_CACHE_SECONDS,
      },
      { headers: noStore },
    );
  }

  if (appsMatch?.kind === "published") {
    const project = await getPublishedProject(appsMatch.slug);
    if (!project) {
      return Response.json({ error: "No live publication on this domain.", cacheSeconds: 15 }, { status: 404, headers: noStore });
    }
    const target = await getPublishedProxyTarget(project, { fresh }).catch(() => null);
    if (!target) {
      return Response.json(
        { error: "This app is restarting.", retryAfter: RESTARTING_RETRY_SECONDS },
        { status: 503, headers: { ...noStore, "retry-after": String(RESTARTING_RETRY_SECONDS) } },
      );
    }
    return Response.json(
      {
        projectId: project.id,
        upstream: target.upstream,
        headers: publishedProxyHeaders(target, hostname),
        title: project.title,
        badge: project.showBadge ? { href: badgeHrefFor(project) } : null,
        cacheSeconds: EDGE_CACHE_SECONDS,
      },
      { headers: noStore },
    );
  }

  const published = await getPublishedProjectByHostname(hostname);
  if (!published) {
    // Unknown, pending, or unpublished: the proxy falls back to Cognix, which renders the dark 404 page.
    return Response.json({ error: "No live publication on this domain.", cacheSeconds: 15 }, { status: 404, headers: noStore });
  }

  const target = await getPublishedProxyTarget(published.project, { fresh }).catch(() => null);
  if (!target) {
    return Response.json(
      { error: "This app is restarting.", retryAfter: RESTARTING_RETRY_SECONDS },
      { status: 503, headers: { ...noStore, "retry-after": String(RESTARTING_RETRY_SECONDS) } },
    );
  }

  return Response.json(
    {
      projectId: published.project.id,
      upstream: target.upstream,
      headers: publishedProxyHeaders(target, hostname),
      title: published.project.title,
      badge: published.project.showBadge ? { href: badgeHrefFor(published.project) } : null,
      cacheSeconds: EDGE_CACHE_SECONDS,
    },
    { headers: noStore },
  );
}
