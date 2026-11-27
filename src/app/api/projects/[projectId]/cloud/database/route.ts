import { z } from "zod";
import { requireViewer } from "@/lib/auth0";
import {
  createNeonBranch,
  createNeonDatabase,
  createNeonEndpoint,
  createNeonRole,
  createNeonSnapshot,
  deleteNeonBranch,
  deleteNeonDatabase,
  deleteNeonEndpoint,
  deleteNeonRole,
  deleteNeonSnapshot,
  ensureProjectNeonDatabase,
  executeProjectSql,
  getNeonBranchSchema,
  getNeonConnectionUri,
  getProjectNeonOverview,
  isNeonApiConfigured,
  listNeonBranches,
  listNeonDatabases,
  listNeonRoles,
  renameNeonBranch,
  resetNeonRolePassword,
  restartNeonEndpoint,
  restoreNeonBranch,
  restoreNeonSnapshot,
  setDefaultNeonBranch,
  startNeonEndpoint,
  suspendNeonEndpoint,
  syncNeonConnectionSecrets,
  updateNeonEndpoint,
  updateNeonProject,
} from "@/lib/cloud/neon";
import { errorResponse, notFound } from "@/lib/http";
import { getDecryptedSecrets, getProject, getProjectCloud } from "@/lib/store";

type Context = { params: Promise<{ projectId: string }> };

export const runtime = "nodejs";
export const maxDuration = 60;

const noStore = { "Cache-Control": "no-store" };

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("provision"),
    regionId: z.string().trim().min(3).max(64).optional(),
    pgVersion: z.number().int().min(14).max(18).optional(),
  }),
  z.object({
    action: z.literal("run_sql"),
    sql: z.string().trim().min(1).max(100_000),
    branchId: z.string().trim().max(120).optional(),
    databaseName: z.string().trim().max(120).optional(),
  }),
  z.object({
    action: z.literal("branch_schema"),
    branchId: z.string().trim().max(120).optional(),
    databaseName: z.string().trim().max(120).optional(),
  }),
  z.object({
    action: z.literal("create_branch"),
    name: z.string().trim().min(1).max(64),
    parentId: z.string().trim().max(120).optional(),
    parentTimestamp: z.string().trim().max(64).optional(),
    endpointType: z.enum(["read_write", "read_only"]).optional(),
  }),
  z.object({
    action: z.literal("rename_branch"),
    branchId: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(64),
  }),
  z.object({
    action: z.literal("set_default_branch"),
    branchId: z.string().trim().min(1).max(120),
  }),
  z.object({
    action: z.literal("restore_branch"),
    branchId: z.string().trim().min(1).max(120),
    sourceBranchId: z.string().trim().min(1).max(120),
    sourceTimestamp: z.string().trim().max(64).optional(),
    preserveUnderName: z.string().trim().max(64).optional(),
  }),
  z.object({
    action: z.literal("delete_branch"),
    branchId: z.string().trim().min(1).max(120),
  }),
  z.object({
    action: z.literal("create_database"),
    branchId: z.string().trim().max(120).optional(),
    name: z.string().trim().min(1).max(63).regex(/^[a-zA-Z_][a-zA-Z0-9_-]*$/, "Use letters, numbers, underscores, or hyphens."),
    ownerName: z.string().trim().max(63).optional(),
  }),
  z.object({
    action: z.literal("delete_database"),
    branchId: z.string().trim().max(120).optional(),
    databaseName: z.string().trim().min(1).max(63),
  }),
  z.object({
    action: z.literal("create_role"),
    branchId: z.string().trim().max(120).optional(),
    name: z.string().trim().min(1).max(63).regex(/^[a-zA-Z_][a-zA-Z0-9_-]*$/, "Use letters, numbers, underscores, or hyphens."),
  }),
  z.object({
    action: z.literal("reset_role_password"),
    branchId: z.string().trim().max(120).optional(),
    roleName: z.string().trim().min(1).max(63),
  }),
  z.object({
    action: z.literal("delete_role"),
    branchId: z.string().trim().max(120).optional(),
    roleName: z.string().trim().min(1).max(63),
  }),
  z.object({
    action: z.literal("create_endpoint"),
    branchId: z.string().trim().min(1).max(120),
    type: z.enum(["read_write", "read_only"]).optional(),
    minCu: z.number().min(0.25).max(56).optional(),
    maxCu: z.number().min(0.25).max(56).optional(),
    suspendTimeoutSeconds: z.number().int().min(-1).max(604_800).optional(),
  }),
  z.object({
    action: z.literal("update_endpoint"),
    endpointId: z.string().trim().min(1).max(120),
    minCu: z.number().min(0.25).max(56).optional(),
    maxCu: z.number().min(0.25).max(56).optional(),
    suspendTimeoutSeconds: z.number().int().min(-1).max(604_800).optional(),
  }),
  z.object({
    action: z.literal("endpoint_power"),
    endpointId: z.string().trim().min(1).max(120),
    operation: z.enum(["start", "suspend", "restart", "delete"]),
  }),
  z.object({
    action: z.literal("create_snapshot"),
    branchId: z.string().trim().max(120).optional(),
    name: z.string().trim().min(1).max(64).optional(),
  }),
  z.object({
    action: z.literal("restore_snapshot"),
    snapshotId: z.string().trim().min(1).max(120),
    targetBranchId: z.string().trim().max(120).optional(),
    name: z.string().trim().max(64).optional(),
  }),
  z.object({
    action: z.literal("delete_snapshot"),
    snapshotId: z.string().trim().min(1).max(120),
  }),
  z.object({
    action: z.literal("update_project"),
    name: z.string().trim().min(1).max(64).optional(),
    historyRetentionSeconds: z.number().int().min(0).max(2_592_000).optional(),
  }),
  z.object({
    action: z.literal("use_connection"),
    branchId: z.string().trim().max(120).optional(),
    databaseName: z.string().trim().max(63).optional(),
    roleName: z.string().trim().max(63).optional(),
  }),
]);

async function requireNeonProjectId(projectId: string) {
  const cloud = await getProjectCloud(projectId);
  if (!cloud?.neonProjectId) {
    throw new Error("Provision the managed Neon database first.");
  }
  return cloud.neonProjectId;
}

async function resolveBranchId(neonProjectId: string, branchId?: string) {
  if (branchId) return branchId;
  const branches = await listNeonBranches(neonProjectId);
  const primary = branches.find((b) => b.default || b.primary) ?? branches[0];
  if (!primary) throw new Error("No branches exist on this Neon project.");
  return primary.id;
}

export async function GET(_request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();
    const overview = await getProjectNeonOverview(project);
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

    const body = actionSchema.parse(await request.json());

    if (body.action === "provision") {
      const provisioned = await ensureProjectNeonDatabase(project, {
        regionId: body.regionId,
        pgVersion: body.pgVersion,
      });
      const overview = await getProjectNeonOverview(project);
      return Response.json({ ok: true, provisioned, overview }, { headers: noStore });
    }

    if (body.action === "run_sql") {
      const secrets = await getDecryptedSecrets(project.id);
      let connectionUrl = secrets.DATABASE_URL;
      if (body.branchId && isNeonApiConfigured()) {
        const cloud = await getProjectCloud(project.id);
        if (cloud?.neonProjectId) {
          const [dbs, roles] = await Promise.all([
            listNeonDatabases(cloud.neonProjectId, body.branchId),
            listNeonRoles(cloud.neonProjectId, body.branchId),
          ]);
          const dbName = body.databaseName ?? dbs[0]?.name ?? "neondb";
          const roleName = roles[0]?.name;
          if (roleName) {
            connectionUrl = await getNeonConnectionUri(cloud.neonProjectId, {
              branchId: body.branchId,
              databaseName: dbName,
              roleName,
              pooled: true,
            });
          }
        }
      }
      if (!connectionUrl) {
        return Response.json(
          { error: "No DATABASE_URL is configured yet. Provision Neon first." },
          { status: 409, headers: noStore },
        );
      }
      const result = await executeProjectSql(connectionUrl, body.sql);
      return Response.json({ ok: true, result }, { headers: noStore });
    }

    const neonProjectId = await requireNeonProjectId(project.id);

    switch (body.action) {
      case "branch_schema": {
        const branchId = await resolveBranchId(neonProjectId, body.branchId);
        const sql = await getNeonBranchSchema(neonProjectId, branchId, body.databaseName || "neondb");
        return Response.json({ ok: true, sql }, { headers: noStore });
      }
      case "create_branch": {
        const created = await createNeonBranch(neonProjectId, {
          name: body.name,
          parentId: body.parentId,
          parentTimestamp: body.parentTimestamp,
          endpointType: body.endpointType,
        });
        return Response.json({ ok: true, ...created, overview: await getProjectNeonOverview(project) }, { headers: noStore });
      }
      case "rename_branch": {
        const branch = await renameNeonBranch(neonProjectId, body.branchId, body.name);
        return Response.json({ ok: true, branch, overview: await getProjectNeonOverview(project) }, { headers: noStore });
      }
      case "set_default_branch": {
        const branch = await setDefaultNeonBranch(neonProjectId, body.branchId);
        await syncNeonConnectionSecrets(project, neonProjectId, { branchId: branch.id });
        return Response.json({ ok: true, branch, overview: await getProjectNeonOverview(project) }, { headers: noStore });
      }
      case "restore_branch": {
        const branch = await restoreNeonBranch(neonProjectId, body.branchId, {
          sourceBranchId: body.sourceBranchId,
          sourceTimestamp: body.sourceTimestamp,
          preserveUnderName: body.preserveUnderName,
        });
        return Response.json({ ok: true, branch, overview: await getProjectNeonOverview(project) }, { headers: noStore });
      }
      case "delete_branch": {
        await deleteNeonBranch(neonProjectId, body.branchId);
        return Response.json({ ok: true, overview: await getProjectNeonOverview(project) }, { headers: noStore });
      }
      case "create_database": {
        const branchId = await resolveBranchId(neonProjectId, body.branchId);
        const roles = await listNeonRoles(neonProjectId, branchId);
        const ownerName = body.ownerName ?? roles.find((r) => !r.protected)?.name ?? roles[0]?.name;
        if (!ownerName) throw new Error("No role available on this branch.");
        const database = await createNeonDatabase(neonProjectId, branchId, { name: body.name, ownerName });
        return Response.json({ ok: true, database, overview: await getProjectNeonOverview(project) }, { headers: noStore });
      }
      case "delete_database": {
        const branchId = await resolveBranchId(neonProjectId, body.branchId);
        await deleteNeonDatabase(neonProjectId, branchId, body.databaseName);
        return Response.json({ ok: true, overview: await getProjectNeonOverview(project) }, { headers: noStore });
      }
      case "create_role": {
        const branchId = await resolveBranchId(neonProjectId, body.branchId);
        const role = await createNeonRole(neonProjectId, branchId, { name: body.name });
        return Response.json({ ok: true, role: { name: role.name }, overview: await getProjectNeonOverview(project) }, { headers: noStore });
      }
      case "reset_role_password": {
        const branchId = await resolveBranchId(neonProjectId, body.branchId);
        await resetNeonRolePassword(neonProjectId, branchId, body.roleName);
        await syncNeonConnectionSecrets(project, neonProjectId, { branchId, roleName: body.roleName });
        return Response.json({ ok: true, overview: await getProjectNeonOverview(project) }, { headers: noStore });
      }
      case "delete_role": {
        const branchId = await resolveBranchId(neonProjectId, body.branchId);
        await deleteNeonRole(neonProjectId, branchId, body.roleName);
        return Response.json({ ok: true, overview: await getProjectNeonOverview(project) }, { headers: noStore });
      }
      case "create_endpoint": {
        const endpoint = await createNeonEndpoint(neonProjectId, {
          branchId: body.branchId,
          type: body.type,
          minCu: body.minCu,
          maxCu: body.maxCu,
          suspendTimeoutSeconds: body.suspendTimeoutSeconds,
        });
        return Response.json({ ok: true, endpoint, overview: await getProjectNeonOverview(project) }, { headers: noStore });
      }
      case "update_endpoint": {
        const endpoint = await updateNeonEndpoint(neonProjectId, body.endpointId, {
          minCu: body.minCu,
          maxCu: body.maxCu,
          suspendTimeoutSeconds: body.suspendTimeoutSeconds,
        });
        return Response.json({ ok: true, endpoint, overview: await getProjectNeonOverview(project) }, { headers: noStore });
      }
      case "endpoint_power": {
        if (body.operation === "start") await startNeonEndpoint(neonProjectId, body.endpointId);
        else if (body.operation === "suspend") await suspendNeonEndpoint(neonProjectId, body.endpointId);
        else if (body.operation === "restart") await restartNeonEndpoint(neonProjectId, body.endpointId);
        else await deleteNeonEndpoint(neonProjectId, body.endpointId);
        return Response.json({ ok: true, overview: await getProjectNeonOverview(project) }, { headers: noStore });
      }
      case "create_snapshot": {
        const branchId = await resolveBranchId(neonProjectId, body.branchId);
        const snapshot = await createNeonSnapshot(neonProjectId, branchId, { name: body.name });
        return Response.json({ ok: true, snapshot, overview: await getProjectNeonOverview(project) }, { headers: noStore });
      }
      case "restore_snapshot": {
        await restoreNeonSnapshot(neonProjectId, body.snapshotId, {
          targetBranchId: body.targetBranchId,
          name: body.name,
          finalizeRestore: true,
        });
        return Response.json({ ok: true, overview: await getProjectNeonOverview(project) }, { headers: noStore });
      }
      case "delete_snapshot": {
        await deleteNeonSnapshot(neonProjectId, body.snapshotId);
        return Response.json({ ok: true, overview: await getProjectNeonOverview(project) }, { headers: noStore });
      }
      case "update_project": {
        await updateNeonProject(neonProjectId, {
          name: body.name,
          historyRetentionSeconds: body.historyRetentionSeconds,
        });
        return Response.json({ ok: true, overview: await getProjectNeonOverview(project) }, { headers: noStore });
      }
      case "use_connection": {
        const synced = await syncNeonConnectionSecrets(project, neonProjectId, {
          branchId: body.branchId,
          databaseName: body.databaseName,
          roleName: body.roleName,
        });
        return Response.json({ ok: true, synced, overview: await getProjectNeonOverview(project) }, { headers: noStore });
      }
    }
  } catch (error) {
    return errorResponse(error);
  }
}
