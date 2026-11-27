import { neon } from "@neondatabase/serverless";
import { syncProjectEnv } from "@/lib/daytona";
import { isSecretsEncryptionConfigured } from "@/lib/secrets-crypto";
import { getDecryptedSecrets, getProjectCloud, updateProjectCloud, upsertSecret } from "@/lib/store";
import type { Project } from "@/lib/types";
import { publishSlugFromTitle } from "@/lib/utils";

const NEON_API_BASE = "https://console.neon.tech/api/v2";
const NEON_TIMEOUT_MS = 25_000;
const SQL_TIMEOUT_MS = 15_000;
const MAX_SQL_ROWS = 200;

export class NeonApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status = 500, code?: string) {
    super(scrubConnectionCredentials(message));
    this.name = "NeonApiError";
    this.status = status;
    this.code = code;
  }
}

export function scrubConnectionCredentials(text: string) {
  return text.replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, "postgresql://[REDACTED]");
}

export function isNeonApiConfigured(env: Record<string, string | undefined> = process.env) {
  return Boolean(env.NEON_API_KEY?.trim());
}

export function defaultNeonRegion(env: Record<string, string | undefined> = process.env) {
  return env.NEON_DEFAULT_REGION?.trim() || "aws-us-east-1";
}

export function defaultNeonPgVersion(env: Record<string, string | undefined> = process.env) {
  const parsed = Number(env.NEON_DEFAULT_PG_VERSION?.trim() || "17");
  return Number.isInteger(parsed) && parsed >= 14 && parsed <= 18 ? parsed : 17;
}

function getNeonApiKey() {
  const key = process.env.NEON_API_KEY?.trim();
  if (!key) {
    throw new NeonApiError(
      "Cognix Cloud Database provisioning is not configured on this server.",
      503,
      "NEON_NOT_CONFIGURED",
    );
  }
  return key;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls the Neon REST API v2 with automatic retry on HTTP 423 (project locked by an in-flight operation)
 * and HTTP 429 rate limits.
 */
async function neonRequest<T>(
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string | number | boolean | undefined> } = {},
): Promise<T> {
  const apiKey = getNeonApiKey();
  const url = new URL(`${NEON_API_BASE}${path}`);
  if (init.query) {
    for (const [key, value] of Object.entries(init.query)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
  }

  const maxAttempts = 6;
  const backoffMs = [500, 1100, 1800, 2800, 4200];

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(url, {
      method: init.method ?? "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(NEON_TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: "application/json",
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

    if ((response.status === 423 || response.status === 429) && attempt < maxAttempts - 1) {
      const retryAfterHeader = Number(response.headers.get("retry-after") || "0");
      const waitMs = retryAfterHeader > 0 ? Math.min(retryAfterHeader * 1000, 6000) : backoffMs[attempt] ?? 3000;
      await response.body?.cancel().catch(() => undefined);
      await sleep(waitMs);
      continue;
    }

    if (response.status === 204) return {} as T;
    const text = await response.text().catch(() => "");
    let payload: Record<string, unknown> = {};
    if (text) {
      try {
        payload = JSON.parse(text) as Record<string, unknown>;
      } catch {
        payload = {};
      }
    }

    if (!response.ok) {
      const message =
        typeof payload.message === "string"
          ? payload.message
          : `Cloud Database API error (HTTP ${response.status}).`;
      const code = typeof payload.code === "string" ? payload.code : undefined;
      throw new NeonApiError(message, response.status, code);
    }

    return payload as T;
  }

  throw new NeonApiError("Cloud Database is busy completing another operation. Try again in a few seconds.", 423);
}

export type NeonProjectSummary = {
  id: string;
  name: string;
  region_id: string;
  pg_version: number;
  created_at: string;
  updated_at: string;
  history_retention_seconds?: number;
  synthetic_storage_size?: number;
  compute_time_seconds?: number;
  active_time_seconds?: number;
};

export type NeonBranch = {
  id: string;
  project_id: string;
  parent_id?: string;
  parent_lsn?: string;
  parent_timestamp?: string;
  name: string;
  current_state: string;
  logical_size?: number;
  primary?: boolean;
  default?: boolean;
  protected?: boolean;
  created_at: string;
  updated_at: string;
};

export type NeonEndpoint = {
  id: string;
  host: string;
  project_id: string;
  branch_id: string;
  type: "read_write" | "read_only";
  current_state: string;
  autoscaling_limit_min_cu: number;
  autoscaling_limit_max_cu: number;
  suspend_timeout_seconds: number;
  pooler_enabled?: boolean;
  created_at: string;
  updated_at: string;
};

export type NeonDatabase = {
  id: number;
  branch_id: string;
  name: string;
  owner_name: string;
  created_at: string;
  updated_at: string;
};

export type NeonRole = {
  branch_id: string;
  name: string;
  protected?: boolean;
  created_at: string;
  updated_at: string;
};

export type NeonSnapshot = {
  id: string;
  name: string;
  lsn?: string;
  timestamp?: string;
  source_branch_id?: string;
  created_at: string;
  expires_at?: string;
};

export type NeonOperation = {
  id: string;
  action: string;
  status: string;
  branch_id?: string;
  endpoint_id?: string;
  error?: string;
  created_at: string;
  updated_at: string;
};

export type IntrospectedColumn = {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
};

export type IntrospectedTable = {
  schema: string;
  name: string;
  estimatedRows: number;
  columns: IntrospectedColumn[];
};

type CreateNeonProjectResponse = {
  project: NeonProjectSummary;
  connection_uris?: { connection_uri: string; connection_parameters?: { database?: string; role?: string; host?: string; pooler_host?: string } }[];
  branches?: NeonBranch[];
  databases?: NeonDatabase[];
  roles?: NeonRole[];
  endpoints?: NeonEndpoint[];
};

export async function createNeonProject(input: {
  name: string;
  regionId?: string;
  pgVersion?: number;
  historyRetentionSeconds?: number;
}) {
  const orgId = process.env.NEON_ORG_ID?.trim() || undefined;
  return neonRequest<CreateNeonProjectResponse>("/projects", {
    method: "POST",
    body: {
      project: {
        name: input.name.slice(0, 64),
        region_id: input.regionId || defaultNeonRegion(),
        pg_version: input.pgVersion || defaultNeonPgVersion(),
        ...(orgId ? { org_id: orgId } : {}),
        ...(input.historyRetentionSeconds !== undefined
          ? { history_retention_seconds: input.historyRetentionSeconds }
          : {}),
      },
    },
  });
}

export async function getNeonProject(neonProjectId: string) {
  const res = await neonRequest<{ project: NeonProjectSummary }>(
    `/projects/${encodeURIComponent(neonProjectId)}`,
  );
  return res.project;
}

export async function updateNeonProject(
  neonProjectId: string,
  patch: {
    name?: string;
    historyRetentionSeconds?: number;
    minCu?: number;
    maxCu?: number;
    suspendTimeoutSeconds?: number;
  },
) {
  const defaultEndpointSettings =
    patch.minCu !== undefined || patch.maxCu !== undefined || patch.suspendTimeoutSeconds !== undefined
      ? {
          ...(patch.minCu !== undefined ? { autoscaling_limit_min_cu: patch.minCu } : {}),
          ...(patch.maxCu !== undefined ? { autoscaling_limit_max_cu: patch.maxCu } : {}),
          ...(patch.suspendTimeoutSeconds !== undefined
            ? { suspend_timeout_seconds: patch.suspendTimeoutSeconds }
            : {}),
        }
      : undefined;

  const res = await neonRequest<{ project: NeonProjectSummary }>(
    `/projects/${encodeURIComponent(neonProjectId)}`,
    {
      method: "PATCH",
      body: {
        project: {
          ...(patch.name ? { name: patch.name.slice(0, 64) } : {}),
          ...(patch.historyRetentionSeconds !== undefined
            ? { history_retention_seconds: patch.historyRetentionSeconds }
            : {}),
          ...(defaultEndpointSettings ? { default_endpoint_settings: defaultEndpointSettings } : {}),
        },
      },
    },
  );
  return res.project;
}

export async function deleteNeonProject(neonProjectId: string) {
  try {
    await neonRequest(`/projects/${encodeURIComponent(neonProjectId)}`, { method: "DELETE" });
    return true;
  } catch (error) {
    if (error instanceof NeonApiError && error.status === 404) return false;
    throw error;
  }
}

export async function listNeonBranches(neonProjectId: string) {
  const res = await neonRequest<{ branches: NeonBranch[] }>(
    `/projects/${encodeURIComponent(neonProjectId)}/branches`,
  );
  return res.branches ?? [];
}

export async function getNeonBranch(neonProjectId: string, branchId: string) {
  const res = await neonRequest<{ branch: NeonBranch }>(
    `/projects/${encodeURIComponent(neonProjectId)}/branches/${encodeURIComponent(branchId)}`,
  );
  return res.branch;
}

export async function createNeonBranch(
  neonProjectId: string,
  input: {
    name: string;
    parentId?: string;
    parentTimestamp?: string;
    parentLsn?: string;
    withEndpoint?: boolean;
    endpointType?: "read_write" | "read_only";
  },
) {
  const withEndpoint = input.withEndpoint !== false;
  return neonRequest<{ branch: NeonBranch; endpoints?: NeonEndpoint[] }>(
    `/projects/${encodeURIComponent(neonProjectId)}/branches`,
    {
      method: "POST",
      body: {
        branch: {
          name: input.name.slice(0, 64),
          ...(input.parentId ? { parent_id: input.parentId } : {}),
          ...(input.parentTimestamp ? { parent_timestamp: input.parentTimestamp } : {}),
          ...(input.parentLsn ? { parent_lsn: input.parentLsn } : {}),
        },
        ...(withEndpoint
          ? { endpoints: [{ type: input.endpointType ?? "read_write" }] }
          : {}),
      },
    },
  );
}

export async function renameNeonBranch(neonProjectId: string, branchId: string, name: string) {
  const res = await neonRequest<{ branch: NeonBranch }>(
    `/projects/${encodeURIComponent(neonProjectId)}/branches/${encodeURIComponent(branchId)}`,
    {
      method: "PATCH",
      body: { branch: { name: name.slice(0, 64) } },
    },
  );
  return res.branch;
}

export async function setDefaultNeonBranch(neonProjectId: string, branchId: string) {
  const res = await neonRequest<{ branch: NeonBranch }>(
    `/projects/${encodeURIComponent(neonProjectId)}/branches/${encodeURIComponent(branchId)}/set_as_default`,
    { method: "POST" },
  );
  return res.branch;
}

export async function restoreNeonBranch(
  neonProjectId: string,
  branchId: string,
  input: {
    sourceBranchId: string;
    sourceTimestamp?: string;
    sourceLsn?: string;
    preserveUnderName?: string;
  },
) {
  const res = await neonRequest<{ branch: NeonBranch }>(
    `/projects/${encodeURIComponent(neonProjectId)}/branches/${encodeURIComponent(branchId)}/restore`,
    {
      method: "POST",
      body: {
        source_branch_id: input.sourceBranchId,
        ...(input.sourceTimestamp ? { source_timestamp: input.sourceTimestamp } : {}),
        ...(input.sourceLsn ? { source_lsn: input.sourceLsn } : {}),
        ...(input.preserveUnderName ? { preserve_under_name: input.preserveUnderName } : {}),
      },
    },
  );
  return res.branch;
}

export async function getNeonBranchSchema(neonProjectId: string, branchId: string, dbName = "neondb") {
  const res = await neonRequest<{ sql?: string }>(
    `/projects/${encodeURIComponent(neonProjectId)}/branches/${encodeURIComponent(branchId)}/schema`,
    { query: { db_name: dbName } },
  );
  return res.sql ?? "";
}

export async function compareNeonBranchSchema(
  neonProjectId: string,
  branchId: string,
  input: { baseBranchId: string; dbName?: string },
) {
  const res = await neonRequest<{ diff?: string }>(
    `/projects/${encodeURIComponent(neonProjectId)}/branches/${encodeURIComponent(branchId)}/compare_schema`,
    { query: { base_branch_id: input.baseBranchId, db_name: input.dbName || "neondb" } },
  );
  return res.diff ?? "";
}

export async function deleteNeonBranch(neonProjectId: string, branchId: string) {
  const branches = await listNeonBranches(neonProjectId);
  const target = branches.find((item) => item.id === branchId);
  if (!target) throw new NeonApiError("Branch not found in this Neon project.", 404);
  if (target.default || target.primary) {
    throw new NeonApiError("Cannot delete the default branch. Set another branch as default first.", 409);
  }
  await neonRequest(
    `/projects/${encodeURIComponent(neonProjectId)}/branches/${encodeURIComponent(branchId)}`,
    { method: "DELETE" },
  );
  return { deleted: true, branchId };
}

export async function listNeonDatabases(neonProjectId: string, branchId: string) {
  const res = await neonRequest<{ databases: NeonDatabase[] }>(
    `/projects/${encodeURIComponent(neonProjectId)}/branches/${encodeURIComponent(branchId)}/databases`,
  );
  return res.databases ?? [];
}

export async function createNeonDatabase(
  neonProjectId: string,
  branchId: string,
  input: { name: string; ownerName: string },
) {
  const res = await neonRequest<{ database: NeonDatabase }>(
    `/projects/${encodeURIComponent(neonProjectId)}/branches/${encodeURIComponent(branchId)}/databases`,
    {
      method: "POST",
      body: { database: { name: input.name, owner_name: input.ownerName } },
    },
  );
  return res.database;
}

export async function updateNeonDatabase(
  neonProjectId: string,
  branchId: string,
  databaseName: string,
  input: { newName?: string; ownerName?: string },
) {
  const res = await neonRequest<{ database: NeonDatabase }>(
    `/projects/${encodeURIComponent(neonProjectId)}/branches/${encodeURIComponent(branchId)}/databases/${encodeURIComponent(databaseName)}`,
    {
      method: "PATCH",
      body: {
        database: {
          ...(input.newName ? { name: input.newName } : {}),
          ...(input.ownerName ? { owner_name: input.ownerName } : {}),
        },
      },
    },
  );
  return res.database;
}

export async function deleteNeonDatabase(neonProjectId: string, branchId: string, databaseName: string) {
  await neonRequest(
    `/projects/${encodeURIComponent(neonProjectId)}/branches/${encodeURIComponent(branchId)}/databases/${encodeURIComponent(databaseName)}`,
    { method: "DELETE" },
  );
  return { deleted: true, databaseName };
}

export async function listNeonRoles(neonProjectId: string, branchId: string) {
  const res = await neonRequest<{ roles: NeonRole[] }>(
    `/projects/${encodeURIComponent(neonProjectId)}/branches/${encodeURIComponent(branchId)}/roles`,
  );
  return res.roles ?? [];
}

export async function createNeonRole(
  neonProjectId: string,
  branchId: string,
  input: { name: string; noLogin?: boolean },
) {
  const res = await neonRequest<{ role: NeonRole }>(
    `/projects/${encodeURIComponent(neonProjectId)}/branches/${encodeURIComponent(branchId)}/roles`,
    {
      method: "POST",
      body: { role: { name: input.name, ...(input.noLogin ? { no_login: true } : {}) } },
    },
  );
  return res.role;
}

export async function deleteNeonRole(neonProjectId: string, branchId: string, roleName: string) {
  await neonRequest(
    `/projects/${encodeURIComponent(neonProjectId)}/branches/${encodeURIComponent(branchId)}/roles/${encodeURIComponent(roleName)}`,
    { method: "DELETE" },
  );
  return { deleted: true, roleName };
}

export async function resetNeonRolePassword(neonProjectId: string, branchId: string, roleName: string) {
  const res = await neonRequest<{ role: NeonRole }>(
    `/projects/${encodeURIComponent(neonProjectId)}/branches/${encodeURIComponent(branchId)}/roles/${encodeURIComponent(roleName)}/reset_password`,
    { method: "POST" },
  );
  return res.role;
}

export async function listNeonEndpoints(neonProjectId: string) {
  const res = await neonRequest<{ endpoints: NeonEndpoint[] }>(
    `/projects/${encodeURIComponent(neonProjectId)}/endpoints`,
  );
  return res.endpoints ?? [];
}

export async function createNeonEndpoint(
  neonProjectId: string,
  input: {
    branchId: string;
    type?: "read_write" | "read_only";
    minCu?: number;
    maxCu?: number;
    suspendTimeoutSeconds?: number;
  },
) {
  const res = await neonRequest<{ endpoint: NeonEndpoint }>(
    `/projects/${encodeURIComponent(neonProjectId)}/endpoints`,
    {
      method: "POST",
      body: {
        endpoint: {
          branch_id: input.branchId,
          type: input.type ?? "read_only",
          ...(input.minCu !== undefined ? { autoscaling_limit_min_cu: input.minCu } : {}),
          ...(input.maxCu !== undefined ? { autoscaling_limit_max_cu: input.maxCu } : {}),
          ...(input.suspendTimeoutSeconds !== undefined
            ? { suspend_timeout_seconds: input.suspendTimeoutSeconds }
            : {}),
        },
      },
    },
  );
  return res.endpoint;
}

export async function updateNeonEndpoint(
  neonProjectId: string,
  endpointId: string,
  input: { minCu?: number; maxCu?: number; suspendTimeoutSeconds?: number },
) {
  const res = await neonRequest<{ endpoint: NeonEndpoint }>(
    `/projects/${encodeURIComponent(neonProjectId)}/endpoints/${encodeURIComponent(endpointId)}`,
    {
      method: "PATCH",
      body: {
        endpoint: {
          ...(input.minCu !== undefined ? { autoscaling_limit_min_cu: input.minCu } : {}),
          ...(input.maxCu !== undefined ? { autoscaling_limit_max_cu: input.maxCu } : {}),
          ...(input.suspendTimeoutSeconds !== undefined
            ? { suspend_timeout_seconds: input.suspendTimeoutSeconds }
            : {}),
        },
      },
    },
  );
  return res.endpoint;
}

export async function startNeonEndpoint(neonProjectId: string, endpointId: string) {
  return neonRequest<{ endpoint: NeonEndpoint }>(
    `/projects/${encodeURIComponent(neonProjectId)}/endpoints/${encodeURIComponent(endpointId)}/start`,
    { method: "POST" },
  );
}

export async function suspendNeonEndpoint(neonProjectId: string, endpointId: string) {
  return neonRequest<{ endpoint: NeonEndpoint }>(
    `/projects/${encodeURIComponent(neonProjectId)}/endpoints/${encodeURIComponent(endpointId)}/suspend`,
    { method: "POST" },
  );
}

export async function restartNeonEndpoint(neonProjectId: string, endpointId: string) {
  return neonRequest<{ endpoint: NeonEndpoint }>(
    `/projects/${encodeURIComponent(neonProjectId)}/endpoints/${encodeURIComponent(endpointId)}/restart`,
    { method: "POST" },
  );
}

export async function deleteNeonEndpoint(neonProjectId: string, endpointId: string) {
  await neonRequest(
    `/projects/${encodeURIComponent(neonProjectId)}/endpoints/${encodeURIComponent(endpointId)}`,
    { method: "DELETE" },
  );
  return { deleted: true, endpointId };
}

export async function listNeonSnapshots(neonProjectId: string) {
  const res = await neonRequest<{ snapshots: NeonSnapshot[] }>(
    `/projects/${encodeURIComponent(neonProjectId)}/snapshots`,
  ).catch((error) => {
    // Some Neon plans/endpoints return 404 or empty if snapshots aren't initialized yet.
    if (error instanceof NeonApiError && error.status === 404) return { snapshots: [] as NeonSnapshot[] };
    throw error;
  });
  return res.snapshots ?? [];
}

export async function createNeonSnapshot(
  neonProjectId: string,
  branchId: string,
  input: { name?: string; expiresAt?: string } = {},
) {
  const res = await neonRequest<{ snapshot: NeonSnapshot }>(
    `/projects/${encodeURIComponent(neonProjectId)}/branches/${encodeURIComponent(branchId)}/snapshot`,
    {
      method: "POST",
      query: {
        name: input.name,
        expires_at: input.expiresAt,
      },
    },
  );
  return res.snapshot;
}

export async function restoreNeonSnapshot(
  neonProjectId: string,
  snapshotId: string,
  input: { name?: string; targetBranchId?: string; finalizeRestore?: boolean } = {},
) {
  return neonRequest<{ branch?: NeonBranch }>(
    `/projects/${encodeURIComponent(neonProjectId)}/snapshots/${encodeURIComponent(snapshotId)}/restore`,
    {
      method: "POST",
      body: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.targetBranchId ? { target_branch_id: input.targetBranchId } : {}),
        ...(input.finalizeRestore !== undefined ? { finalize_restore: input.finalizeRestore } : {}),
      },
    },
  );
}

export async function deleteNeonSnapshot(neonProjectId: string, snapshotId: string) {
  await neonRequest(
    `/projects/${encodeURIComponent(neonProjectId)}/snapshots/${encodeURIComponent(snapshotId)}`,
    { method: "DELETE" },
  );
  return { deleted: true, snapshotId };
}

export async function listNeonOperations(neonProjectId: string, limit = 12) {
  const res = await neonRequest<{ operations: NeonOperation[] }>(
    `/projects/${encodeURIComponent(neonProjectId)}/operations`,
    { query: { limit } },
  );
  return res.operations ?? [];
}

export async function getNeonConnectionUri(
  neonProjectId: string,
  options: { branchId?: string; databaseName: string; roleName: string; pooled?: boolean },
) {
  const res = await neonRequest<{ uri: string }>(
    `/projects/${encodeURIComponent(neonProjectId)}/connection_uri`,
    {
      query: {
        branch_id: options.branchId,
        database_name: options.databaseName,
        role_name: options.roleName,
        pooled: options.pooled ?? true,
      },
    },
  );
  return res.uri;
}

export function isNeonHttpCompatibleUrl(databaseUrl: string | undefined) {
  if (!databaseUrl) return false;
  try {
    const parsed = new URL(databaseUrl);
    return (
      (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") &&
      /neon\.tech$/i.test(parsed.hostname)
    );
  } catch {
    return false;
  }
}

export async function executeProjectSql(
  connectionUrl: string,
  queryText: string,
  params: unknown[] = [],
) {
  const trimmed = queryText.trim();
  if (!trimmed) throw new NeonApiError("Enter a SQL statement to execute.", 400);
  if (!isNeonHttpCompatibleUrl(connectionUrl)) {
    throw new NeonApiError(
      "Direct HTTP SQL execution requires a Neon PostgreSQL connection URL.",
      400,
    );
  }

  try {
    const sql = neon(connectionUrl, {
      fullResults: true,
      fetchOptions: { cache: "no-store", signal: AbortSignal.timeout(SQL_TIMEOUT_MS) },
    });
    const raw = (await sql.query(trimmed, params)) as {
      rows?: Record<string, unknown>[];
      rowCount?: number | null;
      fields?: { name: string }[];
      command?: string;
    };
    const allRows = Array.isArray(raw.rows) ? raw.rows : [];
    const truncated = allRows.length > MAX_SQL_ROWS;
    const rows = truncated ? allRows.slice(0, MAX_SQL_ROWS) : allRows;
    const columns = raw.fields?.map((field) => field.name) ?? (rows[0] ? Object.keys(rows[0]) : []);
    return {
      command: raw.command ?? null,
      rowCount: typeof raw.rowCount === "number" ? raw.rowCount : allRows.length,
      columns,
      rows,
      truncated,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "SQL query failed.";
    throw new NeonApiError(msg, 400);
  }
}

export async function inspectProjectTables(connectionUrl: string): Promise<IntrospectedTable[]> {
  if (!isNeonHttpCompatibleUrl(connectionUrl)) return [];
  try {
    const sql = neon(connectionUrl, {
      fetchOptions: { cache: "no-store", signal: AbortSignal.timeout(10_000) },
    });
    const [rawTables, rawColumns] = await Promise.all([
      sql.query(
        `SELECT schemaname AS schema, relname AS name, COALESCE(n_live_tup, 0)::bigint AS estimated_rows
         FROM pg_stat_user_tables
         WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'drizzle')
         ORDER BY schemaname, relname
         LIMIT 100`,
      ),
      sql.query(
        `SELECT table_schema AS schema, table_name AS table_name, column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'drizzle')
         ORDER BY table_schema, table_name, ordinal_position
         LIMIT 1500`,
      ),
    ]);
    const tableRows = rawTables as unknown as { schema: string; name: string; estimated_rows: string | number }[];
    const columnRows = rawColumns as unknown as {
      schema: string;
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }[];

    const columnsByKey = new Map<string, IntrospectedColumn[]>();
    for (const col of columnRows) {
      const key = `${col.schema}.${col.table_name}`;
      const list = columnsByKey.get(key) ?? [];
      list.push({
        name: col.column_name,
        dataType: col.data_type,
        nullable: col.is_nullable === "YES",
        defaultValue: col.column_default,
      });
      columnsByKey.set(key, list);
    }

    return tableRows.map((table) => ({
      schema: table.schema,
      name: table.name,
      estimatedRows: Math.max(0, Number(table.estimated_rows) || 0),
      columns: columnsByKey.get(`${table.schema}.${table.name}`) ?? [],
    }));
  } catch {
    return [];
  }
}

declare global {
  var __cognixNeonProvisionLocks: Map<string, Promise<ProvisionedNeonResult>> | undefined;
}

const provisionLocks =
  globalThis.__cognixNeonProvisionLocks ?? (globalThis.__cognixNeonProvisionLocks = new Map());

export type ProvisionedNeonResult = {
  neonProjectId: string;
  neonRegion: string;
  branchId: string;
  databaseName: string;
  roleName: string;
  host: string;
  created: boolean;
};

/**
 * Resolves and saves `DATABASE_URL` (pooled) and `DIRECT_URL` (direct) for a project's Neon database,
 * then syncs `.env.local` into the Daytona sandbox when one exists.
 */
export async function syncNeonConnectionSecrets(
  project: Project,
  neonProjectId: string,
  target: { branchId?: string; databaseName?: string; roleName?: string } = {},
) {
  if (!isSecretsEncryptionConfigured) {
    throw new NeonApiError(
      "Add COGNIX_SECRETS_KEY to the Cognix server before storing managed Neon database credentials.",
      503,
    );
  }

  const branches = await listNeonBranches(neonProjectId);
  const branch =
    (target.branchId ? branches.find((b) => b.id === target.branchId) : undefined) ??
    branches.find((b) => b.default || b.primary) ??
    branches[0];
  if (!branch) throw new NeonApiError("This Neon project has no branches available.", 409);

  const [databases, roles] = await Promise.all([
    listNeonDatabases(neonProjectId, branch.id),
    listNeonRoles(neonProjectId, branch.id),
  ]);

  const databaseName =
    target.databaseName ?? databases.find((d) => d.name === "neondb")?.name ?? databases[0]?.name;
  const roleName =
    target.roleName ??
    databases.find((d) => d.name === databaseName)?.owner_name ??
    roles.find((r) => !r.protected)?.name ??
    roles[0]?.name;

  if (!databaseName || !roleName) {
    throw new NeonApiError("Neon branch is missing a database or role.", 409);
  }

  const [pooledUri, directUri] = await Promise.all([
    getNeonConnectionUri(neonProjectId, {
      branchId: branch.id,
      databaseName,
      roleName,
      pooled: true,
    }),
    getNeonConnectionUri(neonProjectId, {
      branchId: branch.id,
      databaseName,
      roleName,
      pooled: false,
    }),
  ]);

  await Promise.all([
    upsertSecret(project.id, "DATABASE_URL", pooledUri, "cloud"),
    upsertSecret(project.id, "DIRECT_URL", directUri, "cloud"),
  ]);

  if (project.sandboxId) {
    await syncProjectEnv(project).catch(() => undefined);
  }

  const host = new URL(pooledUri).hostname;
  return { branchId: branch.id, branchName: branch.name, databaseName, roleName, host };
}

/**
 * Ensures the Cognix project owns a provisioned Neon serverless Postgres project.
 * Concurrent calls for the same project share a single provisioning lock.
 */
export async function ensureProjectNeonDatabase(
  project: Project,
  options: { regionId?: string; pgVersion?: number } = {},
): Promise<ProvisionedNeonResult> {
  const existingLock = provisionLocks.get(project.id);
  if (existingLock) return existingLock;

  const job = (async (): Promise<ProvisionedNeonResult> => {
    const cloud = await getProjectCloud(project.id);
    if (cloud?.neonProjectId) {
      try {
        const remote = await getNeonProject(cloud.neonProjectId);
        const synced = await syncNeonConnectionSecrets(project, remote.id);
        await updateProjectCloud(project.id, {
          status: "ready",
          neonProjectId: remote.id,
          neonRegion: remote.region_id,
          lastError: null,
        });
        return {
          neonProjectId: remote.id,
          neonRegion: remote.region_id,
          branchId: synced.branchId,
          databaseName: synced.databaseName,
          roleName: synced.roleName,
          host: synced.host,
          created: false,
        };
      } catch (error) {
        if (!(error instanceof NeonApiError && error.status === 404)) throw error;
        // Remote Neon project was deleted externally; create a fresh one below.
      }
    }

    const slug = publishSlugFromTitle(project.title) || "app";
    const created = await createNeonProject({
      name: `cognix-${slug}-${project.id.slice(0, 8)}`,
      regionId: options.regionId,
      pgVersion: options.pgVersion,
    });
    const neonProject = created.project;
    const synced = await syncNeonConnectionSecrets(project, neonProject.id);

    await updateProjectCloud(project.id, {
      status: "ready",
      neonProjectId: neonProject.id,
      neonRegion: neonProject.region_id,
      lastError: null,
    });

    return {
      neonProjectId: neonProject.id,
      neonRegion: neonProject.region_id,
      branchId: synced.branchId,
      databaseName: synced.databaseName,
      roleName: synced.roleName,
      host: synced.host,
      created: true,
    };
  })().finally(() => {
    provisionLocks.delete(project.id);
  });

  provisionLocks.set(project.id, job);
  return job;
}

export async function getProjectNeonOverview(project: Project) {
  const [cloud, secrets] = await Promise.all([
    getProjectCloud(project.id),
    getDecryptedSecrets(project.id),
  ]);
  const apiConfigured = isNeonApiConfigured();
  const databaseUrl = secrets.DATABASE_URL;
  const directUrlSet = Boolean(secrets.DIRECT_URL);

  let maskedHost: string | null = null;
  if (databaseUrl) {
    try {
      maskedHost = new URL(databaseUrl).hostname;
    } catch {
      maskedHost = null;
    }
  }

  if (!cloud?.neonProjectId || !apiConfigured) {
    const tables = databaseUrl ? await inspectProjectTables(databaseUrl) : [];
    return {
      neonApiConfigured: apiConfigured,
      defaultRegion: defaultNeonRegion(),
      provisioned: false,
      neonProjectId: cloud?.neonProjectId ?? null,
      neonRegion: cloud?.neonRegion ?? null,
      databaseUrlSet: Boolean(databaseUrl),
      directUrlSet,
      activeHost: maskedHost,
      lastError: cloud?.lastError ?? null,
      project: null,
      branches: [] as NeonBranch[],
      endpoints: [] as NeonEndpoint[],
      databases: [] as NeonDatabase[],
      roles: [] as NeonRole[],
      snapshots: [] as NeonSnapshot[],
      operations: [] as NeonOperation[],
      tables,
    };
  }

  const [neonProject, branches, endpoints, snapshots, operations, tables] = await Promise.all([
    getNeonProject(cloud.neonProjectId),
    listNeonBranches(cloud.neonProjectId),
    listNeonEndpoints(cloud.neonProjectId),
    listNeonSnapshots(cloud.neonProjectId),
    listNeonOperations(cloud.neonProjectId, 10),
    databaseUrl ? inspectProjectTables(databaseUrl) : Promise.resolve([] as IntrospectedTable[]),
  ]);

  const activeBranch = branches.find((b) => b.default || b.primary) ?? branches[0];
  const [databases, roles] = activeBranch
    ? await Promise.all([
        listNeonDatabases(cloud.neonProjectId, activeBranch.id),
        listNeonRoles(cloud.neonProjectId, activeBranch.id),
      ])
    : [[] as NeonDatabase[], [] as NeonRole[]];

  return {
    neonApiConfigured: apiConfigured,
    defaultRegion: defaultNeonRegion(),
    provisioned: true,
    neonProjectId: neonProject.id,
    neonRegion: neonProject.region_id,
    databaseUrlSet: Boolean(databaseUrl),
    directUrlSet,
    activeHost: maskedHost,
    lastError: cloud.lastError,
    project: neonProject,
    branches,
    endpoints,
    databases,
    roles,
    snapshots,
    operations,
    tables,
  };
}
