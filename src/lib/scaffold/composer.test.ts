import { describe, expect, it } from "vitest";
import ts from "typescript";
import {
  getPerformanceArchitectureMetadata,
  isBoundedAgentEnabled,
  isContextCompactionEnabled,
  isOneBuildPolicyEnabled,
  isScaffoldBootstrapEnabled,
} from "../feature-flags";
import {
  assertScaffoldContainsNoSecrets,
  composeScaffold,
  isEligibleForNewProjectScaffold,
  selectScaffoldProfilesForPrompt,
} from "./composer";

describe("golden scaffold composer and performance feature flags", () => {
  it("defaults all performance rollout flags to false and parses truthy overrides safely", () => {
    const emptyEnv = {} as unknown as NodeJS.ProcessEnv;
    expect(isScaffoldBootstrapEnabled(emptyEnv)).toBe(false);
    expect(isBoundedAgentEnabled(emptyEnv)).toBe(false);
    expect(isContextCompactionEnabled(emptyEnv)).toBe(false);
    expect(isOneBuildPolicyEnabled(emptyEnv)).toBe(false);

    const enabledEnv = {
      COGNIX_PERF_SCAFFOLD_BOOTSTRAP: "1",
      COGNIX_PERF_BOUNDED_AGENT: "true",
      COGNIX_PERF_CONTEXT_COMPACTION: "yes",
      COGNIX_PERF_ONE_BUILD: "on",
      COGNIX_SCAFFOLD_VERSION: "1.1.0",
    } as unknown as NodeJS.ProcessEnv;
    expect(getPerformanceArchitectureMetadata(enabledEnv)).toEqual({
      scaffoldVersion: "1.1.0",
      flags: {
        scaffoldBootstrap: true,
        boundedAgent: true,
        contextCompaction: true,
        oneBuildPolicy: true,
      },
    });
  });

  it("composes minimal Web base without backend dependencies and produces deterministic hashes", () => {
    const first = composeScaffold(["base"]);
    const second = composeScaffold(["base"]);

    expect(first.manifest.profiles).toEqual(["base"]);
    expect(first.manifest.contentHash).toBe(second.manifest.contentHash);

    const pkgFile = first.files.find((file) => file.path === "package.json");
    expect(pkgFile).toBeTruthy();
    const pkg = JSON.parse(pkgFile!.content) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.dependencies.next).toBeTruthy();
    expect(pkg.dependencies.pg).toBeUndefined();
    expect(pkg.dependencies["better-auth"]).toBeUndefined();
    expect(pkg.dependencies["@aws-sdk/client-s3"]).toBeUndefined();
    expect(pkg.dependencies.resend).toBeUndefined();

    const globals = first.files.find((file) => file.path === "src/app/globals.css");
    expect(globals?.content).toContain("--surface-raised");
    expect(globals?.content).toContain("--primary-foreground");
    expect(globals?.content).toContain("prefers-reduced-motion");

    const paths = new Set(first.files.map((file) => file.path));
    expect(paths.has("src/lib/cn.ts")).toBe(true);
    expect(paths.has("src/components/ui/button.tsx")).toBe(true);
    expect(paths.has("src/components/ui/field.tsx")).toBe(true);
    expect(paths.has("src/components/ui/skeleton.tsx")).toBe(true);
    expect(paths.has("src/components/ui/empty-state.tsx")).toBe(true);
  });

  it("composes database + auth + storage + email overlays without conflicts and keeps schema.ts pure", () => {
    const composed = composeScaffold(["auth", "storage", "email"]);
    expect(composed.manifest.profiles).toEqual(["base", "database", "auth", "storage", "email"]);

    const schemaFile = composed.files.find((file) => file.path === "src/lib/schema.ts");
    expect(schemaFile).toBeTruthy();
    expect(schemaFile!.content).toMatch(/pgTable\(\s*"user"/);
    expect(schemaFile!.content).toMatch(/pgTable\(\s*"session"/);
    expect(schemaFile!.content).toMatch(/pgTable\(\s*"account"/);
    expect(schemaFile!.content).toMatch(/pgTable\(\s*"verification"/);
    expect(schemaFile!.content).not.toContain('import "server-only"');
    expect(schemaFile!.content).not.toContain("@/");

    const drizzleConfig = composed.files.find((file) => file.path === "drizzle.config.ts");
    expect(drizzleConfig?.content).toContain('process.loadEnvFile(".env.local")');

    const storageFile = composed.files.find((file) => file.path === "src/lib/storage.ts");
    expect(storageFile?.content).toContain('requestChecksumCalculation: "WHEN_REQUIRED"');
    expect(storageFile?.content).toContain('responseChecksumValidation: "WHEN_REQUIRED"');
    expect(storageFile?.content).toContain("forcePathStyle: true");
  });

  it("selects minimal profiles from plain-English prompts and protects existing projects", () => {
    expect(selectScaffoldProfilesForPrompt("Build a clean static pomodoro timer")).toEqual(["base"]);
    expect(selectScaffoldProfilesForPrompt("Build a SaaS dashboard with login and image uploads")).toEqual([
      "base",
      "database",
      "auth",
      "storage",
    ]);

    expect(isEligibleForNewProjectScaffold([])).toBe(true);
    expect(isEligibleForNewProjectScaffold(["public/__cognix_visual_edit.js", ".env.local"])).toBe(true);
    expect(isEligibleForNewProjectScaffold(["package.json", "src/app/page.tsx"])).toBe(false);
    expect(isEligibleForNewProjectScaffold(["./package.json"])).toBe(false);
  });

  it("blocks any scaffold file containing credentials or host service keys", () => {
    expect(() =>
      assertScaffoldContainsNoSecrets([{ path: "src/lib/bad.ts", content: "const k = 'bk_1234567890abcdef';" }]),
    ).toThrow(/secret-scan failed/);
    expect(() =>
      assertScaffoldContainsNoSecrets([
        { path: "src/lib/bad.ts", content: "const u = 'postgresql://user:pass@ep-1.neon.tech/db';" },
      ]),
    ).toThrow(/secret-scan failed/);
  });

  it("keeps every generated TypeScript and TSX scaffold file syntactically valid", () => {
    const composed = composeScaffold(["auth", "storage", "email"]);
    const diagnostics = composed.files
      .filter((file) => /\.tsx?$/.test(file.path))
      .flatMap((file) => {
        const result = ts.transpileModule(file.content, {
          fileName: file.path,
          reportDiagnostics: true,
          compilerOptions: {
            jsx: ts.JsxEmit.Preserve,
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
        });
        return (result.diagnostics ?? [])
          .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
          .map((diagnostic) => `${file.path}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
      });

    expect(diagnostics).toEqual([]);
  });
});
