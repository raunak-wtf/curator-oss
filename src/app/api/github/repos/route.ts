import { requireViewer } from "@/lib/auth0";
import { githubErrorResponse } from "@/lib/github/http";
import { listReadableRepositories } from "@/lib/github/security-source";
import { listPushableRepositories } from "@/lib/github/sync";

export const runtime = "nodejs";

/**
 * Repositories for the connected account, most recently pushed first.
 * `?access=read` lists every repository the user can read (Security mode); the default lists those they can push to.
 */
export async function GET(request: Request) {
  try {
    const viewer = await requireViewer();
    const access = new URL(request.url).searchParams.get("access");
    const repositories = access === "read" ? await listReadableRepositories(viewer.id) : await listPushableRepositories(viewer.id);
    return Response.json({ repositories });
  } catch (error) {
    return githubErrorResponse(error);
  }
}
