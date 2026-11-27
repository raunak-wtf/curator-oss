import { requireViewer } from "@/lib/auth0";
import { githubErrorResponse } from "@/lib/github/http";
import { getRepositoryAccess } from "@/lib/github/sync";

export const runtime = "nodejs";

/** Where the user changes which repositories Cognix can access, and the current setting. */
export async function GET() {
  try {
    const viewer = await requireViewer();
    return Response.json({ access: await getRepositoryAccess(viewer.id) });
  } catch (error) {
    return githubErrorResponse(error);
  }
}
