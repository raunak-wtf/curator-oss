import { z } from "zod";
import { executeAgentTool, projectRelativePath } from "@/lib/ai/tools";
import { requireViewer } from "@/lib/auth0";
import { getProjectRoot, getSandbox } from "@/lib/daytona";
import { isEnvFilePath } from "@/lib/env-files";
import { errorResponse, notFound } from "@/lib/http";
import { getProject, getProjectCloud, listProjectFiles, upsertProjectFile } from "@/lib/store";

export const runtime = "nodejs";
type Context = { params: Promise<{ projectId: string }> };

function validateSafeEditorPath(rawPath: string): string | null {
  try {
    const normalized = projectRelativePath(rawPath);
    if (!normalized || normalized === "." || isEnvFilePath(normalized)) {
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

export async function GET(request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();
    const requestedPath = new URL(request.url).searchParams.get("path");
    const storedFiles = await listProjectFiles(project.id);

    if (requestedPath && project.sandboxId) {
      const normalized = validateSafeEditorPath(requestedPath);
      if (!normalized) {
        return Response.json({ error: "Invalid file path." }, { status: 400 });
      }
      const sandbox = await getSandbox(project);
      if (sandbox) {
        const root = await getProjectRoot(sandbox);
        const content = (await sandbox.fs.downloadFile(`${root}/${normalized}`)).toString("utf8");
        const file = await upsertProjectFile(project.id, normalized, content);
        return Response.json({ file });
      }
    }

    return Response.json({ files: storedFiles });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();
    const body = z
      .object({ path: z.string().min(1).max(500), content: z.string().max(1_000_000) })
      .parse(await request.json());

    const normalizedPath = validateSafeEditorPath(body.path);
    if (!normalizedPath) {
      return Response.json({ error: "Invalid or protected file path." }, { status: 400 });
    }

    if (project.sandboxId) {
      const [sandbox, cloud] = await Promise.all([
        getSandbox(project),
        getProjectCloud(project.id).catch(() => null),
      ]);
      if (sandbox) {
        await executeAgentTool(
          project,
          sandbox,
          "write_file",
          { path: normalizedPath, content: body.content },
          { cloudEnabled: cloud?.status === "ready" },
        );
      }
    }
    const file = await upsertProjectFile(project.id, normalizedPath, body.content);
    return Response.json({ file });
  } catch (error) {
    return errorResponse(error);
  }
}
