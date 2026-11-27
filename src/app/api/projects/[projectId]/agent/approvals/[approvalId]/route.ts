import { z } from "zod";
import { requireViewer } from "@/lib/auth0";
import { errorResponse, notFound } from "@/lib/http";
import { getProject, resolveAgentApproval } from "@/lib/store";

type Context = { params: Promise<{ projectId: string; approvalId: string }> };

export const runtime = "nodejs";

const bodySchema = z.object({
  decisions: z
    .array(
      z.object({
        callId: z.string().min(1).max(200),
        decision: z.enum(["allow", "deny"]),
        note: z.string().trim().max(2_000).optional(),
      }),
    )
    .min(1)
    .max(50),
  /** Allow every later file change and command in the same run without asking again. */
  allowRestOfRun: z.boolean().optional().default(false),
});

/** The owner allows or denies the actions a Request review run is waiting on. */
export async function POST(request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const params = z.object({ projectId: z.string().uuid(), approvalId: z.string().uuid() }).parse(await context.params);
    const project = await getProject(params.projectId, viewer.id);
    if (!project) return notFound();
    const body = bodySchema.parse(await request.json());
    const decisions = body.allowRestOfRun ? [...body.decisions, { callId: "*", decision: "allow" as const }] : body.decisions;
    const saved = await resolveAgentApproval(params.approvalId, project.id, viewer.id, decisions);
    if (!saved) {
      return Response.json({ error: "This request was already answered or expired. Send the agent a message to continue." }, { status: 409 });
    }
    return Response.json({ saved: true });
  } catch (error) {
    return errorResponse(error);
  }
}
