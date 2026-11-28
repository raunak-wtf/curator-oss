import { z } from "zod";
import { getViewer } from "@/lib/auth0";
import { errorResponse } from "@/lib/http";
import { startRemix } from "@/lib/remix";
import { checkUserAgentEntitlement, ensureUser, getRemixableProject } from "@/lib/store";

type Context = { params: Promise<{ projectId: string }> };

export const runtime = "nodejs";

declare global {
  var __cognixRemixTimes: Map<string, number[]> | undefined;
}
const recent = globalThis.__cognixRemixTimes ?? (globalThis.__cognixRemixTimes = new Map());
const LIMIT = 5;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_RECENT_USERS = 1_000;

/** Copies a project into a new project owned by the signed-in user. */
export async function POST(request: Request, context: Context) {
  try {
    const viewer = await getViewer();
    if (!viewer) return Response.json({ error: "Sign in to remix this project." }, { status: 401 });
    await ensureUser(viewer);

    const entitlement = await checkUserAgentEntitlement(viewer);
    if (!entitlement.allowed) {
      return Response.json(
        {
          error: entitlement.message ?? "An active Curator Pro subscription ($10/month) is required to remix projects.",
          code: entitlement.reason === "credits_exhausted" ? "CREDITS_EXHAUSTED" : "SUBSCRIPTION_REQUIRED",
          billingUrl: "/billing",
        },
        { status: 402 },
      );
    }

    const { projectId } = await context.params;
    // Owners can always remix; others only when the owner turned on public remixing.
    const source = await getRemixableProject(projectId, viewer.id);
    if (!source) return Response.json({ error: "This project is private or no longer exists." }, { status: 404 });
    if (!source.sandboxId) return Response.json({ error: "This project hasn't been built yet, so there's no code to copy." }, { status: 409 });

    // Each remix starts a sandbox, so limit how fast one person can create them.
    const now = Date.now();
    const times = (recent.get(viewer.id) ?? []).filter((time: number) => now - time < WINDOW_MS);
    if (times.length >= LIMIT) return Response.json({ error: "You've remixed several projects in a row. Wait a few minutes, then try again." }, { status: 429 });
    if (recent.size >= MAX_RECENT_USERS && !recent.has(viewer.id)) {
      const oldestKey = recent.keys().next().value;
      if (oldestKey) recent.delete(oldestKey);
    }
    recent.set(viewer.id, [...times, now]);

    const input = z
      .object({ title: z.string().trim().min(1).max(120), includeHistory: z.boolean().optional().default(false) })
      .parse(await request.json());
    const project = await startRemix({ source, viewer, title: input.title, includeHistory: input.includeHistory });
    return Response.json({ project }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
