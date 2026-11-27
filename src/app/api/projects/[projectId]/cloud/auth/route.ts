import { randomBytes } from "node:crypto";
import { z } from "zod";
import { requireViewer } from "@/lib/auth0";
import {
  deleteBetterAuthUser,
  inspectBetterAuthCodebase,
  inspectBetterAuthDatabase,
  revokeBetterAuthUserSessions,
  setBetterAuthUserVerified,
  type BetterAuthOverview,
} from "@/lib/cloud/better-auth";
import { ensureProjectNeonDatabase, isNeonApiConfigured } from "@/lib/cloud/neon";
import { syncProjectEnv } from "@/lib/daytona";
import { errorResponse, notFound } from "@/lib/http";
import { getDecryptedSecrets, getProject, getProjectCloud, listProjectFiles, upsertSecret } from "@/lib/store";

type Context = { params: Promise<{ projectId: string }> };

export const runtime = "nodejs";
export const maxDuration = 45;

const noStore = { "Cache-Control": "no-store" };

const authActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("rotate_secret") }),
  z.object({ action: z.literal("provision_database") }),
  z.object({
    action: z.literal("set_verified"),
    userId: z.string().trim().min(1).max(200),
    verified: z.boolean(),
  }),
  z.object({
    action: z.literal("revoke_sessions"),
    userId: z.string().trim().min(1).max(200),
  }),
  z.object({
    action: z.literal("delete_user"),
    userId: z.string().trim().min(1).max(200),
  }),
]);

async function loadAuthOverview(projectId: string, search?: string): Promise<BetterAuthOverview & { neonApiConfigured: boolean }> {
  const [secrets, cloud, files] = await Promise.all([
    getDecryptedSecrets(projectId),
    getProjectCloud(projectId),
    listProjectFiles(projectId),
  ]);

  const codebase = inspectBetterAuthCodebase(files);
  const dbState = await inspectBetterAuthDatabase(secrets.DATABASE_URL, { search, limit: 50 });

  return {
    neonApiConfigured: isNeonApiConfigured(),
    secretSet: Boolean(secrets.BETTER_AUTH_SECRET?.trim()),
    databaseSet: Boolean(secrets.DATABASE_URL?.trim()),
    neonProvisioned: Boolean(cloud?.neonProjectId),
    emailConfigured: Boolean(secrets.RESEND_API_KEY?.trim()),
    emailFrom: secrets.EMAIL_FROM?.trim() || null,
    codebase,
    ...dbState,
  };
}

export async function GET(request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();

    const search = new URL(request.url).searchParams.get("search") ?? undefined;
    const overview = await loadAuthOverview(project.id, search);
    return Response.json(overview, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();

    const body = authActionSchema.parse(await request.json());

    if (body.action === "rotate_secret") {
      await upsertSecret(project.id, "BETTER_AUTH_SECRET", randomBytes(32).toString("base64url"), "cloud");
      if (project.sandboxId) await syncProjectEnv(project).catch(() => undefined);
      return Response.json({ ok: true, overview: await loadAuthOverview(project.id) }, { headers: noStore });
    }

    if (body.action === "provision_database") {
      await ensureProjectNeonDatabase(project);
      return Response.json({ ok: true, overview: await loadAuthOverview(project.id) }, { headers: noStore });
    }

    const secrets = await getDecryptedSecrets(project.id);
    const databaseUrl = secrets.DATABASE_URL;
    if (!databaseUrl) {
      return Response.json(
        { error: "Provision the Cloud PostgreSQL database first." },
        { status: 409, headers: noStore },
      );
    }

    if (body.action === "set_verified") {
      await setBetterAuthUserVerified(databaseUrl, body.userId, body.verified);
    } else if (body.action === "revoke_sessions") {
      await revokeBetterAuthUserSessions(databaseUrl, body.userId);
    } else if (body.action === "delete_user") {
      await deleteBetterAuthUser(databaseUrl, body.userId);
    }

    return Response.json({ ok: true, overview: await loadAuthOverview(project.id) }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
