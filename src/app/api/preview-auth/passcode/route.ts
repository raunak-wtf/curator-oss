import { z } from "zod";
import { parseAppsHostname } from "@/lib/domains";
import { buildOwnerPreviewFrameUrl, isPublicPreviewActive, PREVIEW_GUEST_LEASE_MS, signPreviewGrant } from "@/lib/preview-access";
import { getProjectForEdgePreview, touchProjectPreviewSession, verifyProjectPreviewPasscode } from "@/lib/store";

export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };

const bodySchema = z.object({
  host: z.string().trim().min(3).max(255),
  passcode: z.string().trim().min(1).max(64),
  next: z.string().trim().max(500).optional(),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const appsMatch = parseAppsHostname(body.host);
    if (!appsMatch || appsMatch.kind !== "preview") {
      return Response.json({ error: "Preview not found." }, { status: 404, headers: noStore });
    }
    const project = await getProjectForEdgePreview({
      slug: appsMatch.slug,
      hex8: appsMatch.hex8,
      projectId: appsMatch.projectId,
    });
    if (!project) {
      return Response.json({ error: "Preview not found." }, { status: 404, headers: noStore });
    }

    const publicActive = isPublicPreviewActive(project.previewAccessMode ?? "owner", project.previewPublicExpiresAt);
    if (!publicActive) {
      return Response.json({ error: "Public preview access has expired or been disabled." }, { status: 403, headers: noStore });
    }

    const valid = await verifyProjectPreviewPasscode(project.id, body.passcode);
    if (!valid) {
      return Response.json({ error: "Incorrect passcode. Check with the project owner and try again." }, { status: 401, headers: noStore });
    }

    await touchProjectPreviewSession(project.id, PREVIEW_GUEST_LEASE_MS);
    const ttlSeconds = project.previewPublicExpiresAt
      ? Math.max(300, Math.floor((Date.parse(project.previewPublicExpiresAt) - Date.now()) / 1000))
      : 3600;
    const grant = signPreviewGrant({
      pid: project.id,
      host: body.host.toLowerCase(),
      role: "passcode",
      ver: project.previewAccessVersion ?? 1,
      ttlSeconds,
    });
    const safeNext = body.next && body.next.startsWith("/") && !body.next.startsWith("//") ? body.next : "/";
    const redirectUrl = buildOwnerPreviewFrameUrl(`https://${body.host.toLowerCase()}`, grant, safeNext);
    return Response.json({ redirectUrl }, { headers: noStore });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Could not verify passcode.";
    return Response.json({ error: msg }, { status: 400, headers: noStore });
  }
}
