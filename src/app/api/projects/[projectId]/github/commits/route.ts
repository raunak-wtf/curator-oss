import { requireViewer } from "@/lib/auth0";
import { githubErrorResponse } from "@/lib/github/http";
import { listRepositoryCommits } from "@/lib/github/sync";
import { notFound } from "@/lib/http";
import { getProject } from "@/lib/store";

type Context = { params: Promise<{ projectId: string }> };

export const runtime = "nodejs";

/** Recent commits on the synced branch, from Cognix and from GitHub. */
export async function GET(_request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();
    return Response.json(await listRepositoryCommits(project, viewer.id));
  } catch (error) {
    return githubErrorResponse(error);
  }
}
