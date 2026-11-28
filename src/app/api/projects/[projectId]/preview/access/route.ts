import { z } from "zod";
import { requireViewer } from "@/lib/auth0";
import { errorResponse, notFound } from "@/lib/http";
import { buildPrivateShareUrl } from "@/lib/preview-access";
import {
  createOrUpdateProjectPreviewShare,
  getProject,
  getProjectPreviewAccessState,
  revokeAllProjectPreviewShares,
  revokeProjectPreviewShare,
  updateProjectPreviewAccess,
} from "@/lib/store";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();
    const access = await getProjectPreviewAccessState(project);
    return Response.json({ access }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

const patchSchema = z.object({
  mode: z.enum(["owner", "public", "private"]).optional(),
  publicDurationHours: z.number().int().min(1).max(168).optional(),
  passcode: z.string().trim().max(64).nullable().optional(),
  revokeAll: z.boolean().optional(),
});

export async function PATCH(request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();

    const body = patchSchema.parse(await request.json());
    if (body.revokeAll) {
      await revokeAllProjectPreviewShares(project.id, viewer.id);
    } else {
      await updateProjectPreviewAccess(project.id, viewer.id, {
        mode: body.mode,
        publicDurationHours: body.publicDurationHours,
        passcode: body.passcode,
      });
    }

    const updated = await getProject(project.id, viewer.id);
    if (!updated) return notFound();
    const access = await getProjectPreviewAccessState(updated);
    return Response.json({ access }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

const inviteSchema = z.object({
  email: z.string().trim().email("Enter a valid email address.").max(320),
  note: z.string().trim().max(120).optional(),
  expiresInHours: z.number().int().min(1).max(720).nullable().optional(),
});

export async function POST(request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();

    const body = inviteSchema.parse(await request.json());
    const share = await createOrUpdateProjectPreviewShare({
      projectId: project.id,
      ownerId: viewer.id,
      email: body.email,
      note: body.note ?? null,
      expiresInHours: body.expiresInHours ?? null,
    });

    const updated = await getProject(project.id, viewer.id);
    if (!updated) return notFound();
    const access = await getProjectPreviewAccessState(updated);
    const shareUrl = updated.previewUrl ? buildPrivateShareUrl(updated.previewUrl, share.shareKey) : null;

    return Response.json({ share, shareUrl, access }, { status: 201, headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();

    const shareId = new URL(request.url).searchParams.get("shareId")?.trim();
    if (!shareId) {
      return Response.json({ error: "Missing shareId parameter." }, { status: 400, headers: noStore });
    }

    const removed = await revokeProjectPreviewShare(project.id, viewer.id, shareId);
    if (!removed) return notFound();

    const updated = await getProject(project.id, viewer.id);
    if (!updated) return notFound();
    const access = await getProjectPreviewAccessState(updated);
    return Response.json({ removed: true, access }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
