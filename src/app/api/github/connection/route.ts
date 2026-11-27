import { requireViewer } from "@/lib/auth0";
import { githubErrorResponse } from "@/lib/github/http";
import { isGitHubConfigured, revokeGitHubGrant } from "@/lib/github/oauth";
import { deleteGitHubConnection, getGitHubAccessToken, getGitHubConnection } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  try {
    const viewer = await requireViewer();
    const connection = await getGitHubConnection(viewer.id);
    return Response.json({
      configured: isGitHubConfigured(),
      connection: connection ? { login: connection.login, avatarUrl: connection.avatarUrl, connectedAt: connection.createdAt } : null,
    });
  } catch (error) {
    return githubErrorResponse(error);
  }
}

/** Disconnects GitHub: revokes the grant on GitHub, then deletes the stored token. */
export async function DELETE() {
  try {
    const viewer = await requireViewer();
    const token = await getGitHubAccessToken(viewer.id).catch(() => null);
    if (token && isGitHubConfigured()) await revokeGitHubGrant(token);
    await deleteGitHubConnection(viewer.id);
    return Response.json({ disconnected: true });
  } catch (error) {
    return githubErrorResponse(error);
  }
}
