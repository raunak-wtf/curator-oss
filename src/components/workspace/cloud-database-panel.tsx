"use client";

import {
  Camera,
  Check,
  Cpu,
  Database,
  GitBranch,
  Layers,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Terminal,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PixelLoader } from "@/components/pixel-loader";
import { cn, formatRelativeDate } from "@/lib/utils";

type NeonBranch = {
  id: string;
  name: string;
  parent_id?: string;
  current_state: string;
  default?: boolean;
  primary?: boolean;
  created_at: string;
};

type NeonEndpoint = {
  id: string;
  host: string;
  branch_id: string;
  type: "read_write" | "read_only";
  current_state: string;
  autoscaling_limit_min_cu: number;
  autoscaling_limit_max_cu: number;
  suspend_timeout_seconds: number;
};

type NeonDatabase = {
  id: number;
  branch_id: string;
  name: string;
  owner_name: string;
  created_at: string;
};

type NeonRole = {
  branch_id: string;
  name: string;
  protected?: boolean;
};

type NeonSnapshot = {
  id: string;
  name: string;
  source_branch_id?: string;
  created_at: string;
};

type IntrospectedTable = {
  schema: string;
  name: string;
  estimatedRows: number;
  columns: { name: string; dataType: string; nullable: boolean; defaultValue: string | null }[];
};

type NeonOverview = {
  neonApiConfigured: boolean;
  defaultRegion: string;
  provisioned: boolean;
  neonProjectId: string | null;
  neonRegion: string | null;
  databaseUrlSet: boolean;
  directUrlSet: boolean;
  activeHost: string | null;
  lastError: string | null;
  project: { id: string; name: string; region_id: string; pg_version: number; created_at: string } | null;
  branches: NeonBranch[];
  endpoints: NeonEndpoint[];
  databases: NeonDatabase[];
  roles: NeonRole[];
  snapshots: NeonSnapshot[];
  tables: IntrospectedTable[];
};

type SqlResult = {
  command: string | null;
  rowCount: number;
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
};

type DbTab = "tables" | "sql" | "branches" | "compute" | "roles" | "snapshots";

const REGIONS = [
  { id: "aws-us-east-1", label: "US East (N. Virginia)" },
  { id: "aws-us-east-2", label: "US East (Ohio)" },
  { id: "aws-us-west-2", label: "US West (Oregon)" },
  { id: "aws-eu-central-1", label: "Europe (Frankfurt)" },
  { id: "aws-ap-southeast-1", label: "Asia Pacific (Singapore)" },
];

const btnSecondary =
  "inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-[12.5px] font-medium text-white/80 hover:bg-white/[0.07] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9f94ff] disabled:cursor-not-allowed disabled:opacity-45 [@media(pointer:coarse)]:h-11";
const btnPrimary =
  "inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[12.5px] font-semibold text-black hover:bg-white/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9f94ff] disabled:cursor-not-allowed disabled:opacity-45 [@media(pointer:coarse)]:h-11";
const iconBtn =
  "grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9f94ff] disabled:opacity-40 [@media(pointer:coarse)]:size-11";
const inputClass =
  "h-8 w-full rounded-lg border border-white/[0.12] bg-[#111111] px-2.5 text-[12.5px] text-white outline-none placeholder:text-white/35 focus-visible:border-white/35 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[#9f94ff] [@media(pointer:coarse)]:h-11";

export function CloudDatabasePanel({
  projectId,
  onAskAgent,
  onSecretsChanged,
}: {
  projectId: string;
  onAskAgent: (prompt: string) => void;
  onSecretsChanged?: () => void;
}) {
  const [data, setData] = useState<NeonOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [tab, setTab] = useState<DbTab>("tables");
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [regionId, setRegionId] = useState("aws-us-east-1");

  // SQL state
  const [sqlText, setSqlText] = useState("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';");
  const [sqlBranchId, setSqlBranchId] = useState("");
  const [sqlResult, setSqlResult] = useState<SqlResult | null>(null);
  const [sqlError, setSqlError] = useState<string | null>(null);

  // Branch / DB / Role / Snapshot / Endpoint inputs
  const [branchName, setBranchName] = useState("");
  const [branchParentId, setBranchParentId] = useState("");
  const [branchPitTime, setBranchPitTime] = useState("");
  const [dbNameInput, setDbNameInput] = useState("");
  const [roleNameInput, setRoleNameInput] = useState("");
  const [snapshotName, setSnapshotName] = useState("");
  const [replicaBranchId, setReplicaBranchId] = useState("");

  const fetchOverview = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/cloud/database`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Could not load database status.");
    return payload as NeonOverview;
  }, [projectId]);

  const applyOverview = useCallback((next: NeonOverview) => {
    setData(next);
    if (next.defaultRegion) setRegionId(next.defaultRegion);
    setSelectedTable((current) =>
      current || (next.tables.length > 0 ? `${next.tables[0].schema}.${next.tables[0].name}` : null),
    );
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      applyOverview(await fetchOverview());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load database status.");
    } finally {
      setLoading(false);
    }
  }, [applyOverview, fetchOverview]);

  useEffect(() => {
    let active = true;
    fetchOverview()
      .then((next) => {
        if (!active) return;
        applyOverview(next);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not load database status.");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applyOverview, fetchOverview]);

  async function runAction(label: string, body: Record<string, unknown>, successMessage?: string) {
    if (busyAction) return null;
    setBusyAction(label);
    try {
      const response = await fetch(`/api/projects/${projectId}/cloud/database`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Database operation failed.");
      if (payload.overview) setData(payload.overview as NeonOverview);
      if (successMessage) toast.success(successMessage);
      onSecretsChanged?.();
      return payload;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Database operation failed.");
      return null;
    } finally {
      setBusyAction(null);
    }
  }

  async function runSqlQuery(event: React.FormEvent) {
    event.preventDefault();
    if (!sqlText.trim() || busyAction) return;
    setBusyAction("sql");
    setSqlError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/cloud/database`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "run_sql",
          sql: sqlText,
          ...(sqlBranchId ? { branchId: sqlBranchId } : {}),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "SQL execution failed.");
      setSqlResult(payload.result as SqlResult);
      void load();
    } catch (err) {
      setSqlError(err instanceof Error ? err.message : "SQL execution failed.");
    } finally {
      setBusyAction(null);
    }
  }

  if (loading && !data) {
    return (
      <div className="flex min-h-[320px] items-center justify-center gap-2 text-[13px] text-white/50">
        <PixelLoader /> Loading Cloud Database…
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-lg border border-red-400/20 bg-red-500/[0.05] p-5">
        <p className="text-[13px] font-medium text-red-200">Database details could not be loaded</p>
        <p className="mt-1 text-[12px] text-red-200/70">{error}</p>
        <button type="button" onClick={() => void load()} className={cn(btnSecondary, "mt-3")}>
          <RefreshCw className="size-3.5" aria-hidden="true" /> Try again
        </button>
      </div>
    );
  }

  if (!data) return null;

  const activeTable =
    data.tables.find((t) => `${t.schema}.${t.name}` === selectedTable) ?? data.tables[0] ?? null;

  return (
    <section aria-labelledby="cloud-database-heading" className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="cloud-database-heading" className="text-lg font-semibold tracking-tight text-white">
            Cognix Cloud Database
          </h2>
          <p className="mt-1 text-[13px] text-white/55">
            Serverless PostgreSQL with instant branching, autoscaling compute, snapshots, and direct AI tool access.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || Boolean(busyAction)}
          aria-label="Refresh database status"
          title="Refresh database status"
          className={iconBtn}
        >
          {loading ? <PixelLoader /> : <RefreshCw className="size-3.5" aria-hidden="true" />}
        </button>
      </header>

      {!data.neonApiConfigured ? (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.05] p-4">
          <div className="flex items-start gap-2.5">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-amber-100">Automatic database provisioning is not configured</p>
              <p className="mt-1 text-[12px] leading-5 text-amber-200/75">
                Configure Cloud Database provisioning in the Cognix server environment, then refresh to provision isolated PostgreSQL databases automatically.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {!data.provisioned ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-lg">
              <p className="text-[14px] font-medium text-white">
                {data.databaseUrlSet ? "Custom DATABASE_URL connected" : "No Cloud Database provisioned yet"}
              </p>
              <p className="mt-1 text-[12.5px] leading-5 text-white/55">
                {data.neonApiConfigured
                  ? "Provision a dedicated PostgreSQL 17 instance for this app. Cognix writes pooled DATABASE_URL and unpooled DIRECT_URL to .env.local automatically."
                  : "Once database provisioning is enabled on the server, you can provision a dedicated PostgreSQL instance in one click."}
              </p>
              {data.lastError ? <p className="mt-2 text-[12px] text-red-300">{data.lastError}</p> : null}
            </div>

            {data.neonApiConfigured ? (
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void runAction("provision", { action: "provision", regionId }, "Cloud PostgreSQL database provisioned.");
                }}
              >
                <div>
                  <label htmlFor="neon-region-select" className="mb-1 block text-[11.5px] font-medium text-white/65">
                    Region
                  </label>
                  <select
                    id="neon-region-select"
                    value={regionId}
                    onChange={(e) => setRegionId(e.target.value)}
                    className={cn(inputClass, "w-56")}
                  >
                    {REGIONS.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="submit" disabled={Boolean(busyAction)} className={btnPrimary}>
                  {busyAction === "provision" ? <PixelLoader className="text-black" /> : <Database className="size-3.5" aria-hidden="true" />}
                  {busyAction === "provision" ? "Provisioning…" : "Provision Database"}
                </button>
              </form>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-2.5 @[560px]:grid-cols-4">
            <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
              <span className="text-[11px] font-medium text-white/45">Status & Version</span>
              <p className="mt-1 flex items-center gap-1.5 text-[13px] font-semibold tabular-nums text-white">
                <span className="size-2 rounded-full bg-emerald-400" aria-hidden="true" />
                PG {data.project?.pg_version ?? 17} · Ready
              </p>
              <span className="mt-0.5 block truncate font-mono text-[11px] text-white/40">{data.neonRegion}</span>
            </div>
            <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
              <span className="text-[11px] font-medium text-white/45">Schema Tables</span>
              <p className="mt-1 text-[15px] font-semibold tabular-nums text-white">{data.tables.length}</p>
              <span className="mt-0.5 block text-[11px] text-white/40">
                {data.databaseUrlSet && data.directUrlSet ? "DATABASE_URL + DIRECT_URL set" : "Synced to sandbox"}
              </span>
            </div>
            <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
              <span className="text-[11px] font-medium text-white/45">Branches</span>
              <p className="mt-1 text-[15px] font-semibold tabular-nums text-white">{data.branches.length}</p>
              <span className="mt-0.5 block truncate text-[11px] text-white/40">
                Default: {data.branches.find((b) => b.default || b.primary)?.name ?? "main"}
              </span>
            </div>
            <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
              <span className="text-[11px] font-medium text-white/45">Compute Endpoints</span>
              <p className="mt-1 text-[15px] font-semibold tabular-nums text-white">{data.endpoints.length}</p>
              <span className="mt-0.5 block truncate font-mono text-[11px] text-white/40">
                {data.activeHost ?? data.neonProjectId}
              </span>
            </div>
          </div>

          <nav aria-label="Database management views" className="flex gap-1 overflow-x-auto border-b border-white/[0.08] pb-2">
            {(
              [
                { id: "tables", label: "Tables", icon: Layers },
                { id: "sql", label: "SQL Runner", icon: Terminal },
                { id: "branches", label: "Branches", icon: GitBranch },
                { id: "compute", label: "Compute & Replicas", icon: Cpu },
                { id: "roles", label: "DBs & Roles", icon: Database },
                { id: "snapshots", label: "Snapshots", icon: Camera },
              ] as const
            ).map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9f94ff] [@media(pointer:coarse)]:h-11",
                    active ? "bg-white/[0.1] text-white" : "text-white/55 hover:bg-white/[0.05] hover:text-white",
                  )}
                >
                  <item.icon className="size-3.5" aria-hidden="true" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          {tab === "tables" ? (
            data.tables.length === 0 ? (
              <div className="rounded-lg border border-white/10 bg-white/[0.02] p-6 text-center">
                <p className="text-[13.5px] font-medium text-white">No application tables yet</p>
                <p className="mx-auto mt-1 max-w-md text-[12.5px] text-white/50">
                  Your PostgreSQL database is ready. Ask Cognix to generate your database schema, or run SQL directly in the SQL Runner tab.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => onAskAgent("Create a PostgreSQL schema in Cognix Cloud Database for this app and wire server actions to persist data")}
                    className={btnPrimary}
                  >
                    <Sparkles className="size-3.5" aria-hidden="true" /> Build schema with AI
                  </button>
                  <button type="button" onClick={() => setTab("sql")} className={btnSecondary}>
                    <Terminal className="size-3.5" aria-hidden="true" /> Open SQL Runner
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 @[600px]:grid-cols-[200px_1fr]">
                <ul className="space-y-1 rounded-lg border border-white/10 bg-white/[0.02] p-2">
                  {data.tables.map((t) => {
                    const key = `${t.schema}.${t.name}`;
                    const selected = activeTable && `${activeTable.schema}.${activeTable.name}` === key;
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          onClick={() => setSelectedTable(key)}
                          className={cn(
                            "flex min-h-8 w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[12.5px] focus-visible:outline-2 focus-visible:outline-[#9f94ff] [@media(pointer:coarse)]:min-h-11",
                            selected ? "bg-white/[0.1] font-medium text-white" : "text-white/65 hover:bg-white/[0.05] hover:text-white",
                          )}
                        >
                          <span className="truncate font-mono">{t.name}</span>
                          <span className="shrink-0 text-[11px] tabular-nums text-white/40">{t.estimatedRows}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>

                {activeTable ? (
                  <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.02]">
                    <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-2.5">
                      <div>
                        <strong className="font-mono text-[13px] text-white">
                          {activeTable.schema}.{activeTable.name}
                        </strong>
                        <span className="ml-2 text-[11.5px] tabular-nums text-white/45">
                          ~{activeTable.estimatedRows} rows · {activeTable.columns.length} columns
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSqlText(`SELECT * FROM "${activeTable.schema}"."${activeTable.name}" LIMIT 50;`);
                          setTab("sql");
                        }}
                        className={btnSecondary}
                      >
                        Query rows
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-[12px]">
                        <thead>
                          <tr className="border-b border-white/[0.08] bg-white/[0.02] text-white/55">
                            <th className="px-4 py-2 font-medium">Column</th>
                            <th className="px-4 py-2 font-medium">Type</th>
                            <th className="px-4 py-2 font-medium">Nullable</th>
                            <th className="px-4 py-2 font-medium">Default</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.06]">
                          {activeTable.columns.map((col) => (
                            <tr key={col.name}>
                              <td className="px-4 py-2 font-mono text-white/90">{col.name}</td>
                              <td className="px-4 py-2 font-mono text-sky-300/85">{col.dataType}</td>
                              <td className="px-4 py-2 text-white/55">{col.nullable ? "YES" : "NO"}</td>
                              <td className="max-w-[200px] truncate px-4 py-2 font-mono text-white/45">
                                {col.defaultValue ?? "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          ) : null}

          {tab === "sql" ? (
            <div className="space-y-4">
              <form onSubmit={runSqlQuery} className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor="neon-sql-editor" className="text-[12.5px] font-medium text-white">
                    SQL Statement
                  </label>
                  <div className="flex items-center gap-2">
                    <label htmlFor="sql-branch-select" className="sr-only">
                      Target branch
                    </label>
                    <select
                      id="sql-branch-select"
                      value={sqlBranchId}
                      onChange={(e) => setSqlBranchId(e.target.value)}
                      className={cn(inputClass, "w-44")}
                    >
                      <option value="">Active default branch</option>
                      {data.branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                    <button type="submit" disabled={Boolean(busyAction) || !sqlText.trim()} className={btnPrimary}>
                      {busyAction === "sql" ? <PixelLoader className="text-black" /> : <Play className="size-3.5" aria-hidden="true" />}
                      {busyAction === "sql" ? "Running…" : "Run SQL"}
                    </button>
                  </div>
                </div>
                <textarea
                  id="neon-sql-editor"
                  rows={4}
                  value={sqlText}
                  onChange={(e) => setSqlText(e.target.value)}
                  spellCheck={false}
                  className="w-full rounded-lg border border-white/[0.12] bg-[#0d0d0d] p-3 font-mono text-[12.5px] leading-5 text-white outline-none focus-visible:border-white/35 focus-visible:outline-2 focus-visible:outline-[#9f94ff]"
                />
              </form>

              {sqlError ? (
                <div className="rounded-lg border border-red-400/20 bg-red-500/[0.05] p-3 text-[12px] font-mono text-red-200">
                  {sqlError}
                </div>
              ) : null}

              {sqlResult ? (
                <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.02]">
                  <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-2 text-[12px] tabular-nums text-white/65">
                    <span>
                      {sqlResult.command ? `${sqlResult.command} · ` : ""}
                      {sqlResult.rowCount} {sqlResult.rowCount === 1 ? "row" : "rows"}
                      {sqlResult.truncated ? " (showing first 200)" : ""}
                    </span>
                  </div>
                  {sqlResult.columns.length > 0 ? (
                    <div className="max-h-72 overflow-auto">
                      <table className="w-full text-left text-[12px]">
                        <thead>
                          <tr className="border-b border-white/[0.08] bg-white/[0.03] text-white/60">
                            {sqlResult.columns.map((col) => (
                              <th key={col} className="px-3 py-2 font-mono font-medium">
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.06]">
                          {sqlResult.rows.map((row, idx) => (
                            <tr key={idx}>
                              {sqlResult.columns.map((col) => (
                                <td key={col} className="max-w-[240px] truncate px-3 py-1.5 font-mono text-white/85">
                                  {row[col] === null || row[col] === undefined
                                    ? "NULL"
                                    : typeof row[col] === "object"
                                      ? JSON.stringify(row[col])
                                      : String(row[col])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="p-4 text-[12px] text-white/50">Statement completed with no result rows.</p>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "branches" ? (
            <div className="space-y-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!branchName.trim()) return;
                  void runAction(
                    "create_branch",
                    {
                      action: "create_branch",
                      name: branchName.trim(),
                      ...(branchParentId ? { parentId: branchParentId } : {}),
                      ...(branchPitTime.trim() ? { parentTimestamp: branchPitTime.trim() } : {}),
                    },
                    `Branch ${branchName.trim()} created.`,
                  ).then((res) => {
                    if (res) {
                      setBranchName("");
                      setBranchPitTime("");
                    }
                  });
                }}
                className="rounded-lg border border-white/10 bg-white/[0.02] p-4"
              >
                <h3 className="text-[13px] font-medium text-white">Create copy-on-write or point-in-time branch</h3>
                <div className="mt-3 grid gap-2.5 @[560px]:grid-cols-3">
                  <div>
                    <label htmlFor="new-branch-name" className="mb-1 block text-[11.5px] text-white/60">
                      Branch name
                    </label>
                    <input
                      id="new-branch-name"
                      value={branchName}
                      onChange={(e) => setBranchName(e.target.value)}
                      placeholder="staging or migration-test"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="branch-parent" className="mb-1 block text-[11.5px] text-white/60">
                      Parent branch
                    </label>
                    <select
                      id="branch-parent"
                      value={branchParentId}
                      onChange={(e) => setBranchParentId(e.target.value)}
                      className={inputClass}
                    >
                      <option value="">Default branch</option>
                      {data.branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="branch-pit" className="mb-1 block text-[11.5px] text-white/60">
                      Point-in-time ISO timestamp (optional)
                    </label>
                    <input
                      id="branch-pit"
                      value={branchPitTime}
                      onChange={(e) => setBranchPitTime(e.target.value)}
                      placeholder="2026-11-27T03:00:00Z"
                      className={cn(inputClass, "font-mono")}
                    />
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <button type="submit" disabled={!branchName.trim() || Boolean(busyAction)} className={btnPrimary}>
                    <Plus className="size-3.5" aria-hidden="true" /> Create branch
                  </button>
                </div>
              </form>

              <ul className="divide-y divide-white/[0.06] rounded-lg border border-white/10 bg-white/[0.02]">
                {data.branches.map((branch) => {
                  const isDefault = Boolean(branch.default || branch.primary);
                  return (
                    <li key={branch.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <strong className="font-mono text-[13px] text-white">{branch.name}</strong>
                          {isDefault ? (
                            <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-300">
                              Default
                            </span>
                          ) : null}
                          <span className="text-[11.5px] text-white/45">{branch.current_state}</span>
                        </div>
                        <p className="mt-0.5 text-[11.5px] tabular-nums text-white/40">
                          {branch.id} · Created {formatRelativeDate(branch.created_at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={Boolean(busyAction)}
                          onClick={() =>
                            void runAction(
                              `use-${branch.id}`,
                              { action: "use_connection", branchId: branch.id },
                              `Sandbox .env.local synced to branch ${branch.name}.`,
                            )
                          }
                          className={btnSecondary}
                        >
                          <Check className="size-3.5" aria-hidden="true" /> Use in sandbox
                        </button>
                        {!isDefault ? (
                          <>
                            <button
                              type="button"
                              disabled={Boolean(busyAction)}
                              onClick={() =>
                                void runAction(
                                  `default-${branch.id}`,
                                  { action: "set_default_branch", branchId: branch.id },
                                  `${branch.name} is now the default branch.`,
                                )
                              }
                              className={btnSecondary}
                            >
                              Set default
                            </button>
                            <button
                              type="button"
                              disabled={Boolean(busyAction)}
                              aria-label={`Delete branch ${branch.name}`}
                              title={`Delete branch ${branch.name}`}
                              onClick={() => {
                                if (window.confirm(`Delete database branch "${branch.name}"?`)) {
                                  void runAction(`del-${branch.id}`, { action: "delete_branch", branchId: branch.id }, "Branch deleted.");
                                }
                              }}
                              className={iconBtn}
                            >
                              <Trash2 className="size-3.5" aria-hidden="true" />
                            </button>
                          </>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {tab === "compute" ? (
            <div className="space-y-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const targetBranch = replicaBranchId || data.branches[0]?.id;
                  if (!targetBranch) return;
                  void runAction(
                    "create_replica",
                    { action: "create_endpoint", branchId: targetBranch, type: "read_only" },
                    "Read-only compute replica created.",
                  );
                }}
                className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-4"
              >
                <div>
                  <h3 className="text-[13px] font-medium text-white">Add read-only compute replica</h3>
                  <p className="mt-0.5 text-[12px] text-white/50">Scale read-heavy analytics or reporting queries independently.</p>
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor="replica-branch" className="sr-only">
                    Branch for read replica
                  </label>
                  <select
                    id="replica-branch"
                    value={replicaBranchId}
                    onChange={(e) => setReplicaBranchId(e.target.value)}
                    className={cn(inputClass, "w-44")}
                  >
                    {data.branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  <button type="submit" disabled={Boolean(busyAction)} className={btnPrimary}>
                    <Plus className="size-3.5" aria-hidden="true" /> Add replica
                  </button>
                </div>
              </form>

              <ul className="divide-y divide-white/[0.06] rounded-lg border border-white/10 bg-white/[0.02]">
                {data.endpoints.map((ep) => (
                  <li key={ep.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <strong className="font-mono text-[12.5px] text-white">{ep.id}</strong>
                        <span className="rounded bg-white/[0.07] px-1.5 py-0.5 text-[10.5px] font-medium text-white/75">
                          {ep.type === "read_write" ? "Primary R/W" : "Read Replica"}
                        </span>
                        <span className="text-[11.5px] text-emerald-300/90">{ep.current_state}</span>
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[11.5px] tabular-nums text-white/45">
                        {ep.host} · {ep.autoscaling_limit_min_cu}–{ep.autoscaling_limit_max_cu} CU
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={Boolean(busyAction)}
                        onClick={() =>
                          void runAction(
                            `restart-${ep.id}`,
                            { action: "endpoint_power", endpointId: ep.id, operation: "restart" },
                            "Compute endpoint restarted.",
                          )
                        }
                        className={btnSecondary}
                      >
                        <RotateCcw className="size-3.5" aria-hidden="true" /> Restart
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(busyAction)}
                        onClick={() =>
                          void runAction(
                            `suspend-${ep.id}`,
                            {
                              action: "endpoint_power",
                              endpointId: ep.id,
                              operation: ep.current_state === "active" ? "suspend" : "start",
                            },
                            ep.current_state === "active" ? "Endpoint suspended." : "Endpoint started.",
                          )
                        }
                        className={btnSecondary}
                      >
                        {ep.current_state === "active" ? "Suspend" : "Start"}
                      </button>
                      {ep.type === "read_only" ? (
                        <button
                          type="button"
                          disabled={Boolean(busyAction)}
                          aria-label={`Delete read replica ${ep.id}`}
                          title={`Delete read replica ${ep.id}`}
                          onClick={() => {
                            if (window.confirm(`Delete read replica ${ep.id}?`)) {
                              void runAction(
                                `del-ep-${ep.id}`,
                                { action: "endpoint_power", endpointId: ep.id, operation: "delete" },
                                "Read replica deleted.",
                              );
                            }
                          }}
                          className={iconBtn}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {tab === "roles" ? (
            <div className="grid gap-4 @[600px]:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
                <h3 className="text-[13px] font-medium text-white">Databases</h3>
                <form
                  className="mt-2.5 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!dbNameInput.trim()) return;
                    void runAction(
                      "create_db",
                      { action: "create_database", name: dbNameInput.trim() },
                      `Database ${dbNameInput.trim()} created.`,
                    ).then((res) => res && setDbNameInput(""));
                  }}
                >
                  <label htmlFor="new-db-name" className="sr-only">
                    Database name
                  </label>
                  <input
                    id="new-db-name"
                    value={dbNameInput}
                    onChange={(e) => setDbNameInput(e.target.value)}
                    placeholder="analytics_db"
                    className={inputClass}
                  />
                  <button type="submit" disabled={!dbNameInput.trim() || Boolean(busyAction)} className={btnPrimary}>
                    Add
                  </button>
                </form>
                <ul className="mt-3 divide-y divide-white/[0.06]">
                  {data.databases.map((dbItem) => (
                    <li key={dbItem.id} className="flex items-center justify-between gap-2 py-2 text-[12.5px]">
                      <div>
                        <span className="font-mono text-white">{dbItem.name}</span>
                        <span className="ml-2 text-[11px] text-white/40">owner: {dbItem.owner_name}</span>
                      </div>
                      {dbItem.name !== "neondb" ? (
                        <button
                          type="button"
                          aria-label={`Delete database ${dbItem.name}`}
                          title={`Delete database ${dbItem.name}`}
                          onClick={() => {
                            if (window.confirm(`Delete database ${dbItem.name}?`)) {
                              void runAction(`del-db-${dbItem.name}`, { action: "delete_database", databaseName: dbItem.name }, "Database deleted.");
                            }
                          }}
                          className={iconBtn}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
                <h3 className="text-[13px] font-medium text-white">PostgreSQL Roles</h3>
                <form
                  className="mt-2.5 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!roleNameInput.trim()) return;
                    void runAction(
                      "create_role",
                      { action: "create_role", name: roleNameInput.trim() },
                      `Role ${roleNameInput.trim()} created.`,
                    ).then((res) => res && setRoleNameInput(""));
                  }}
                >
                  <label htmlFor="new-role-name" className="sr-only">
                    Role name
                  </label>
                  <input
                    id="new-role-name"
                    value={roleNameInput}
                    onChange={(e) => setRoleNameInput(e.target.value)}
                    placeholder="readonly_role"
                    className={inputClass}
                  />
                  <button type="submit" disabled={!roleNameInput.trim() || Boolean(busyAction)} className={btnPrimary}>
                    Add
                  </button>
                </form>
                <ul className="mt-3 divide-y divide-white/[0.06]">
                  {data.roles.map((role) => (
                    <li key={role.name} className="flex items-center justify-between gap-2 py-2 text-[12.5px]">
                      <span className="font-mono text-white">{role.name}</span>
                      {!role.protected ? (
                        <button
                          type="button"
                          disabled={Boolean(busyAction)}
                          onClick={() => {
                            if (window.confirm(`Rotate password for role "${role.name}" and sync .env.local?`)) {
                              void runAction(
                                `rot-${role.name}`,
                                { action: "reset_role_password", roleName: role.name },
                                `Password rotated for ${role.name} and synced to sandbox.`,
                              );
                            }
                          }}
                          className={btnSecondary}
                        >
                          Rotate password
                        </button>
                      ) : (
                        <span className="text-[11px] text-white/35">System</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          {tab === "snapshots" ? (
            <div className="space-y-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void runAction(
                    "create_snapshot",
                    { action: "create_snapshot", ...(snapshotName.trim() ? { name: snapshotName.trim() } : {}) },
                    "Snapshot created.",
                  ).then((res) => res && setSnapshotName(""));
                }}
                className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-4"
              >
                <div className="min-w-56 flex-1">
                  <label htmlFor="snapshot-name-input" className="mb-1 block text-[12px] font-medium text-white">
                    Create manual snapshot
                  </label>
                  <input
                    id="snapshot-name-input"
                    value={snapshotName}
                    onChange={(e) => setSnapshotName(e.target.value)}
                    placeholder="before-v2-migration"
                    className={inputClass}
                  />
                </div>
                <button type="submit" disabled={Boolean(busyAction)} className={btnPrimary}>
                  <Camera className="size-3.5" aria-hidden="true" /> Take snapshot
                </button>
              </form>

              {data.snapshots.length === 0 ? (
                <p className="rounded-lg border border-white/10 bg-white/[0.02] p-5 text-center text-[12.5px] text-white/45">
                  No snapshots taken yet. Create a snapshot before running destructive schema changes.
                </p>
              ) : (
                <ul className="divide-y divide-white/[0.06] rounded-lg border border-white/10 bg-white/[0.02]">
                  {data.snapshots.map((snap) => (
                    <li key={snap.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div>
                        <strong className="font-mono text-[12.5px] text-white">{snap.name || snap.id}</strong>
                        <p className="mt-0.5 text-[11.5px] tabular-nums text-white/40">
                          Created {formatRelativeDate(snap.created_at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={Boolean(busyAction)}
                          onClick={() => {
                            if (window.confirm(`Restore snapshot "${snap.name || snap.id}"?`)) {
                              void runAction(`restore-${snap.id}`, { action: "restore_snapshot", snapshotId: snap.id }, "Snapshot restored.");
                            }
                          }}
                          className={btnSecondary}
                        >
                          <RotateCcw className="size-3.5" aria-hidden="true" /> Restore
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(busyAction)}
                          aria-label={`Delete snapshot ${snap.name || snap.id}`}
                          title={`Delete snapshot ${snap.name || snap.id}`}
                          onClick={() => {
                            if (window.confirm(`Delete snapshot "${snap.name || snap.id}"?`)) {
                              void runAction(`del-snap-${snap.id}`, { action: "delete_snapshot", snapshotId: snap.id }, "Snapshot deleted.");
                            }
                          }}
                          className={iconBtn}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
