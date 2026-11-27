import { requireViewer } from "@/lib/auth0";
import { errorResponse, notFound } from "@/lib/http";
import { getProject, getProjectAnalyticsSummary } from "@/lib/store";

export const runtime = "nodejs";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();

    const daysParam = Number(new URL(request.url).searchParams.get("days") ?? "7");
    const summary = await getProjectAnalyticsSummary(project.id, daysParam === 30 ? 30 : 7);
    return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
