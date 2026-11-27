import { z } from "zod";
import { requireViewer } from "@/lib/auth0";
import { GitHubError } from "@/lib/github/client";
import { githubErrorResponse } from "@/lib/github/http";
import { pushSecurityChanges } from "@/lib/github/security-source";
import { notFound } from "@/lib/http";
import { getProject } from "@/lib/store";

type Context = { params: Promise<{ projectId: string }> };

export const runtime = "nodejs";
export const maxDuration = 300;

const pushSchema = z.object({
  message: z.string().trim().min(3).max(5_000),
  branch: z.string().trim().min(1).max(200),
  createBranch: z.boolean(),
  pullRequest: z.object({ title: z.string().trim().min(1).max(200), body: z.string().max(20_000) }).optional(),
});

/** Security mode: the user commits the sandbox's changes and pushes them to GitHub with their own account. */
export async function POST(request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();
    if (project.status === "building") throw new GitHubError("Wait for the agent to finish, then commit.", "conflict", 409);
    const body = pushSchema.parse(await request.json());
    return Response.json(await pushSecurityChanges(project, body));
  } catch (error) {
    return githubErrorResponse(error);
  }
}
