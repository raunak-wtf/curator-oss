import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { canonicalAccountId } from "./identity";
import type { Viewer } from "./types";

export const isAuthConfigured = Boolean(
  process.env.AUTH0_DOMAIN?.trim() &&
    process.env.AUTH0_CLIENT_ID?.trim() &&
    process.env.AUTH0_CLIENT_SECRET?.trim() &&
    process.env.AUTH0_SECRET?.trim(),
);

export const auth0 = isAuthConfigured
  ? new Auth0Client({
      enableAccessTokenEndpoint: false,
      ...(process.env.APP_BASE_URL?.trim() ? { appBaseUrl: process.env.APP_BASE_URL.trim() } : {}),
    })
  : null;

export async function getViewer(): Promise<Viewer | null> {
  if (auth0) {
    try {
      const session = await auth0.getSession();
      if (session?.user.sub && session.user.email) {
        const emailVerified = session.user.email_verified === true;
        return {
          id: canonicalAccountId(session.user.email, emailVerified, session.user.sub),
          email: session.user.email,
          emailVerified,
          name: session.user.name ?? session.user.nickname ?? session.user.email,
          picture: session.user.picture,
        };
      }
    } catch (error) {
      if (process.env.NODE_ENV === "production") throw error;
    }
  }

  return null;
}

export async function requireViewer() {
  const viewer = await getViewer();
  if (!viewer) {
    throw new Response("Sign in to continue.", { status: 401 });
  }
  const { ensureUser } = await import("./store");
  await ensureUser(viewer);
  return viewer;
}
