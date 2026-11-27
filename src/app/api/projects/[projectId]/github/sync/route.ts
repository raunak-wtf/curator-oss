import { z } from "zod";
import { requireViewer } from "@/lib/auth0";
import { GitHubError } from "@/lib/github/client";
import { githubErrorResponse } from "@/lib/github/http";
import { commitProjectToGitHub, getSyncStatus, pullFromGitHub } from "@/lib/github/sync";
import { writeCommitMessage } from "@/lib/ai/commit-message";
import { notFound } from "@/lib/http";
import { getProject } from "@/lib/store";

type Context = { params: Promise<{ projectId: string }> };

export const runtime = "nodejs";
export const maxDuration = 300;

async function load(context: Context) {
  const viewer = await requireViewer();
  const { projectId } = await context.params;
  return { viewer, project: await getProject(projectId, viewer.id) };
}

/** Compares Cognix's files with the linked branch. Changes nothing. */
export async function GET(_request: Request, context: Context) {
  try {
    const { viewer, project } = await load(context);
    if (!project) return notFound();
    return Response.json({ sync: await getSyncStatus(project, viewer.id) });
  } catch (error) {
    return githubErrorResponse(error);
  }
}

/** Pulls the linked branch into the project. `discardLocal` replaces Cognix's version with GitHub's. */
export async function POST(request: Request, context: Context) {
  try {
    const { viewer, project } = await load(context);
    if (!project) return notFound();
    if (project.status === "building" || project.status === "publishing") {
      throw new GitHubError("Wait for the current build to finish, then sync from GitHub.", "conflict", 409);
    }
    const input = z
      .object({ action: z.enum(["pull", "push"]).optional().default("pull"), discardLocal: z.boolean().optional().default(false) })
      .parse(await request.json());
    if (input.action === "push") {
      // Pushes agent changes still waiting from an earlier task (a push that failed, or a restore).
      // The user never writes code or commit messages; the message is written from the pending changes.
      return Response.json(await commitProjectToGitHub({ project, ownerId: viewer.id, describe: (changes) => writeCommitMessage({ changes }) }));
    }
    return Response.json(await pullFromGitHub(project, viewer.id, { discardLocal: input.discardLocal }));
  } catch (error) {
    return githubErrorResponse(error);
  }
}
