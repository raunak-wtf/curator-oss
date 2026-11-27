import { writeCommitMessage } from "@/lib/ai/commit-message";
import { requireViewer } from "@/lib/auth0";
import { githubErrorResponse } from "@/lib/github/http";
import { listSecurityChanges } from "@/lib/github/security-source";
import { notFound } from "@/lib/http";
import { getProject, listMessages } from "@/lib/store";

type Context = { params: Promise<{ projectId: string }> };

export const runtime = "nodejs";
export const maxDuration = 60;

/** Security mode: the agent writes a detailed commit message from the pending changes and the conversation. */
export async function POST(_request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();
    const { changes } = await listSecurityChanges(project);
    if (!changes.length) return Response.json({ error: "There are no changes to describe." }, { status: 409 });
    const messages = await listMessages(project.id);
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant" && message.content.trim());
    const message = await writeCommitMessage({
      request: lastUser?.content.slice(0, 2_000),
      summary: lastAssistant?.content.slice(0, 6_000),
      changes: changes.map((change) => ({
        path: change.path,
        kind: change.kind,
        ...(change.added !== null ? { added: change.added } : {}),
        ...(change.removed !== null ? { removed: change.removed } : {}),
      })),
    });
    return Response.json({ message });
  } catch (error) {
    return githubErrorResponse(error);
  }
}
