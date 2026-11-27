import type { Sandbox } from "@daytona/sdk";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "../types";
import {
  assertBuildModeCommandAllowed,
  assertBuildModeFileChangeAllowed,
  packageNameFromImportSpec,
  packageNameFromInstallSpec,
} from "./cloud-stack-policy";
import { executeAgentTool } from "./tools";

vi.mock("../daytona", () => ({
  getProjectRoot: vi.fn(async () => "/home/daytona/app"),
  getProjectFsRoot: vi.fn(() => "app"),
  getPreviewHealth: vi.fn(),
  getPreviewUrl: vi.fn(),
}));

vi.mock("../store", () => ({
  upsertProjectFile: vi.fn(async () => undefined),
  deleteProjectFile: vi.fn(async () => undefined),
  updateProject: vi.fn(async () => undefined),
}));

const buildProject: Project = {
  id: "proj-build-1",
  ownerId: "user-1",
  title: "Notes App",
  description: "",
  status: "building",
  coverGradient: "aurora",
  sandboxId: "sbx-1",
  previewUrl: null,
  publishSlug: null,
  publishedAt: null,
  showBadge: true,
  publicRemix: false,
  mode: "build",
  securitySource: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const securityProject: Project = {
  ...buildProject,
  id: "proj-sec-1",
  mode: "security",
};

function mockSandbox(): Sandbox {
  return {
    id: "sbx-1",
    process: {
      executeCommand: vi.fn(async (cmd: string) => ({
        exitCode: cmd.startsWith("test -f") ? 1 : 0,
        result: "ok",
      })),
    },
    fs: {
      downloadFile: vi.fn(async () => Buffer.from("")),
      uploadFile: vi.fn(async () => undefined),
    },
  } as unknown as Sandbox;
}

describe("package specifier parsing", () => {
  it("extracts package names from npm install tokens and import specifiers", () => {
    expect(packageNameFromInstallSpec("better-auth@latest")).toBe("better-auth");
    expect(packageNameFromInstallSpec("@clerk/nextjs@^5.2.0")).toBe("@clerk/nextjs");
    expect(packageNameFromInstallSpec("--save-dev")).toBeNull();
    expect(packageNameFromImportSpec("better-auth/next-js")).toBe("better-auth");
    expect(packageNameFromImportSpec("@supabase/ssr/dist")).toBe("@supabase/ssr");
    expect(packageNameFromImportSpec("@/lib/db")).toBeNull();
    expect(packageNameFromImportSpec("node:crypto")).toBeNull();
  });
});

describe("Build mode exclusive Cognix Cloud stack policy", () => {
  it.each([
    "npm install prisma @prisma/client",
    "npm i better-sqlite3",
    "pnpm add @supabase/supabase-js @supabase/ssr",
    "yarn add @clerk/nextjs",
    "bun add next-auth",
    "npm install firebase firebase-admin",
    "npm install mongoose mongodb",
    "npm install nodemailer @sendgrid/mail",
    "npm install uploadthing @uploadthing/react",
    "npm install @vercel/blob @vercel/postgres",
    "npm install bcryptjs jsonwebtoken",
    "npx prisma init --datasource-provider sqlite",
    "npx supabase init",
  ])("blocks non-Cognix-Cloud command even when Cloud is on: %s", (command) => {
    expect(() => assertBuildModeCommandAllowed(command, true)).toThrow(/Stack policy:/);
    expect(() => assertBuildModeCommandAllowed(command, false)).toThrow(/Stack policy:/);
  });

  it("blocks non-Cognix-Cloud files, package.json deps, and source imports", () => {
    expect(() =>
      assertBuildModeFileChangeAllowed({
        path: "prisma/schema.prisma",
        before: null,
        after: 'datasource db { provider = "sqlite" }',
        cloudEnabled: true,
      }),
    ).toThrow(/Stack policy:.*Prisma/);

    expect(() =>
      assertBuildModeFileChangeAllowed({
        path: "package.json",
        before: JSON.stringify({ dependencies: { next: "16.0.0" } }),
        after: JSON.stringify({ dependencies: { next: "16.0.0", "@clerk/nextjs": "^6.0.0" } }),
        cloudEnabled: true,
      }),
    ).toThrow(/Stack policy:.*Clerk/);

    expect(() =>
      assertBuildModeFileChangeAllowed({
        path: "lib/supabase.ts",
        before: null,
        after: 'import { createClient } from "@supabase/supabase-js";\nexport const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, "x");',
        cloudEnabled: true,
      }),
    ).toThrow(/Stack policy:.*Supabase/);
  });

  it("permits removing legacy disallowed packages via uninstall or package.json cleanup", () => {
    expect(() => assertBuildModeCommandAllowed("npm uninstall prisma @prisma/client", false)).not.toThrow();
    expect(() => assertBuildModeCommandAllowed("rm -rf prisma/schema.prisma", false)).not.toThrow();
    expect(() =>
      assertBuildModeFileChangeAllowed({
        path: "package.json",
        before: JSON.stringify({ dependencies: { prisma: "^6.0.0", "@prisma/client": "^6.0.0" } }),
        after: JSON.stringify({ dependencies: {} }),
        cloudEnabled: false,
      }),
    ).not.toThrow();
  });
});

describe("Build mode mandatory Cognix Cloud consent gate when Cloud is off", () => {
  it.each([
    "npm install drizzle-orm pg",
    "npm install -D drizzle-kit @types/pg",
    "npm install better-auth",
    "npm install resend",
    "npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner",
    "npx drizzle-kit push",
    "npx auth@latest migrate --yes",
  ])("blocks Cognix Cloud setup commands until user consents: %s", (command) => {
    expect(() => assertBuildModeCommandAllowed(command, false)).toThrow(/Consent required:.*request_cognix_cloud/);
    expect(() => assertBuildModeCommandAllowed(command, true)).not.toThrow();
  });

  it("blocks Cognix Cloud imports, env vars, and local fs.writeFile DB workarounds when Cloud is off", () => {
    const dbSource = [
      'import { drizzle } from "drizzle-orm/node-postgres";',
      'import { Pool } from "pg";',
      "export const db = drizzle(new Pool({ connectionString: process.env.DATABASE_URL }));",
    ].join("\n");

    expect(() =>
      assertBuildModeFileChangeAllowed({
        path: "lib/db.ts",
        before: null,
        after: dbSource,
        cloudEnabled: false,
      }),
    ).toThrow(/Consent required:/);

    expect(() =>
      assertBuildModeFileChangeAllowed({
        path: "lib/db.ts",
        before: null,
        after: dbSource,
        cloudEnabled: true,
      }),
    ).not.toThrow();

    expect(() =>
      assertBuildModeFileChangeAllowed({
        path: "app/api/notes/route.ts",
        before: null,
        after: 'import { writeFileSync } from "node:fs";\nexport async function POST() { writeFileSync("notes.json", "[]"); }',
        cloudEnabled: false,
      }),
    ).toThrow(/Consent required:/);
  });

  it("allows standard frontend UI commands and imports when Cloud is off", () => {
    expect(() =>
      assertBuildModeCommandAllowed("npm install lucide-react zod framer-motion clsx tailwind-merge && npm run build", false),
    ).not.toThrow();
    expect(() =>
      assertBuildModeCommandAllowed("npx shadcn@latest add button dialog card", false),
    ).not.toThrow();
    expect(() =>
      assertBuildModeFileChangeAllowed({
        path: "app/page.tsx",
        before: null,
        after: '// Ignore prisma/supabase in comments: https://example.com\nimport { Sparkles } from "lucide-react";\nexport default function Page() { return <main><Sparkles /></main>; }',
        cloudEnabled: false,
      }),
    ).not.toThrow();
  });
});

describe("executeAgentTool integration across Build vs Security modes", () => {
  it("blocks Prisma/SQLite in Build mode but allows auditing/editing arbitrary stacks in Security mode", async () => {
    const sandbox = mockSandbox();

    await expect(
      executeAgentTool(
        buildProject,
        sandbox,
        "write_file",
        { path: "prisma/schema.prisma", content: 'datasource db { provider = "sqlite" }' },
        { cloudEnabled: true },
      ),
    ).rejects.toThrow(/Stack policy:/);

    await expect(
      executeAgentTool(
        buildProject,
        sandbox,
        "run_command",
        { command: "npm install drizzle-orm pg" },
        { cloudEnabled: false },
      ),
    ).rejects.toThrow(/Consent required:/);

    const secResult = await executeAgentTool(
      securityProject,
      sandbox,
      "write_file",
      { path: "prisma/schema.prisma", content: 'datasource db { provider = "postgresql" }' },
      { cloudEnabled: false },
    );
    expect(secResult.summary).toBe("Updated prisma/schema.prisma");
  });
});
