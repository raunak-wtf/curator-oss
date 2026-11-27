import { z } from "zod";
import { syncProjectEnv } from "@/lib/daytona";
import {
  compareNeonBranchSchema,
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
  listNeonEndpoints,
  listNeonRoles,
  listNeonSnapshots,
  renameNeonBranch,
  resetNeonRolePassword,
  restoreNeonBranch,
  restoreNeonSnapshot,
  scrubConnectionCredentials,
  setDefaultNeonBranch,
  startNeonEndpoint,
  suspendNeonEndpoint,
  restartNeonEndpoint,
  syncNeonConnectionSecrets,
  updateNeonDatabase,
  updateNeonEndpoint,
  updateNeonProject,
} from "@/lib/cloud/neon";
import {
  cancelResendEmail,
  createResendAudience,
  createResendBroadcast,
  createResendContact,
  createResendDomain,
  createResendWebhook,
  deleteResendAudience,
  deleteResendBroadcast,
  deleteResendContact,
  deleteResendDomain,
  deleteResendWebhook,
  getResendAudience,
  getResendBroadcast,
  getResendContact,
  getResendDomain,
  getResendEmail,
  getResendWebhook,
  listResendApiKeys,
  listResendAudiences,
  listResendBroadcasts,
  listResendContacts,
  listResendDomains,
  listResendEmails,
  listResendWebhooks,
  scrubResendKey,
  sendResendBatchEmails,
  sendResendBroadcast,
  sendResendEmail,
  updateResendContact,
  updateResendDomain,
  updateResendEmail,
  updateResendWebhook,
  verifyResendDomain,
} from "@/lib/cloud/resend";
import { getDecryptedSecrets, getProjectCloud, upsertSecret } from "@/lib/store";
import type { Project } from "@/lib/types";

export const CLOUD_PROVIDER_TOOL_NAMES = ["neon_database", "resend_email"] as const;
export type CloudProviderToolName = (typeof CLOUD_PROVIDER_TOOL_NAMES)[number];

export function isCloudProviderTool(name: string): name is CloudProviderToolName {
  return (CLOUD_PROVIDER_TOOL_NAMES as readonly string[]).includes(name);
}

const NEON_ACTIONS = [
  "status",
  "provision",
  "run_sql",
  "inspect_schema",
  "compare_schema",
  "list_branches",
  "create_branch",
  "rename_branch",
  "set_default_branch",
  "restore_branch",
  "delete_branch",
  "list_databases",
  "create_database",
  "update_database",
  "delete_database",
  "list_roles",
  "create_role",
  "reset_role_password",
  "delete_role",
  "list_endpoints",
  "create_endpoint",
  "update_endpoint",
  "start_endpoint",
  "suspend_endpoint",
  "restart_endpoint",
  "delete_endpoint",
  "list_snapshots",
  "create_snapshot",
  "restore_snapshot",
  "delete_snapshot",
  "update_project_settings",
  "use_connection",
] as const;

const RESEND_ACTIONS = [
  "status",
  "list_domains",
  "get_domain",
  "create_domain",
  "verify_domain",
  "update_domain",
  "delete_domain",
  "set_default_from",
  "send_email",
  "send_batch_emails",
  "list_emails",
  "get_email",
  "update_email",
  "cancel_email",
  "list_audiences",
  "get_audience",
  "create_audience",
  "delete_audience",
  "list_contacts",
  "get_contact",
  "create_contact",
  "update_contact",
  "delete_contact",
  "list_broadcasts",
  "get_broadcast",
  "create_broadcast",
  "send_broadcast",
  "delete_broadcast",
  "list_webhooks",
  "get_webhook",
  "create_webhook",
  "update_webhook",
  "delete_webhook",
  "list_api_keys",
] as const;

export const cloudProviderTools = [
  {
    type: "function" as const,
    function: {
      name: "neon_database",
      description:
        "Manage this project's Cognix-managed Neon serverless PostgreSQL database via the Neon API. Supports provisioning, running SQL queries/migrations, schema inspection/diffing, instant copy-on-write branches, point-in-time branch restore, databases, roles, compute endpoints/read replicas/autoscaling, snapshots, and syncing DATABASE_URL + DIRECT_URL into the sandbox.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: [...NEON_ACTIONS] },
          sql: { type: "string", description: "SQL query for action=run_sql." },
          params: { type: "array", items: {}, description: "Optional positional SQL parameters ($1, $2, …)." },
          branchId: { type: "string", description: "Target Neon branch ID (defaults to the project's primary branch)." },
          baseBranchId: { type: "string", description: "Base branch ID for compare_schema, or source branch ID for restore_branch." },
          name: { type: "string", description: "Name for create_branch, rename_branch, create_database, create_role, create_snapshot, or update_project_settings." },
          newName: { type: "string", description: "New database name for update_database." },
          databaseName: { type: "string", description: "Postgres database name (default: neondb)." },
          roleName: { type: "string", description: "Postgres role/owner name." },
          endpointId: { type: "string", description: "Compute endpoint ID for endpoint actions." },
          endpointType: { type: "string", enum: ["read_write", "read_only"] },
          minCu: { type: "number", description: "Minimum autoscaling compute units (e.g. 0.25)." },
          maxCu: { type: "number", description: "Maximum autoscaling compute units (e.g. 2)." },
          suspendTimeoutSeconds: { type: "number", description: "Idle seconds before compute suspends (0 = default 300s, -1 = never)." },
          historyRetentionSeconds: { type: "number", description: "Point-in-time history retention window in seconds." },
          timestamp: { type: "string", description: "ISO-8601 timestamp for point-in-time create_branch or restore_branch." },
          lsn: { type: "string", description: "Postgres LSN for create_branch or restore_branch." },
          snapshotId: { type: "string", description: "Snapshot ID for restore_snapshot or delete_snapshot." },
          regionId: { type: "string", description: "Optional Neon region (e.g. aws-us-east-1) when provisioning." },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "resend_email",
      description:
        "Manage transactional email, sending domains, DNS verification, audiences, contacts, broadcasts, and webhooks through the user's connected Resend account (RESEND_API_KEY).",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: [...RESEND_ACTIONS] },
          domainId: { type: "string" },
          name: { type: "string", description: "Domain name, audience name, or broadcast name." },
          region: { type: "string", enum: ["us-east-1", "eu-west-1", "sa-east-1", "ap-northeast-1"] },
          openTracking: { type: "boolean" },
          clickTracking: { type: "boolean" },
          tls: { type: "string", enum: ["opportunistic", "enforced"] },
          from: { type: "string", description: "Sender address (e.g. 'Acme <hello@yourdomain.com>')." },
          to: {
            anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
            description: "Recipient email address(es).",
          },
          subject: { type: "string" },
          text: { type: "string" },
          html: { type: "string" },
          replyTo: { type: "string" },
          scheduledAt: { type: "string", description: "ISO-8601 schedule time." },
          emailId: { type: "string" },
          emails: {
            type: "array",
            items: {
              type: "object",
              properties: {
                from: { type: "string" },
                to: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
                subject: { type: "string" },
                text: { type: "string" },
                html: { type: "string" },
              },
              required: ["from", "to", "subject"],
            },
          },
          audienceId: { type: "string" },
          contactId: { type: "string" },
          email: { type: "string", description: "Contact email address." },
          firstName: { type: "string" },
          lastName: { type: "string" },
          unsubscribed: { type: "boolean" },
          broadcastId: { type: "string" },
          webhookId: { type: "string" },
          endpoint: { type: "string", description: "HTTPS webhook endpoint URL." },
          events: { type: "array", items: { type: "string" } },
          webhookStatus: { type: "string", enum: ["enabled", "disabled"] },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  },
];

const neonInputSchema = z.object({
  action: z.enum(NEON_ACTIONS),
  sql: z.string().max(100_000).optional(),
  params: z.array(z.unknown()).max(100).optional(),
  branchId: z.string().trim().max(120).optional(),
  baseBranchId: z.string().trim().max(120).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  newName: z.string().trim().min(1).max(120).optional(),
  databaseName: z.string().trim().min(1).max(120).optional(),
  roleName: z.string().trim().min(1).max(120).optional(),
  endpointId: z.string().trim().max(120).optional(),
  endpointType: z.enum(["read_write", "read_only"]).optional(),
  minCu: z.number().min(0.25).max(56).optional(),
  maxCu: z.number().min(0.25).max(56).optional(),
  suspendTimeoutSeconds: z.number().int().min(-1).max(604_800).optional(),
  historyRetentionSeconds: z.number().int().min(0).max(2_592_000).optional(),
  timestamp: z.string().trim().max(64).optional(),
  lsn: z.string().trim().max(64).optional(),
  snapshotId: z.string().trim().max(120).optional(),
  regionId: z.string().trim().max(64).optional(),
});

const resendInputSchema = z.object({
  action: z.enum(RESEND_ACTIONS),
  domainId: z.string().trim().max(120).optional(),
  name: z.string().trim().max(253).optional(),
  region: z.enum(["us-east-1", "eu-west-1", "sa-east-1", "ap-northeast-1"]).optional(),
  openTracking: z.boolean().optional(),
  clickTracking: z.boolean().optional(),
  tls: z.enum(["opportunistic", "enforced"]).optional(),
  from: z.string().trim().max(320).optional(),
  to: z.union([z.string().trim().max(320), z.array(z.string().trim().max(320)).min(1).max(50)]).optional(),
  subject: z.string().max(500).optional(),
  text: z.string().max(200_000).optional(),
  html: z.string().max(400_000).optional(),
  replyTo: z.string().trim().max(320).optional(),
  scheduledAt: z.string().trim().max(64).optional(),
  emailId: z.string().trim().max(120).optional(),
  emails: z
    .array(
      z.object({
        from: z.string().trim().max(320),
        to: z.union([z.string().trim().max(320), z.array(z.string().trim().max(320)).min(1).max(50)]),
        subject: z.string().max(500),
        text: z.string().max(100_000).optional(),
        html: z.string().max(200_000).optional(),
      }),
    )
    .max(100)
    .optional(),
  audienceId: z.string().trim().max(120).optional(),
  contactId: z.string().trim().max(120).optional(),
  email: z.string().trim().max(320).optional(),
  firstName: z.string().max(120).optional(),
  lastName: z.string().max(120).optional(),
  unsubscribed: z.boolean().optional(),
  broadcastId: z.string().trim().max(120).optional(),
  webhookId: z.string().trim().max(120).optional(),
  endpoint: z.string().url().max(1000).optional(),
  events: z.array(z.string().trim().min(1).max(80)).max(25).optional(),
  webhookStatus: z.enum(["enabled", "disabled"]).optional(),
});

export type CloudToolResult = {
  output: string;
  summary: string;
  secretsUpdated?: boolean;
};

async function resolveDefaultBranchId(neonProjectId: string, explicitBranchId?: string) {
  if (explicitBranchId) return explicitBranchId;
  const branches = await listNeonBranches(neonProjectId);
  const primary = branches.find((b) => b.default || b.primary) ?? branches[0];
  if (!primary) throw new Error("No branches exist on this Neon project.");
  return primary.id;
}

export async function executeCloudProviderTool(
  project: Project,
  name: CloudProviderToolName,
  rawInput: unknown,
  cloudEnabled: boolean,
): Promise<CloudToolResult> {
  if (!cloudEnabled) {
    return {
      output: JSON.stringify({
        error: "Cognix Cloud is off for this project. Call request_cognix_cloud first and wait for the user to enable it.",
      }),
      summary: "Cognix Cloud is off",
    };
  }

  if (name === "neon_database") {
    const input = neonInputSchema.parse(rawInput);

    if (input.action === "status") {
      const overview = await getProjectNeonOverview(project);
      return {
        output: JSON.stringify(overview),
        summary: overview.provisioned
          ? `Checked Neon database (${overview.tables.length} ${overview.tables.length === 1 ? "table" : "tables"})`
          : "Checked Neon database status",
      };
    }

    if (!isNeonApiConfigured() && input.action !== "run_sql") {
      return {
        output: JSON.stringify({
          error:
            "NEON_API_KEY is not configured on the Cognix server yet. Ask the operator/user to add NEON_API_KEY to the server .env, or set DATABASE_URL in Cloud → Secrets.",
        }),
        summary: "Needs attention: NEON_API_KEY not set on server",
      };
    }

    if (input.action === "provision") {
      const result = await ensureProjectNeonDatabase(project, { regionId: input.regionId });
      return {
        output: JSON.stringify({
          ok: true,
          ...result,
          envSynced: ["DATABASE_URL", "DIRECT_URL"],
        }),
        summary: result.created
          ? `Provisioned Neon database (${result.neonRegion})`
          : `Verified Neon database (${result.neonRegion})`,
        secretsUpdated: true,
      };
    }

    let cloud = await getProjectCloud(project.id);
    if (!cloud?.neonProjectId && isNeonApiConfigured()) {
      await ensureProjectNeonDatabase(project, { regionId: input.regionId });
      cloud = await getProjectCloud(project.id);
    }

    if (input.action === "run_sql") {
      if (!input.sql) throw new Error("Provide `sql` when action is run_sql.");
      const secrets = await getDecryptedSecrets(project.id);
      let connectionUrl = secrets.DATABASE_URL;
      if (input.branchId && cloud?.neonProjectId && isNeonApiConfigured()) {
        const databases = await listNeonDatabases(cloud.neonProjectId, input.branchId);
        const roles = await listNeonRoles(cloud.neonProjectId, input.branchId);
        const dbName = input.databaseName ?? databases[0]?.name ?? "neondb";
        const roleName = input.roleName ?? roles[0]?.name;
        if (roleName) {
          connectionUrl = await getNeonConnectionUri(cloud.neonProjectId, {
            branchId: input.branchId,
            databaseName: dbName,
            roleName,
            pooled: true,
          });
        }
      }
      if (!connectionUrl) {
        throw new Error("DATABASE_URL is not set yet. Call neon_database with action='provision' first.");
      }
      const res = await executeProjectSql(connectionUrl, input.sql, input.params ?? []);
      return {
        output: scrubConnectionCredentials(JSON.stringify(res)),
        summary: `Ran SQL on Neon (${res.command ?? "query"}, ${res.rowCount} rows)`,
      };
    }

    const neonProjectId = cloud?.neonProjectId;
    if (!neonProjectId) {
      throw new Error("No managed Neon database is provisioned for this project yet. Call action='provision' first.");
    }

    switch (input.action) {
      case "inspect_schema": {
        const branchId = await resolveDefaultBranchId(neonProjectId, input.branchId);
        const ddl = await getNeonBranchSchema(neonProjectId, branchId, input.databaseName ?? "neondb");
        const overview = await getProjectNeonOverview(project);
        return {
          output: JSON.stringify({ branchId, tables: overview.tables, ddl }),
          summary: `Inspected Neon schema (${overview.tables.length} tables)`,
        };
      }
      case "compare_schema": {
        if (!input.baseBranchId) throw new Error("Provide `baseBranchId` for compare_schema.");
        const branchId = await resolveDefaultBranchId(neonProjectId, input.branchId);
        const diff = await compareNeonBranchSchema(neonProjectId, branchId, {
          baseBranchId: input.baseBranchId,
          dbName: input.databaseName,
        });
        return {
          output: JSON.stringify({ branchId, baseBranchId: input.baseBranchId, diff }),
          summary: "Compared Neon branch schemas",
        };
      }
      case "list_branches": {
        const branches = await listNeonBranches(neonProjectId);
        return { output: JSON.stringify({ branches }), summary: `Listed ${branches.length} Neon branches` };
      }
      case "create_branch": {
        if (!input.name) throw new Error("Provide `name` for create_branch.");
        const res = await createNeonBranch(neonProjectId, {
          name: input.name,
          parentId: input.branchId,
          parentTimestamp: input.timestamp,
          parentLsn: input.lsn,
          endpointType: input.endpointType,
        });
        return { output: JSON.stringify(res), summary: `Created Neon branch ${res.branch.name}` };
      }
      case "rename_branch": {
        if (!input.branchId || !input.name) throw new Error("Provide `branchId` and `name` for rename_branch.");
        const branch = await renameNeonBranch(neonProjectId, input.branchId, input.name);
        return { output: JSON.stringify({ branch }), summary: `Renamed Neon branch to ${branch.name}` };
      }
      case "set_default_branch": {
        if (!input.branchId) throw new Error("Provide `branchId` for set_default_branch.");
        const branch = await setDefaultNeonBranch(neonProjectId, input.branchId);
        const synced = await syncNeonConnectionSecrets(project, neonProjectId, { branchId: branch.id });
        return {
          output: JSON.stringify({ branch, activeConnection: synced }),
          summary: `Set ${branch.name} as default Neon branch`,
          secretsUpdated: true,
        };
      }
      case "restore_branch": {
        if (!input.branchId || !input.baseBranchId) {
          throw new Error("Provide `branchId` (target) and `baseBranchId` (source) for restore_branch.");
        }
        const branch = await restoreNeonBranch(neonProjectId, input.branchId, {
          sourceBranchId: input.baseBranchId,
          sourceTimestamp: input.timestamp,
          sourceLsn: input.lsn,
          preserveUnderName: input.name,
        });
        return { output: JSON.stringify({ branch }), summary: `Restored Neon branch ${branch.name}` };
      }
      case "delete_branch": {
        if (!input.branchId) throw new Error("Provide `branchId` for delete_branch.");
        const res = await deleteNeonBranch(neonProjectId, input.branchId);
        return { output: JSON.stringify(res), summary: "Deleted Neon branch" };
      }
      case "list_databases": {
        const branchId = await resolveDefaultBranchId(neonProjectId, input.branchId);
        const databases = await listNeonDatabases(neonProjectId, branchId);
        return { output: JSON.stringify({ branchId, databases }), summary: `Listed ${databases.length} Neon databases` };
      }
      case "create_database": {
        if (!input.name) throw new Error("Provide `name` for create_database.");
        const branchId = await resolveDefaultBranchId(neonProjectId, input.branchId);
        const roles = await listNeonRoles(neonProjectId, branchId);
        const ownerName = input.roleName ?? roles.find((r) => !r.protected)?.name ?? roles[0]?.name;
        if (!ownerName) throw new Error("No owner role available on this branch.");
        const database = await createNeonDatabase(neonProjectId, branchId, { name: input.name, ownerName });
        return { output: JSON.stringify({ database }), summary: `Created database ${database.name}` };
      }
      case "update_database": {
        if (!input.databaseName) throw new Error("Provide `databaseName` for update_database.");
        const branchId = await resolveDefaultBranchId(neonProjectId, input.branchId);
        const database = await updateNeonDatabase(neonProjectId, branchId, input.databaseName, {
          newName: input.newName,
          ownerName: input.roleName,
        });
        return { output: JSON.stringify({ database }), summary: `Updated database ${database.name}` };
      }
      case "delete_database": {
        if (!input.databaseName) throw new Error("Provide `databaseName` for delete_database.");
        const branchId = await resolveDefaultBranchId(neonProjectId, input.branchId);
        const res = await deleteNeonDatabase(neonProjectId, branchId, input.databaseName);
        return { output: JSON.stringify(res), summary: `Deleted database ${input.databaseName}` };
      }
      case "list_roles": {
        const branchId = await resolveDefaultBranchId(neonProjectId, input.branchId);
        const roles = await listNeonRoles(neonProjectId, branchId);
        return { output: JSON.stringify({ branchId, roles }), summary: `Listed ${roles.length} Postgres roles` };
      }
      case "create_role": {
        if (!input.name) throw new Error("Provide `name` for create_role.");
        const branchId = await resolveDefaultBranchId(neonProjectId, input.branchId);
        const role = await createNeonRole(neonProjectId, branchId, { name: input.name });
        return {
          output: JSON.stringify({ role: { name: role.name, branch_id: role.branch_id } }),
          summary: `Created Postgres role ${role.name}`,
        };
      }
      case "reset_role_password": {
        if (!input.roleName) throw new Error("Provide `roleName` for reset_role_password.");
        const branchId = await resolveDefaultBranchId(neonProjectId, input.branchId);
        const role = await resetNeonRolePassword(neonProjectId, branchId, input.roleName);
        const synced = await syncNeonConnectionSecrets(project, neonProjectId, { branchId, roleName: role.name });
        return {
          output: JSON.stringify({ reset: true, role: role.name, activeConnection: synced }),
          summary: `Rotated password for role ${role.name} and synced .env.local`,
          secretsUpdated: true,
        };
      }
      case "delete_role": {
        if (!input.roleName) throw new Error("Provide `roleName` for delete_role.");
        const branchId = await resolveDefaultBranchId(neonProjectId, input.branchId);
        const res = await deleteNeonRole(neonProjectId, branchId, input.roleName);
        return { output: JSON.stringify(res), summary: `Deleted Postgres role ${input.roleName}` };
      }
      case "list_endpoints": {
        const endpoints = await listNeonEndpoints(neonProjectId);
        return { output: JSON.stringify({ endpoints }), summary: `Listed ${endpoints.length} compute endpoints` };
      }
      case "create_endpoint": {
        const branchId = await resolveDefaultBranchId(neonProjectId, input.branchId);
        const endpoint = await createNeonEndpoint(neonProjectId, {
          branchId,
          type: input.endpointType ?? "read_only",
          minCu: input.minCu,
          maxCu: input.maxCu,
          suspendTimeoutSeconds: input.suspendTimeoutSeconds,
        });
        return { output: JSON.stringify({ endpoint }), summary: `Created ${endpoint.type} compute endpoint` };
      }
      case "update_endpoint": {
        if (!input.endpointId) throw new Error("Provide `endpointId` for update_endpoint.");
        const endpoint = await updateNeonEndpoint(neonProjectId, input.endpointId, {
          minCu: input.minCu,
          maxCu: input.maxCu,
          suspendTimeoutSeconds: input.suspendTimeoutSeconds,
        });
        return { output: JSON.stringify({ endpoint }), summary: `Updated compute endpoint ${endpoint.id}` };
      }
      case "start_endpoint": {
        if (!input.endpointId) throw new Error("Provide `endpointId` for start_endpoint.");
        const res = await startNeonEndpoint(neonProjectId, input.endpointId);
        return { output: JSON.stringify(res), summary: `Started compute endpoint ${input.endpointId}` };
      }
      case "suspend_endpoint": {
        if (!input.endpointId) throw new Error("Provide `endpointId` for suspend_endpoint.");
        const res = await suspendNeonEndpoint(neonProjectId, input.endpointId);
        return { output: JSON.stringify(res), summary: `Suspended compute endpoint ${input.endpointId}` };
      }
      case "restart_endpoint": {
        if (!input.endpointId) throw new Error("Provide `endpointId` for restart_endpoint.");
        const res = await restartNeonEndpoint(neonProjectId, input.endpointId);
        return { output: JSON.stringify(res), summary: `Restarted compute endpoint ${input.endpointId}` };
      }
      case "delete_endpoint": {
        if (!input.endpointId) throw new Error("Provide `endpointId` for delete_endpoint.");
        const res = await deleteNeonEndpoint(neonProjectId, input.endpointId);
        return { output: JSON.stringify(res), summary: `Deleted compute endpoint ${input.endpointId}` };
      }
      case "list_snapshots": {
        const snapshots = await listNeonSnapshots(neonProjectId);
        return { output: JSON.stringify({ snapshots }), summary: `Listed ${snapshots.length} Neon snapshots` };
      }
      case "create_snapshot": {
        const branchId = await resolveDefaultBranchId(neonProjectId, input.branchId);
        const snapshot = await createNeonSnapshot(neonProjectId, branchId, { name: input.name });
        return { output: JSON.stringify({ snapshot }), summary: `Created Neon snapshot ${snapshot.name || snapshot.id}` };
      }
      case "restore_snapshot": {
        if (!input.snapshotId) throw new Error("Provide `snapshotId` for restore_snapshot.");
        const res = await restoreNeonSnapshot(neonProjectId, input.snapshotId, {
          name: input.name,
          targetBranchId: input.branchId,
          finalizeRestore: true,
        });
        return { output: JSON.stringify(res), summary: `Restored Neon snapshot ${input.snapshotId}` };
      }
      case "delete_snapshot": {
        if (!input.snapshotId) throw new Error("Provide `snapshotId` for delete_snapshot.");
        const res = await deleteNeonSnapshot(neonProjectId, input.snapshotId);
        return { output: JSON.stringify(res), summary: `Deleted Neon snapshot ${input.snapshotId}` };
      }
      case "update_project_settings": {
        const updated = await updateNeonProject(neonProjectId, {
          name: input.name,
          historyRetentionSeconds: input.historyRetentionSeconds,
          minCu: input.minCu,
          maxCu: input.maxCu,
          suspendTimeoutSeconds: input.suspendTimeoutSeconds,
        });
        return { output: JSON.stringify({ project: updated }), summary: "Updated Neon project settings" };
      }
      case "use_connection": {
        const synced = await syncNeonConnectionSecrets(project, neonProjectId, {
          branchId: input.branchId,
          databaseName: input.databaseName,
          roleName: input.roleName,
        });
        return {
          output: JSON.stringify({ ok: true, activeConnection: synced, envSynced: ["DATABASE_URL", "DIRECT_URL"] }),
          summary: `Synced Neon branch ${synced.branchName} (${synced.databaseName}) to .env.local`,
          secretsUpdated: true,
        };
      }
    }
  }

  // resend_email tool
  const input = resendInputSchema.parse(rawInput);
  const secrets = await getDecryptedSecrets(project.id);
  const apiKey = secrets.RESEND_API_KEY?.trim();
  const currentFrom = secrets.EMAIL_FROM?.trim() || null;

  if (!apiKey) {
    return {
      output: JSON.stringify({
        connected: false,
        emailFrom: currentFrom,
        error:
          "Resend is not connected yet. Ask the user to connect their Resend API key in Cloud → Emails (or write code against process.env.RESEND_API_KEY and process.env.EMAIL_FROM with a graceful fallback).",
      }),
      summary: "Resend API key not connected yet",
    };
  }

  switch (input.action) {
    case "status": {
      const [domains, audiences, webhooks, apiKeys] = await Promise.all([
        listResendDomains(apiKey).catch(() => []),
        listResendAudiences(apiKey).catch(() => []),
        listResendWebhooks(apiKey).catch(() => []),
        listResendApiKeys(apiKey).catch(() => []),
      ]);
      return {
        output: scrubResendKey(
          JSON.stringify({
            connected: true,
            emailFrom: currentFrom,
            domains,
            audiencesCount: audiences.length,
            webhooksCount: webhooks.length,
            apiKeysCount: apiKeys.length,
          }),
        ),
        summary: `Checked Resend account (${domains.length} ${domains.length === 1 ? "domain" : "domains"})`,
      };
    }
    case "set_default_from": {
      if (!input.from) throw new Error("Provide `from` when setting the default sender.");
      await upsertSecret(project.id, "EMAIL_FROM", input.from, "user");
      if (project.sandboxId) await syncProjectEnv(project).catch(() => undefined);
      return {
        output: JSON.stringify({ ok: true, emailFrom: input.from }),
        summary: `Set EMAIL_FROM to ${input.from}`,
        secretsUpdated: true,
      };
    }
    case "list_domains": {
      const domains = await listResendDomains(apiKey);
      return { output: JSON.stringify({ domains }), summary: `Listed ${domains.length} Resend domains` };
    }
    case "get_domain": {
      if (!input.domainId) throw new Error("Provide `domainId` for get_domain.");
      const domain = await getResendDomain(apiKey, input.domainId);
      return { output: JSON.stringify({ domain }), summary: `Read Resend domain ${domain.name}` };
    }
    case "create_domain": {
      if (!input.name) throw new Error("Provide `name` for create_domain.");
      const domain = await createResendDomain(apiKey, { name: input.name, region: input.region });
      return { output: JSON.stringify({ domain }), summary: `Added Resend domain ${domain.name}` };
    }
    case "verify_domain": {
      if (!input.domainId) throw new Error("Provide `domainId` for verify_domain.");
      const res = await verifyResendDomain(apiKey, input.domainId);
      return { output: JSON.stringify(res), summary: "Triggered Resend domain verification" };
    }
    case "update_domain": {
      if (!input.domainId) throw new Error("Provide `domainId` for update_domain.");
      const res = await updateResendDomain(apiKey, input.domainId, {
        openTracking: input.openTracking,
        clickTracking: input.clickTracking,
        tls: input.tls,
      });
      return { output: JSON.stringify(res), summary: "Updated Resend domain settings" };
    }
    case "delete_domain": {
      if (!input.domainId) throw new Error("Provide `domainId` for delete_domain.");
      const res = await deleteResendDomain(apiKey, input.domainId);
      return { output: JSON.stringify(res), summary: "Removed Resend domain" };
    }
    case "send_email": {
      const from = input.from ?? currentFrom;
      if (!from || !input.to || !input.subject) {
        throw new Error("Provide `to`, `subject`, and `from` (or configure EMAIL_FROM) for send_email.");
      }
      if (!input.text && !input.html) throw new Error("Provide `text` or `html` body for send_email.");
      const res = await sendResendEmail(apiKey, {
        from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
        replyTo: input.replyTo,
        scheduledAt: input.scheduledAt,
      });
      return { output: JSON.stringify(res), summary: `Sent email via Resend (${res.id})` };
    }
    case "send_batch_emails": {
      if (!input.emails?.length) throw new Error("Provide `emails` array for send_batch_emails.");
      const res = await sendResendBatchEmails(apiKey, input.emails);
      return { output: JSON.stringify(res), summary: `Sent ${input.emails.length} batch emails via Resend` };
    }
    case "list_emails": {
      const emails = await listResendEmails(apiKey);
      return { output: JSON.stringify({ emails }), summary: `Listed ${emails.length} recent Resend emails` };
    }
    case "get_email": {
      if (!input.emailId) throw new Error("Provide `emailId` for get_email.");
      const email = await getResendEmail(apiKey, input.emailId);
      return { output: JSON.stringify({ email }), summary: `Checked Resend email ${email.id}` };
    }
    case "update_email": {
      if (!input.emailId || !input.scheduledAt) {
        throw new Error("Provide `emailId` and `scheduledAt` for update_email.");
      }
      const res = await updateResendEmail(apiKey, input.emailId, input.scheduledAt);
      return { output: JSON.stringify(res), summary: `Rescheduled email ${input.emailId}` };
    }
    case "cancel_email": {
      if (!input.emailId) throw new Error("Provide `emailId` for cancel_email.");
      const res = await cancelResendEmail(apiKey, input.emailId);
      return { output: JSON.stringify(res), summary: `Cancelled scheduled email ${input.emailId}` };
    }
    case "list_audiences": {
      const audiences = await listResendAudiences(apiKey);
      return { output: JSON.stringify({ audiences }), summary: `Listed ${audiences.length} Resend audiences` };
    }
    case "get_audience": {
      if (!input.audienceId) throw new Error("Provide `audienceId` for get_audience.");
      const audience = await getResendAudience(apiKey, input.audienceId);
      return { output: JSON.stringify({ audience }), summary: `Read Resend audience ${audience.name}` };
    }
    case "create_audience": {
      if (!input.name) throw new Error("Provide `name` for create_audience.");
      const audience = await createResendAudience(apiKey, input.name);
      return { output: JSON.stringify({ audience }), summary: `Created Resend audience ${audience.name}` };
    }
    case "delete_audience": {
      if (!input.audienceId) throw new Error("Provide `audienceId` for delete_audience.");
      const res = await deleteResendAudience(apiKey, input.audienceId);
      return { output: JSON.stringify(res), summary: "Deleted Resend audience" };
    }
    case "list_contacts": {
      if (!input.audienceId) throw new Error("Provide `audienceId` for list_contacts.");
      const contacts = await listResendContacts(apiKey, input.audienceId);
      return { output: JSON.stringify({ contacts }), summary: `Listed ${contacts.length} audience contacts` };
    }
    case "get_contact": {
      if (!input.audienceId || !input.contactId) {
        throw new Error("Provide `audienceId` and `contactId` for get_contact.");
      }
      const contact = await getResendContact(apiKey, input.audienceId, input.contactId);
      return { output: JSON.stringify({ contact }), summary: `Read contact ${contact.email}` };
    }
    case "create_contact": {
      if (!input.audienceId || !input.email) {
        throw new Error("Provide `audienceId` and `email` for create_contact.");
      }
      const res = await createResendContact(apiKey, input.audienceId, {
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        unsubscribed: input.unsubscribed,
      });
      return { output: JSON.stringify(res), summary: `Added ${input.email} to Resend audience` };
    }
    case "update_contact": {
      if (!input.audienceId || !input.contactId) {
        throw new Error("Provide `audienceId` and `contactId` for update_contact.");
      }
      const res = await updateResendContact(apiKey, input.audienceId, input.contactId, {
        firstName: input.firstName,
        lastName: input.lastName,
        unsubscribed: input.unsubscribed,
      });
      return { output: JSON.stringify(res), summary: "Updated Resend contact" };
    }
    case "delete_contact": {
      if (!input.audienceId || !input.contactId) {
        throw new Error("Provide `audienceId` and `contactId` for delete_contact.");
      }
      const res = await deleteResendContact(apiKey, input.audienceId, input.contactId);
      return { output: JSON.stringify(res), summary: "Deleted Resend contact" };
    }
    case "list_broadcasts": {
      const broadcasts = await listResendBroadcasts(apiKey);
      return { output: JSON.stringify({ broadcasts }), summary: `Listed ${broadcasts.length} Resend broadcasts` };
    }
    case "get_broadcast": {
      if (!input.broadcastId) throw new Error("Provide `broadcastId` for get_broadcast.");
      const broadcast = await getResendBroadcast(apiKey, input.broadcastId);
      return { output: JSON.stringify({ broadcast }), summary: `Read Resend broadcast ${broadcast.id}` };
    }
    case "create_broadcast": {
      const from = input.from ?? currentFrom;
      if (!input.audienceId || !from || !input.subject) {
        throw new Error("Provide `audienceId`, `subject`, and `from` (or EMAIL_FROM) for create_broadcast.");
      }
      const res = await createResendBroadcast(apiKey, {
        name: input.name,
        audienceId: input.audienceId,
        from,
        subject: input.subject,
        html: input.html,
        text: input.text,
        replyTo: input.replyTo,
      });
      return { output: JSON.stringify(res), summary: `Created Resend broadcast (${res.id})` };
    }
    case "send_broadcast": {
      if (!input.broadcastId) throw new Error("Provide `broadcastId` for send_broadcast.");
      const res = await sendResendBroadcast(apiKey, input.broadcastId, input.scheduledAt);
      return { output: JSON.stringify(res), summary: `Scheduled/sent Resend broadcast ${input.broadcastId}` };
    }
    case "delete_broadcast": {
      if (!input.broadcastId) throw new Error("Provide `broadcastId` for delete_broadcast.");
      const res = await deleteResendBroadcast(apiKey, input.broadcastId);
      return { output: JSON.stringify(res), summary: "Deleted Resend broadcast" };
    }
    case "list_webhooks": {
      const webhooks = await listResendWebhooks(apiKey);
      return { output: JSON.stringify({ webhooks }), summary: `Listed ${webhooks.length} Resend webhooks` };
    }
    case "get_webhook": {
      if (!input.webhookId) throw new Error("Provide `webhookId` for get_webhook.");
      const webhook = await getResendWebhook(apiKey, input.webhookId);
      return { output: JSON.stringify({ webhook }), summary: `Read Resend webhook ${webhook.id}` };
    }
    case "create_webhook": {
      if (!input.endpoint || !input.events?.length) {
        throw new Error("Provide `endpoint` and `events` for create_webhook.");
      }
      const res = await createResendWebhook(apiKey, { endpoint: input.endpoint, events: input.events });
      return {
        output: JSON.stringify({ id: res.id, endpoint: input.endpoint, events: input.events }),
        summary: `Created Resend webhook for ${input.endpoint}`,
      };
    }
    case "update_webhook": {
      if (!input.webhookId) throw new Error("Provide `webhookId` for update_webhook.");
      const res = await updateResendWebhook(apiKey, input.webhookId, {
        endpoint: input.endpoint,
        events: input.events,
        status: input.webhookStatus,
      });
      return { output: JSON.stringify(res), summary: `Updated Resend webhook ${input.webhookId}` };
    }
    case "delete_webhook": {
      if (!input.webhookId) throw new Error("Provide `webhookId` for delete_webhook.");
      const res = await deleteResendWebhook(apiKey, input.webhookId);
      return { output: JSON.stringify(res), summary: "Deleted Resend webhook" };
    }
    case "list_api_keys": {
      const apiKeys = await listResendApiKeys(apiKey);
      return { output: JSON.stringify({ apiKeys }), summary: `Listed ${apiKeys.length} Resend API keys` };
    }
  }
}
