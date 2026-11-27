import { requireViewer } from "@/lib/auth0";
import { githubErrorResponse } from "@/lib/github/http";
import { listSecurityChanges } from "@/lib/github/security-source";
import { notFound } from "@/lib/http";
import { getProject } from "@/lib/store";

type Context = { params: Promise<{ projectId: string }> };

export const runtime = "nodejs";

/** Security mode: files changed in the sandbox since the last import or push. Reads only. */
export async function GET(_request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();
    return Response.json(await listSecurityChanges(project));
  } catch (error) {
    return githubErrorResponse(error);
  }
}
