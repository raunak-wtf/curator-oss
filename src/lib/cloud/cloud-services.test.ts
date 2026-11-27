import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, ProjectCloud } from "@/lib/types";

const storeState = vi.hoisted(() => ({
  cloud: null as ProjectCloud | null,
  secrets: new Map<string, string>(),
}));

vi.mock("@/lib/daytona", () => ({
  syncProjectEnv: vi.fn(async () => undefined),
}));

vi.mock("@/lib/secrets-crypto", () => ({
  isSecretsEncryptionConfigured: true,
}));

vi.mock("@/lib/store", () => ({
  getProjectCloud: vi.fn(async () => storeState.cloud),
  updateProjectCloud: vi.fn(async (projectId: string, patch: Partial<ProjectCloud>) => {
    const now = new Date().toISOString();
    storeState.cloud = {
      projectId,
      status: patch.status ?? storeState.cloud?.status ?? "ready",
      neonProjectId: patch.neonProjectId !== undefined ? patch.neonProjectId : (storeState.cloud?.neonProjectId ?? null),
      neonRegion: patch.neonRegion !== undefined ? patch.neonRegion : (storeState.cloud?.neonRegion ?? null),
      storageEnabled: patch.storageEnabled ?? storeState.cloud?.storageEnabled ?? true,
      appTokenHash: null,
      authEnabled: patch.authEnabled ?? storeState.cloud?.authEnabled ?? true,
      lastError: patch.lastError !== undefined ? patch.lastError : (storeState.cloud?.lastError ?? null),
      createdAt: storeState.cloud?.createdAt ?? now,
      updatedAt: now,
    };
    return storeState.cloud;
  }),
  upsertSecret: vi.fn(async (_projectId: string, name: string, value: string) => {
    storeState.secrets.set(name, value);
    return { id: `sec-${name}`, projectId: _projectId, name, managedBy: "cloud", updatedAt: new Date().toISOString() };
  }),
  getDecryptedSecrets: vi.fn(async () => Object.fromEntries(storeState.secrets.entries())),
}));

import { executeCloudProviderTool } from "@/lib/ai/cloud-tools";
import { inspectBetterAuthCodebase } from "@/lib/cloud/better-auth";
import {
  NeonApiError,
  deleteNeonBranch,
  ensureProjectNeonDatabase,
  scrubConnectionCredentials,
  splitSqlStatements,
} from "@/lib/cloud/neon";
import { scrubResendKey, validateResendApiKeyFormat } from "@/lib/cloud/resend";

const originalFetch = globalThis.fetch;

const sampleProject: Project = {
  id: "c7168456-6251-4b69-88d0-39fdf2a77391",
  ownerId: "user-1",
  title: "Notes Pro",
  description: "",
  status: "ready",
  coverGradient: "aurora",
  sandboxId: "sbx-1",
  previewUrl: null,
  publishSlug: null,
  publishedAt: null,
  showBadge: true,
  publicRemix: false,
  mode: "build",
  securitySource: null,
  createdAt: "2026-11-27T00:00:00.000Z",
  updatedAt: "2026-11-27T00:00:00.000Z",
};

describe("Cognix Cloud services & AI tools", () => {
  beforeEach(() => {
    storeState.cloud = null;
    storeState.secrets.clear();
    vi.stubEnv("NEON_API_KEY", "neon_api_test_key_123");
    vi.stubEnv("COGNIX_SECRETS_KEY", "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("scrubs Postgres connection credentials and Resend API keys from errors", () => {
    expect(
      scrubConnectionCredentials("Failed connecting to postgresql://neondb_owner:s3cr3tPass@ep-cool.us-east-1.aws.neon.tech/neondb?sslmode=require"),
    ).toBe("Failed connecting to postgresql://[REDACTED]");

    expect(scrubResendKey("Bearer re_AbCdEfGh1234567890 failed")).toBe("Bearer re_[REDACTED] failed");
    expect(() => validateResendApiKeyFormat("invalid-key")).toThrow(/re_/);
    expect(validateResendApiKeyFormat(" re_1234567890abcdef ")).toBe("re_1234567890abcdef");
  });

  it("deduplicates concurrent Neon provisioning and retries HTTP 423 locks", async () => {
    let createCalls = 0;
    let lockedOnce = true;

    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v2/projects" && init?.method === "POST") {
        if (lockedOnce) {
          lockedOnce = false;
          return new Response(JSON.stringify({ message: "project locked" }), {
            status: 423,
            headers: { "retry-after": "0" },
          });
        }
        createCalls += 1;
        return Response.json({
          project: {
            id: "neon-proj-99",
            name: "cognix-notes-pro-c7168456",
            region_id: "aws-us-east-1",
            pg_version: 17,
            created_at: "2026-11-27T00:00:00Z",
            updated_at: "2026-11-27T00:00:00Z",
          },
        });
      }
      if (url.pathname === "/api/v2/projects/neon-proj-99/branches") {
        return Response.json({
          branches: [
            { id: "br-main", project_id: "neon-proj-99", name: "main", current_state: "ready", default: true, created_at: "2026-11-27T00:00:00Z", updated_at: "2026-11-27T00:00:00Z" },
          ],
        });
      }
      if (url.pathname === "/api/v2/projects/neon-proj-99/branches/br-main/databases") {
        return Response.json({
          databases: [{ id: 1, branch_id: "br-main", name: "neondb", owner_name: "neondb_owner", created_at: "", updated_at: "" }],
        });
      }
      if (url.pathname === "/api/v2/projects/neon-proj-99/branches/br-main/roles") {
        return Response.json({
          roles: [{ branch_id: "br-main", name: "neondb_owner", created_at: "", updated_at: "" }],
        });
      }
      if (url.pathname === "/api/v2/projects/neon-proj-99/connection_uri") {
        const pooled = url.searchParams.get("pooled") === "true";
        return Response.json({
          uri: pooled
            ? "postgresql://neondb_owner:secret@ep-demo-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require"
            : "postgresql://neondb_owner:secret@ep-demo.us-east-1.aws.neon.tech/neondb?sslmode=require",
        });
      }
      return Response.json({});
    }) as unknown as typeof fetch;

    const [first, second] = await Promise.all([
      ensureProjectNeonDatabase(sampleProject),
      ensureProjectNeonDatabase(sampleProject),
    ]);

    expect(createCalls).toBe(1);
    expect(first.neonProjectId).toBe("neon-proj-99");
    expect(second.neonProjectId).toBe("neon-proj-99");
    expect(storeState.secrets.get("DATABASE_URL")).toContain("-pooler.");
    expect(storeState.secrets.get("DIRECT_URL")).toContain("ep-demo.us-east-1.aws.neon.tech");
  });

  it("refuses to delete the default primary Neon branch", async () => {
    globalThis.fetch = vi.fn(async () =>
      Response.json({
        branches: [
          { id: "br-main", project_id: "neon-proj-99", name: "main", current_state: "ready", default: true, created_at: "", updated_at: "" },
        ],
      }),
    ) as unknown as typeof fetch;

    await expect(deleteNeonBranch("neon-proj-99", "br-main")).rejects.toThrow(NeonApiError);
  });

  it("detects Better Auth configuration, OAuth providers, and plugins from project files", () => {
    const status = inspectBetterAuthCodebase([
      {
        path: "package.json",
        content: JSON.stringify({ dependencies: { "better-auth": "^1.4.2" } }),
      },
      {
        path: "src/lib/auth.ts",
        content: `
          import { betterAuth } from "better-auth";
          import { twoFactor } from "better-auth/plugins";
          export const auth = betterAuth({
            emailAndPassword: { enabled: true, sendResetPassword: async () => {} },
            emailVerification: { sendOnSignUp: true },
            socialProviders: { github: { clientId: "" }, google: { clientId: "" } },
            plugins: [twoFactor()],
          });
        `,
      },
      { path: "src/app/api/auth/[...all]/route.ts", content: "export const { GET, POST } = handler;" },
      { path: "src/lib/auth-client.ts", content: "export const authClient = createAuthClient();" },
    ]);

    expect(status.packageInstalled).toBe(true);
    expect(status.packageVersion).toBe("^1.4.2");
    expect(status.serverConfigPath).toBe("src/lib/auth.ts");
    expect(status.routeHandlerPath).toBe("src/app/api/auth/[...all]/route.ts");
    expect(status.clientConfigPath).toBe("src/lib/auth-client.ts");
    expect(status.features.emailAndPassword).toBe(true);
    expect(status.features.emailVerification).toBe(true);
    expect(status.features.passwordReset).toBe(true);
    expect(status.features.socialProviders).toEqual(["google", "github"]);
    expect(status.features.plugins).toEqual(["Two-Factor (2FA)"]);
  });

  it("enforces Cognix Cloud gate and executes neon_database and resend_email tools safely", async () => {
    const blocked = await executeCloudProviderTool(sampleProject, "neon_database", { action: "status" }, false);
    expect(blocked.output).toContain("Cognix Cloud is off");

    storeState.secrets.set("RESEND_API_KEY", "re_validtestkey12345");
    storeState.secrets.set("EMAIL_FROM", "Acme <hello@acme.com>");

    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.hostname === "api.resend.com" && url.pathname === "/emails") {
        return Response.json({ id: "em_98765" });
      }
      return Response.json({ data: [] });
    }) as unknown as typeof fetch;

    const sent = await executeCloudProviderTool(
      sampleProject,
      "resend_email",
      { action: "send_email", to: "user@example.com", subject: "Welcome", text: "Hello!" },
      true,
    );
    expect(sent.summary).toContain("em_98765");
    expect(sent.output).not.toContain("re_validtestkey12345");
  });

  it("splits multi-statement SQL scripts safely across quotes, comments, and $$ blocks", () => {
    const sqlScript = `
      -- Initialize schema
      CREATE TABLE IF NOT EXISTS "user" (
        id text PRIMARY KEY,
        bio text DEFAULT 'hello; world'
      );
      /* Multi-line
         comment with ; inside */
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_status') THEN
          CREATE TYPE project_status AS ENUM ('active', 'approved');
        END IF;
      END
      $$;
      INSERT INTO "user" (id, bio) VALUES ('u1', 'studio;owner');
    `;

    const statements = splitSqlStatements(sqlScript);
    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain('CREATE TABLE IF NOT EXISTS "user"');
    expect(statements[0]).toContain("'hello; world'");
    expect(statements[1]).toContain("CREATE TYPE project_status");
    expect(statements[2]).toContain("INSERT INTO \"user\"");
  });
});
