import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth0";
import { GitHubError, github } from "@/lib/github/client";
import {
  GITHUB_OAUTH_COOKIE,
  GITHUB_OAUTH_COOKIE_PATH,
  exchangeGitHubCode,
  githubAppSlug,
  isGitHubApp,
  safeReturnPath,
  verifyGitHubCallback,
} from "@/lib/github/oauth";
import { getGitHubConnection, saveGitHubConnection } from "@/lib/store";

export const runtime = "nodejs";

function clearFlowCookie(response: NextResponse) {
  // One-time use: the state and PKCE verifier are gone after this request either way.
  response.cookies.set(GITHUB_OAUTH_COOKIE, "", { path: GITHUB_OAUTH_COOKIE_PATH, maxAge: 0, httpOnly: true, sameSite: "lax" });
  response.headers.set("Cache-Control", "no-store");
  // The URL carries an authorization code; never leak it to other sites.
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function finish(request: NextRequest, returnTo: string, result: string) {
  const target = new URL("/github/connected", request.url);
  target.searchParams.set("result", result);
  target.searchParams.set("returnTo", safeReturnPath(returnTo));
  return clearFlowCookie(NextResponse.redirect(target));
}

/** Starts a fresh flow through the connect route, which sets a new state cookie. */
function restart(request: NextRequest, returnTo: string, mode: "authorize" | "install") {
  const target = new URL("/api/github/connect", request.url);
  target.searchParams.set("returnTo", safeReturnPath(returnTo));
  target.searchParams.set("mode", mode);
  return clearFlowCookie(NextResponse.redirect(target));
}

/**
 * Handles both GitHub redirects:
 * - after sign-in (authorize), and
 * - after installing the GitHub App (install), which carries `installation_id` and `setup_action`.
 * A GitHub App that is authorized but not installed can reach no repositories, so a sign-in without an
 * installation continues straight to the install page.
 */
export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  const params = request.nextUrl.searchParams;
  if (!viewer) return NextResponse.redirect(new URL("/auth/login", request.url));

  let returnTo = "/";
  try {
    // Installs started on github.com (not from Cognix) arrive without our state. Never exchange those codes,
    // since they could belong to someone else; restart from Cognix instead.
    if (!request.cookies.get(GITHUB_OAUTH_COOKIE)?.value && params.get("setup_action")) {
      const connected = await getGitHubConnection(viewer.id);
      return connected ? finish(request, "/", "installed") : restart(request, "/", "authorize");
    }

    const flow = verifyGitHubCallback(request.cookies.get(GITHUB_OAUTH_COOKIE)?.value, { state: params.get("state"), ownerId: viewer.id });
    returnTo = flow.returnTo;
    if (params.get("error")) return finish(request, returnTo, params.get("error") === "access_denied" ? "cancelled" : "error");

    const code = params.get("code");
    if (!code) {
      if (params.get("setup_action")) {
        // Installed without "Request user authorization during installation": sign in separately if needed.
        return (await getGitHubConnection(viewer.id)) ? finish(request, returnTo, "installed") : restart(request, returnTo, "authorize");
      }
      return finish(request, returnTo, "error");
    }
    if (code.length > 200) return finish(request, returnTo, "error");

    const tokens = await exchangeGitHubCode(code, flow.verifier);
    const user = await github.getUser(tokens.accessToken);
    await saveGitHubConnection(viewer.id, {
      githubUserId: String(user.id),
      login: user.login,
      avatarUrl: user.avatar_url,
      ...tokens,
    });

    if (isGitHubApp() && params.get("setup_action") !== "install" && githubAppSlug()) {
      const { installations } = await github.listInstallations(tokens.accessToken).catch(() => ({ installations: [] }));
      if (!installations.length) return restart(request, returnTo, "install");
    }
    return finish(request, returnTo, params.get("setup_action") ? "installed" : "connected");
  } catch (error) {
    console.warn(`[github] connect failed: ${error instanceof GitHubError ? error.code : "unexpected"}`);
    const code = error instanceof GitHubError ? error.code : "error";
    return finish(request, returnTo, code === "forbidden" ? "denied" : code === "not_configured" ? "not_configured" : "error");
  }
}
