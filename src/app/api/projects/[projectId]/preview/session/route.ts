import { z } from "zod";
import { requireViewer } from "@/lib/auth0";
import { shutdownDevelopmentPreview } from "@/lib/daytona";
import { errorResponse, notFound } from "@/lib/http";
import { PREVIEW_OWNER_LEASE_MS, isPublicPreviewActive } from "@/lib/preview-access";
import {
  clearProjectPreviewSession,
  getProject,
  getProjectPreviewLeaseStatus,
  touchProjectPreviewSession,
} from "@/lib/store";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };

/** Grace period after Curator tab close so a quick browser refresh (F5) does not stop the sandbox. */
const CLOSE_GRACE_MS = 15_000;

declare global {
  var __cognixPreviewCloseTimers: Map<string, ReturnType<typeof setTimeout>> | undefined;
}

const closeTimers =
  globalThis.__cognixPreviewCloseTimers ??
  (globalThis.__cognixPreviewCloseTimers = new Map<string, ReturnType<typeof setTimeout>>());

const bodySchema = z.object({
  action: z.enum(["ping", "close"]),
});

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();

    let rawJson: unknown = {};
    try {
      const text = await request.text();
      rawJson = text ? JSON.parse(text) : {};
    } catch {
      rawJson = {};
    }
    const { action } = bodySchema.parse(rawJson);

    const existingTimer = closeTimers.get(project.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      closeTimers.delete(project.id);
    }

    if (action === "ping") {
      const activeUntil = await touchProjectPreviewSession(project.id, PREVIEW_OWNER_LEASE_MS);
      return Response.json({ active: true, activeUntil }, { headers: noStore });
    }

    // Owner closed the Curator project tab: clear the editor lease (preserving any longer guest lease) and schedule preview shutdown.
    await clearProjectPreviewSession(project.id, viewer.id, PREVIEW_OWNER_LEASE_MS + 10_000);
    const timer = setTimeout(() => {
      closeTimers.delete(project.id);
      void (async () => {
        const latestLease = await getProjectPreviewLeaseStatus(project.id).catch(() => null);
        if (latestLease && Date.parse(latestLease) > Date.now()) {
          // User refreshed or reopened Curator (or an authorized guest is viewing).
          return;
        }
        const latestProject = await getProject(project.id, viewer.id).catch(() => null);
        if (!latestProject) return;
        // Keep preview running if a timed 24h Public Preview is explicitly active.
        if (isPublicPreviewActive(latestProject.previewAccessMode ?? "owner", latestProject.previewPublicExpiresAt)) {
          return;
        }
        await shutdownDevelopmentPreview(latestProject).catch(() => undefined);
      })();
    }, CLOSE_GRACE_MS);
    timer.unref?.();
    closeTimers.set(project.id, timer);

    return Response.json({ active: false, closingInMs: CLOSE_GRACE_MS }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
