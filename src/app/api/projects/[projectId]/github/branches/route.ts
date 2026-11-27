import { z } from "zod";
import { requireViewer } from "@/lib/auth0";
import { GitHubError } from "@/lib/github/client";
import { githubErrorResponse } from "@/lib/github/http";
import { isValidBranchName } from "@/lib/github/names";
import { createBranch, listRepositoryBranches, switchBranch } from "@/lib/github/sync";
import { notFound } from "@/lib/http";
import { getProject } from "@/lib/store";

type Context = { params: Promise<{ projectId: string }> };

export const runtime = "nodejs";
export const maxDuration = 300;

const branchSchema = z.object({
  name: z.string().trim().refine(isValidBranchName, "Use letters, numbers, and . _ - /, without spaces or '..'."),
});

async function load(context: Context) {
  const viewer = await requireViewer();
  const { projectId } = await context.params;
  return { viewer, project: await getProject(projectId, viewer.id) };
}

function assertIdle(status: string) {
  if (status === "building" || status === "publishing") {
    throw new GitHubError("Wait for the current build to finish, then change branches.", "conflict", 409);
  }
}

export async function GET(_request: Request, context: Context) {
  try {
    const { viewer, project } = await load(context);
    if (!project) return notFound();
    return Response.json(await listRepositoryBranches(project, viewer.id));
  } catch (error) {
    return githubErrorResponse(error);
  }
}

/** Creates a branch from the active branch and switches to it. */
export async function POST(request: Request, context: Context) {
  try {
    const { viewer, project } = await load(context);
    if (!project) return notFound();
    assertIdle(project.status);
    const { name } = branchSchema.parse(await request.json());
    return Response.json({ repository: await createBranch(project, viewer.id, name) }, { status: 201 });
  } catch (error) {
    return githubErrorResponse(error);
  }
}

/** Switches which branch Cognix edits and syncs, loading its files into the project. */
export async function PUT(request: Request, context: Context) {
  try {
    const { viewer, project } = await load(context);
    if (!project) return notFound();
    assertIdle(project.status);
    const { name } = branchSchema.parse(await request.json());
    return Response.json(await switchBranch(project, viewer.id, name));
  } catch (error) {
    return githubErrorResponse(error);
  }
}
