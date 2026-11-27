import { z } from "zod";
import { requireViewer } from "@/lib/auth0";
import { deleteNeonProject, isNeonApiConfigured } from "@/lib/cloud/neon";
import { deleteProjectSandbox } from "@/lib/daytona";
import { removeDomainDns, removeEdgeHostname } from "@/lib/dns";
import { errorResponse, notFound } from "@/lib/http";
import { deleteObject } from "@/lib/storage";
import {
  deleteProject,
  getProject,
  getProjectCloud,
  listMessages,
  listProjectAttachmentKeys,
  listProjectDomains,
  updateProject,
} from "@/lib/store";

type Context = { params: Promise<{ projectId: string }> };

export const runtime = "nodejs";

export async function GET(_request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();
    return Response.json({ project, messages: await listMessages(project.id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();

    // The sandbox holds the code, preview, and published runtime. Stop if it cannot be removed,
    // so the project record is kept and the owner can retry instead of leaking a running sandbox.
    try {
      await deleteProjectSandbox(project);
    } catch {
      return Response.json(
        { error: "Cognix could not delete this project's sandbox. Try again in a moment." },
        { status: 502 },
      );
    }

    const [domains, attachmentKeys, cloud] = await Promise.all([
      listProjectDomains(project.id),
      listProjectAttachmentKeys(project.id),
      getProjectCloud(project.id).catch(() => null),
    ]);
    // Detaching domains, managed Neon databases, and uploads is best effort.
    await Promise.allSettled([
      ...domains.map(async (domain) => {
        if (domain.managedByProvider) await removeDomainDns(domain).catch(() => false);
        await removeEdgeHostname(domain.hostname).catch(() => false);
      }),
      ...attachmentKeys.map((key) => deleteObject(key)),
      ...(cloud?.neonProjectId && isNeonApiConfigured() ? [deleteNeonProject(cloud.neonProjectId)] : []),
    ]);

    const deleted = await deleteProject(project.id, viewer.id);
    if (!deleted) return notFound();
    return Response.json({ deleted: true, projectId: project.id });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const patch = z
      .object({
        title: z.string().trim().min(1).max(120).optional(),
        description: z.string().max(500).optional(),
        showBadge: z.boolean().optional(),
        publicRemix: z.boolean().optional(),
      })
      .parse(await request.json());
    const project = await updateProject(projectId, viewer.id, patch);
    if (!project) return notFound();
    return Response.json({ project });
  } catch (error) {
    return errorResponse(error);
  }
}

