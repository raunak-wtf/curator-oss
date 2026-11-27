import { z } from "zod";
import { questionRequestFor } from "@/lib/agent-questions";
import { requireViewer } from "@/lib/auth0";
import { GitHubError } from "@/lib/github/client";
import { githubErrorResponse } from "@/lib/github/http";
import { pushSecurityChanges } from "@/lib/github/security-source";
import { notFound } from "@/lib/http";
import { getMessage, getProject, updateMessageMetadata } from "@/lib/store";

type Context = { params: Promise<{ projectId: string }> };

export const runtime = "nodejs";
export const maxDuration = 300;

const bodySchema = z.discriminatedUnion("decision", [
  z.object({
    messageId: z.string().uuid(),
    decision: z.literal("approve"),
    // The user may edit the agent's proposal before approving it.
    title: z.string().trim().min(1).max(200),
    body: z.string().max(20_000),
    branch: z.string().trim().min(1).max(200),
    commitMessage: z.string().trim().min(3).max(5_000),
  }),
  z.object({ messageId: z.string().uuid(), decision: z.literal("decline") }),
]);

/**
 * Answers the agent's pull request proposal. Approving commits the changes to a new branch and opens the
 * pull request with the user's own GitHub account; nothing reaches GitHub without this approval.
 */
export async function POST(request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();
    const body = bodySchema.parse(await request.json());
    const message = await getMessage(body.messageId, project.id);
    const proposal = message ? questionRequestFor(message) : null;
    if (!message || proposal?.kind !== "pull_request") return notFound("That pull request proposal wasn't found.");
    if (message.metadata.pullRequestDecision) {
      return Response.json({ error: "This proposal was already answered." }, { status: 409 });
    }

    if (body.decision === "decline") {
      await updateMessageMetadata(message.id, project.id, { pullRequestDecision: { status: "declined", at: new Date().toISOString() } });
      return Response.json({ declined: true });
    }

    if (project.status === "building") throw new GitHubError("Wait for the agent to finish, then open the pull request.", "conflict", 409);
    const result = await pushSecurityChanges(project, {
      message: body.commitMessage,
      branch: body.branch,
      createBranch: true,
      pullRequest: { title: body.title, body: body.body },
    });
    await updateMessageMetadata(message.id, project.id, {
      pullRequestDecision: { status: "opened", at: new Date().toISOString(), url: result.pullRequest?.url ?? result.url, number: result.pullRequest?.number ?? null },
    });
    return Response.json(result);
  } catch (error) {
    return githubErrorResponse(error);
  }
}
