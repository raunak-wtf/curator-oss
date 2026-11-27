import { z } from "zod";
import { requireViewer } from "@/lib/auth0";
import { getProjectFsRoot, getSandbox, rebuildAndRestartPreview } from "@/lib/daytona";
import { applyDirectElementPatch } from "@/lib/direct-visual-edit";
import { errorResponse, notFound } from "@/lib/http";
import { getProject, listProjectFiles, upsertProjectFile } from "@/lib/store";
import { visualElementSelectionSchema } from "@/lib/visual-edit";

export const runtime = "nodejs";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();

    const body = z
      .object({
        selection: visualElementSelectionSchema,
        nextText: z.string().max(500).optional(),
        nextClassName: z.string().max(2_000).optional(),
      })
      .parse(await request.json());

    const files = await listProjectFiles(project.id);
    const result = applyDirectElementPatch({
      selection: body.selection,
      files,
      nextText: body.nextText,
      nextClassName: body.nextClassName,
    });

    if (!result.updated) {
      return Response.json({ updated: false, reason: result.reason }, { status: 422 });
    }

    if (project.sandboxId) {
      const sandbox = await getSandbox(project);
      if (sandbox) {
        const fsRoot = getProjectFsRoot();
        await sandbox.fs.uploadFile(Buffer.from(result.after, "utf8"), `${fsRoot}/${result.path}`);
        void rebuildAndRestartPreview(project).catch(() => undefined);
      }
    }
    const saved = await upsertProjectFile(project.id, result.path, result.after);

    return Response.json({
      updated: true,
      path: result.path,
      file: saved,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
