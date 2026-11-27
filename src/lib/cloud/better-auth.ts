import { neon } from "@neondatabase/serverless";
import { isNeonHttpCompatibleUrl } from "./neon";
import type { ProjectFile } from "@/lib/types";

const AUTH_QUERY_TIMEOUT_MS = 10_000;

export type BetterAuthCodebaseStatus = {
  packageInstalled: boolean;
  packageVersion: string | null;
  serverConfigPath: string | null;
  routeHandlerPath: string | null;
  clientConfigPath: string | null;
  features: {
    emailAndPassword: boolean;
    emailVerification: boolean;
    passwordReset: boolean;
    socialProviders: string[];
    plugins: string[];
  };
};

export type BetterAuthTableStatus = {
  role: "user" | "session" | "account" | "verification";
  tableName: string | null;
  present: boolean;
};

export type BetterAuthUserRecord = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  emailVerified: boolean;
  createdAt: string | null;
  providers: string[];
  activeSessions: number;
};

export type BetterAuthOverview = {
  secretSet: boolean;
  databaseSet: boolean;
  neonProvisioned: boolean;
  emailConfigured: boolean;
  emailFrom: string | null;
  codebase: BetterAuthCodebaseStatus;
  schemaReady: boolean;
  tables: BetterAuthTableStatus[];
  stats: {
    totalUsers: number;
    verifiedUsers: number;
    activeSessions: number;
    providers: Record<string, number>;
  };
  users: BetterAuthUserRecord[];
  queryError: string | null;
};

const KNOWN_OAUTH_PROVIDERS = [
  "google",
  "github",
  "discord",
  "apple",
  "microsoft",
  "twitter",
  "gitlab",
  "linkedin",
  "spotify",
  "twitch",
];

const KNOWN_PLUGINS = [
  { id: "twoFactor", label: "Two-Factor (2FA)" },
  { id: "organization", label: "Organizations" },
  { id: "passkey", label: "Passkeys" },
  { id: "magicLink", label: "Magic Link" },
  { id: "emailOTP", label: "Email OTP" },
  { id: "username", label: "Username" },
  { id: "admin", label: "Admin" },
  { id: "bearer", label: "Bearer Token" },
];

export function inspectBetterAuthCodebase(files: Pick<ProjectFile, "path" | "content">[]): BetterAuthCodebaseStatus {
  const byPath = new Map(files.map((f) => [f.path.replace(/^\/+/, ""), f.content ?? ""]));

  let packageInstalled = false;
  let packageVersion: string | null = null;
  const pkgContent = byPath.get("package.json");
  if (pkgContent) {
    try {
      const parsed = JSON.parse(pkgContent) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const ver = parsed.dependencies?.["better-auth"] ?? parsed.devDependencies?.["better-auth"];
      if (ver) {
        packageInstalled = true;
        packageVersion = ver;
      }
    } catch {
      // Ignore malformed package.json during active edits
    }
  }

  const serverCandidates = ["src/lib/auth.ts", "lib/auth.ts", "auth.ts", "src/auth.ts"];
  const routeCandidates = [
    "src/app/api/auth/[...all]/route.ts",
    "app/api/auth/[...all]/route.ts",
    "src/app/api/auth/[...auth]/route.ts",
    "app/api/auth/[...auth]/route.ts",
  ];
  const clientCandidates = ["src/lib/auth-client.ts", "lib/auth-client.ts", "src/auth-client.ts", "auth-client.ts"];

  const serverConfigPath = serverCandidates.find((p) => byPath.has(p)) ?? null;
  const routeHandlerPath = routeCandidates.find((p) => byPath.has(p)) ?? null;
  const clientConfigPath = clientCandidates.find((p) => byPath.has(p)) ?? null;

  const authSource = serverConfigPath ? byPath.get(serverConfigPath) ?? "" : "";

  const emailAndPassword = /emailAndPassword\s*:\s*\{[\s\S]*?enabled\s*:\s*true/.test(authSource);
  const emailVerification = /sendVerificationEmail|emailVerification\s*:/.test(authSource);
  const passwordReset = /sendResetPassword/.test(authSource);

  const socialProviders = KNOWN_OAUTH_PROVIDERS.filter((provider) =>
    new RegExp(`\\b${provider}\\s*:\\s*\\{`).test(authSource),
  );
  const plugins = KNOWN_PLUGINS.filter((plugin) =>
    new RegExp(`\\b${plugin.id}\\s*\\(`).test(authSource),
  ).map((plugin) => plugin.label);

  return {
    packageInstalled,
    packageVersion,
    serverConfigPath,
    routeHandlerPath,
    clientConfigPath,
    features: {
      emailAndPassword,
      emailVerification,
      passwordReset,
      socialProviders,
      plugins,
    },
  };
}

function quoteIdent(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

type TableColumnsMap = Map<string, Set<string>>;
type SqlQueryRunner = { query: (query: string, params?: unknown[]) => Promise<unknown> };

async function loadPublicColumns(sql: SqlQueryRunner): Promise<TableColumnsMap> {
  const rows = (await sql.query(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'`,
  )) as { table_name: string; column_name: string }[];
  const map: TableColumnsMap = new Map();
  for (const row of rows) {
    const set = map.get(row.table_name) ?? new Set<string>();
    set.add(row.column_name);
    map.set(row.table_name, set);
  }
  return map;
}

function resolveAuthTable(
  columnsMap: TableColumnsMap,
  candidates: string[],
  requiredAnyCols: string[],
): { name: string; cols: Set<string> } | null {
  for (const candidate of candidates) {
    const cols = columnsMap.get(candidate);
    if (cols && requiredAnyCols.some((col) => cols.has(col))) {
      return { name: candidate, cols };
    }
  }
  return null;
}

function pickCol(cols: Set<string>, ...candidates: string[]) {
  return candidates.find((c) => cols.has(c)) ?? null;
}

export async function inspectBetterAuthDatabase(
  databaseUrl: string | undefined,
  options: { search?: string; limit?: number } = {},
): Promise<{
  schemaReady: boolean;
  tables: BetterAuthTableStatus[];
  stats: BetterAuthOverview["stats"];
  users: BetterAuthUserRecord[];
  queryError: string | null;
}> {
  const emptyTables: BetterAuthTableStatus[] = [
    { role: "user", tableName: null, present: false },
    { role: "session", tableName: null, present: false },
    { role: "account", tableName: null, present: false },
    { role: "verification", tableName: null, present: false },
  ];
  const emptyStats = { totalUsers: 0, verifiedUsers: 0, activeSessions: 0, providers: {} as Record<string, number> };

  if (!databaseUrl || !isNeonHttpCompatibleUrl(databaseUrl)) {
    return { schemaReady: false, tables: emptyTables, stats: emptyStats, users: [], queryError: null };
  }

  try {
    const sql = neon(databaseUrl, {
      fetchOptions: { cache: "no-store", signal: AbortSignal.timeout(AUTH_QUERY_TIMEOUT_MS) },
    });
    const columnsMap = await loadPublicColumns(sql);

    const userTable = resolveAuthTable(columnsMap, ["user", "users"], ["email"]);
    const sessionTable = resolveAuthTable(columnsMap, ["session", "sessions"], ["token", "expiresAt", "expires_at"]);
    const accountTable = resolveAuthTable(columnsMap, ["account", "accounts"], ["providerId", "provider_id"]);
    const verificationTable = resolveAuthTable(columnsMap, ["verification", "verifications"], ["identifier", "value"]);

    const tables: BetterAuthTableStatus[] = [
      { role: "user", tableName: userTable?.name ?? null, present: Boolean(userTable) },
      { role: "session", tableName: sessionTable?.name ?? null, present: Boolean(sessionTable) },
      { role: "account", tableName: accountTable?.name ?? null, present: Boolean(accountTable) },
      { role: "verification", tableName: verificationTable?.name ?? null, present: Boolean(verificationTable) },
    ];

    const schemaReady = Boolean(userTable && sessionTable && accountTable);
    if (!userTable) {
      return { schemaReady: false, tables, stats: emptyStats, users: [], queryError: null };
    }

    const uName = quoteIdent(userTable.name);
    const idCol = pickCol(userTable.cols, "id") ?? "id";
    const emailCol = pickCol(userTable.cols, "email") ?? "email";
    const nameCol = pickCol(userTable.cols, "name");
    const imageCol = pickCol(userTable.cols, "image");
    const verifiedCol = pickCol(userTable.cols, "emailVerified", "email_verified");
    const createdCol = pickCol(userTable.cols, "createdAt", "created_at");

    const countQuery = verifiedCol
      ? `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE ${quoteIdent(verifiedCol)} = true)::int AS verified FROM ${uName}`
      : `SELECT COUNT(*)::int AS total, 0::int AS verified FROM ${uName}`;
    const [countsRow] = (await sql.query(countQuery)) as unknown as { total: number; verified: number }[];

    let activeSessionsTotal = 0;
    if (sessionTable) {
      const expCol = pickCol(sessionTable.cols, "expiresAt", "expires_at");
      if (expCol) {
        const [sessRow] = (await sql.query(
          `SELECT COUNT(*)::int AS active FROM ${quoteIdent(sessionTable.name)} WHERE ${quoteIdent(expCol)} > NOW()`,
        )) as unknown as { active: number }[];
        activeSessionsTotal = Number(sessRow?.active) || 0;
      }
    }

    const providersSummary: Record<string, number> = {};
    if (accountTable) {
      const provCol = pickCol(accountTable.cols, "providerId", "provider_id");
      if (provCol) {
        const provRows = (await sql.query(
          `SELECT ${quoteIdent(provCol)} AS provider, COUNT(*)::int AS count
           FROM ${quoteIdent(accountTable.name)}
           GROUP BY ${quoteIdent(provCol)}`,
        )) as unknown as { provider: string; count: number }[];
        for (const r of provRows) {
          if (r.provider) providersSummary[r.provider] = Number(r.count) || 0;
        }
      }
    }

    const search = options.search?.trim() ?? "";
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const params: unknown[] = [];
    let whereClause = "";
    if (search) {
      params.push(`%${search}%`);
      whereClause = nameCol
        ? `WHERE (${quoteIdent(emailCol)} ILIKE $1 OR ${quoteIdent(nameCol)} ILIKE $1)`
        : `WHERE ${quoteIdent(emailCol)} ILIKE $1`;
    }
    params.push(limit);

    const selectParts = [
      `${quoteIdent(idCol)}::text AS id`,
      `${quoteIdent(emailCol)}::text AS email`,
      nameCol ? `COALESCE(${quoteIdent(nameCol)}::text, '') AS name` : `''::text AS name`,
      imageCol ? `${quoteIdent(imageCol)}::text AS image` : `NULL::text AS image`,
      verifiedCol ? `COALESCE(${quoteIdent(verifiedCol)}::boolean, false) AS email_verified` : `false AS email_verified`,
      createdCol ? `${quoteIdent(createdCol)}::text AS created_at` : `NULL::text AS created_at`,
    ];
    const orderBy = createdCol ? `ORDER BY ${quoteIdent(createdCol)} DESC NULLS LAST` : `ORDER BY ${quoteIdent(idCol)} DESC`;

    const rawUsers = (await sql.query(
      `SELECT ${selectParts.join(", ")} FROM ${uName} ${whereClause} ${orderBy} LIMIT $${params.length}`,
      params,
    )) as unknown as {
      id: string;
      email: string;
      name: string;
      image: string | null;
      email_verified: boolean;
      created_at: string | null;
    }[];

    const userIds = rawUsers.map((u) => u.id);
    const providersByUser = new Map<string, string[]>();
    const sessionsByUser = new Map<string, number>();

    if (userIds.length > 0 && accountTable) {
      const accUserCol = pickCol(accountTable.cols, "userId", "user_id");
      const accProvCol = pickCol(accountTable.cols, "providerId", "provider_id");
      if (accUserCol && accProvCol) {
        const rows = (await sql.query(
          `SELECT ${quoteIdent(accUserCol)}::text AS user_id, ${quoteIdent(accProvCol)}::text AS provider
           FROM ${quoteIdent(accountTable.name)}
           WHERE ${quoteIdent(accUserCol)}::text = ANY($1::text[])`,
          [userIds],
        )) as unknown as { user_id: string; provider: string }[];
        for (const r of rows) {
          const list = providersByUser.get(r.user_id) ?? [];
          if (r.provider && !list.includes(r.provider)) list.push(r.provider);
          providersByUser.set(r.user_id, list);
        }
      }
    }

    if (userIds.length > 0 && sessionTable) {
      const sessUserCol = pickCol(sessionTable.cols, "userId", "user_id");
      const sessExpCol = pickCol(sessionTable.cols, "expiresAt", "expires_at");
      if (sessUserCol && sessExpCol) {
        const rows = (await sql.query(
          `SELECT ${quoteIdent(sessUserCol)}::text AS user_id, COUNT(*)::int AS active
           FROM ${quoteIdent(sessionTable.name)}
           WHERE ${quoteIdent(sessUserCol)}::text = ANY($1::text[])
             AND ${quoteIdent(sessExpCol)} > NOW()
           GROUP BY ${quoteIdent(sessUserCol)}`,
          [userIds],
        )) as unknown as { user_id: string; active: number }[];
        for (const r of rows) {
          sessionsByUser.set(r.user_id, Number(r.active) || 0);
        }
      }
    }

    const users: BetterAuthUserRecord[] = rawUsers.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      image: u.image,
      emailVerified: Boolean(u.email_verified),
      createdAt: u.created_at,
      providers: providersByUser.get(u.id) ?? [],
      activeSessions: sessionsByUser.get(u.id) ?? 0,
    }));

    return {
      schemaReady,
      tables,
      stats: {
        totalUsers: Number(countsRow?.total) || 0,
        verifiedUsers: Number(countsRow?.verified) || 0,
        activeSessions: activeSessionsTotal,
        providers: providersSummary,
      },
      users,
      queryError: null,
    };
  } catch (error) {
    return {
      schemaReady: false,
      tables: emptyTables,
      stats: emptyStats,
      users: [],
      queryError: error instanceof Error ? error.message.slice(0, 240) : "Could not inspect Better Auth tables.",
    };
  }
}

export async function setBetterAuthUserVerified(databaseUrl: string, userId: string, verified: boolean) {
  const sql = neon(databaseUrl, { fetchOptions: { cache: "no-store", signal: AbortSignal.timeout(AUTH_QUERY_TIMEOUT_MS) } });
  const cols = await loadPublicColumns(sql);
  const userTable = resolveAuthTable(cols, ["user", "users"], ["email"]);
  if (!userTable) throw new Error("Better Auth user table was not found in PostgreSQL.");
  const idCol = pickCol(userTable.cols, "id") ?? "id";
  const verifiedCol = pickCol(userTable.cols, "emailVerified", "email_verified");
  if (!verifiedCol) throw new Error("User table has no emailVerified column.");
  await sql.query(
    `UPDATE ${quoteIdent(userTable.name)} SET ${quoteIdent(verifiedCol)} = $1 WHERE ${quoteIdent(idCol)}::text = $2`,
    [verified, userId],
  );
  return { updated: true };
}

export async function revokeBetterAuthUserSessions(databaseUrl: string, userId: string) {
  const sql = neon(databaseUrl, { fetchOptions: { cache: "no-store", signal: AbortSignal.timeout(AUTH_QUERY_TIMEOUT_MS) } });
  const cols = await loadPublicColumns(sql);
  const sessionTable = resolveAuthTable(cols, ["session", "sessions"], ["token", "expiresAt", "expires_at"]);
  if (!sessionTable) throw new Error("Better Auth session table was not found in PostgreSQL.");
  const userCol = pickCol(sessionTable.cols, "userId", "user_id");
  if (!userCol) throw new Error("Session table has no userId column.");
  await sql.query(
    `DELETE FROM ${quoteIdent(sessionTable.name)} WHERE ${quoteIdent(userCol)}::text = $1`,
    [userId],
  );
  return { revoked: true };
}

export async function deleteBetterAuthUser(databaseUrl: string, userId: string) {
  const sql = neon(databaseUrl, { fetchOptions: { cache: "no-store", signal: AbortSignal.timeout(AUTH_QUERY_TIMEOUT_MS) } });
  const cols = await loadPublicColumns(sql);
  const userTable = resolveAuthTable(cols, ["user", "users"], ["email"]);
  if (!userTable) throw new Error("Better Auth user table was not found in PostgreSQL.");
  const idCol = pickCol(userTable.cols, "id") ?? "id";
  await sql.query(
    `DELETE FROM ${quoteIdent(userTable.name)} WHERE ${quoteIdent(idCol)}::text = $1`,
    [userId],
  );
  return { deleted: true };
}
