import { requireViewer } from "@/lib/auth0";
import { exportProjectArchive } from "@/lib/daytona";
import { errorResponse, notFound } from "@/lib/http";
import { getProject } from "@/lib/store";
import { safeFileName } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 180;

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();

    const archive = await exportProjectArchive(project);
    if (!archive) {
      return Response.json({ error: "Build the project before downloading its workspace." }, { status: 409 });
    }

    const downloadName = `${safeFileName(project.title || "cognix-project")}.tar.gz`;
    return new Response(new Uint8Array(archive), {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${downloadName}"`,
        "Content-Length": String(archive.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
