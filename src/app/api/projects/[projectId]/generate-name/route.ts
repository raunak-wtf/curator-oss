import { requireViewer } from "@/lib/auth0";
import { generateProjectName } from "@/lib/ai/project-name";
import { errorResponse, notFound } from "@/lib/http";
import { checkUserAgentEntitlement, getProject, listMessages } from "@/lib/store";

type Context = { params: Promise<{ projectId: string }> };

export const runtime = "nodejs";

export async function POST(_request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const entitlement = await checkUserAgentEntitlement(viewer);
    if (!entitlement.allowed) {
      return Response.json({ error: entitlement.message ?? "Curator Pro subscription required." }, { status: 402 });
    }
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();

    const messages = await listMessages(project.id);
    const firstUserPrompt = messages.find((item) => item.role === "user")?.content;
    const seedPrompt = firstUserPrompt || project.description || project.title;

    const generated = await generateProjectName(seedPrompt);
    return Response.json(generated, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
