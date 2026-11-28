import { ensurePreviewUrl } from "@/lib/daytona";
import { requireViewer } from "@/lib/auth0";
import { parseAppsHostname } from "@/lib/domains";
import { errorResponse, notFound } from "@/lib/http";
import {
  buildOwnerPreviewFrameUrl,
  PREVIEW_OWNER_LEASE_MS,
  signPreviewGrant,
} from "@/lib/preview-access";
import { getProject, touchProjectPreviewSession, updateProject } from "@/lib/store";

type Context = { params: Promise<{ projectId: string }> };

export const maxDuration = 180;

export async function GET(_request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();
    // Refresh active editor lease whenever the owner connects or refreshes the preview.
    await touchProjectPreviewSession(project.id, PREVIEW_OWNER_LEASE_MS);
    const url = project.sandboxId ? await ensurePreviewUrl(project) : project.previewUrl;
    if (!url) {
      return Response.json(
        {
          error: project.sandboxId
            ? "The preview is still starting. Wait a moment, then refresh it."
            : "Start a build to create the live preview.",
        },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    const updated = await updateProject(project.id, viewer.id, {
      previewUrl: url,
      status: project.status === "published" || project.status === "publishing" ? project.status : "ready",
    });
    if (!updated) return notFound();

    let frameUrl = url;
    try {
      const host = new URL(url).hostname;
      if (parseAppsHostname(host)?.kind === "preview" && (process.env.COGNIX_EDGE_SECRET || process.env.AUTH0_SECRET)) {
        const grant = signPreviewGrant({
          pid: updated.id,
          host,
          role: "owner",
          ver: updated.previewAccessVersion ?? 1,
          email: viewer.email,
          ttlSeconds: 12 * 3600,
        });
        frameUrl = buildOwnerPreviewFrameUrl(url, grant, "/");
      }
    } catch {
      frameUrl = url;
    }

    return Response.json({ url, frameUrl, project: updated }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
