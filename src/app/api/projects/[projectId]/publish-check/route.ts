import { requireViewer } from "@/lib/auth0";
import { errorResponse, notFound } from "@/lib/http";
import { runPublishCheck } from "@/lib/publish-check";
import { getDecryptedSecrets, getProject, listProjectFiles } from "@/lib/store";

export const runtime = "nodejs";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();

    const [files, secrets] = await Promise.all([
      listProjectFiles(project.id),
      getDecryptedSecrets(project.id).catch(() => ({} as Record<string, string>)),
    ]);

    const report = runPublishCheck(files, { secretValues: Object.values(secrets) });
    return Response.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
