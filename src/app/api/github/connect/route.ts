import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth0";
import { GitHubError } from "@/lib/github/client";
import { GITHUB_OAUTH_COOKIE, GITHUB_OAUTH_COOKIE_PATH, beginGitHubAuthorization, safeReturnPath } from "@/lib/github/oauth";
import { ensureUser } from "@/lib/store";

export const runtime = "nodejs";

function publicBaseUrl(requestUrl: URL): string {
  return process.env.APP_BASE_URL?.trim() || requestUrl.origin;
}

/** Starts the GitHub OAuth flow for the signed-in Cognix user. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const base = publicBaseUrl(url);
  const returnTo = safeReturnPath(url.searchParams.get("returnTo"));
  const viewer = await getViewer();
  if (!viewer) {
    return NextResponse.redirect(new URL(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`, base));
  }
  await ensureUser(viewer);

  try {
    const mode = url.searchParams.get("mode") === "install" ? "install" : "authorize";
    const { url: authorizeUrl, cookie, maxAgeSeconds } = beginGitHubAuthorization(viewer.id, returnTo, mode);
    const response = NextResponse.redirect(authorizeUrl);
    response.cookies.set(GITHUB_OAUTH_COOKIE, cookie, {
      httpOnly: true,
      secure: base.startsWith("https://") || url.protocol === "https:",
      sameSite: "lax",
      path: GITHUB_OAUTH_COOKIE_PATH,
      maxAge: maxAgeSeconds,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const code = error instanceof GitHubError ? error.code : "unavailable";
    const target = new URL("/github/connected", base);
    target.searchParams.set("result", code === "not_configured" ? "not_configured" : "error");
    target.searchParams.set("returnTo", returnTo);
    return NextResponse.redirect(target);
  }
}
