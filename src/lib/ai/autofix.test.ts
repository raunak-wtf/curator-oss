import { describe, expect, it } from "vitest";
import {
  autofixDrizzleConfigEnvLoad,
  autofixMissingUseClientDirective,
  autofixS3ClientChecksums,
  autofixSchemaServerOnlyImport,
  buildDeterministicCommitMessage,
  computeSafeAutofixes,
} from "./autofix";

const DRIZZLE_CONFIG = `import { defineConfig } from "drizzle-kit";

export default defineConfig({
  url: process.env.DATABASE_URL!,
});
`;

const SCHEMA_WITH_SERVER_ONLY = `import "server-only";
import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
});
`;

const COMPONENT = 'import { useState } from "react";\n\nexport function Counter() {\n  const [n, setN] = useState(0);\n  return <button onClick={() => setN(n + 1)}>{n}</button>;\n}\n';
const DIAGNOSTIC = `./src/app/counter.tsx
React Server Components.

You're importing a component that needs useState. It only works in a Client Component but is being rendered on the server.
Move it to a "use client" file.`;

describe("autofixDrizzleConfigEnvLoad", () => {
  it("prepends guarded .env.local load to drizzle.config.ts", () => {
    const patch = autofixDrizzleConfigEnvLoad("drizzle.config.ts", DRIZZLE_CONFIG);
    expect(patch).not.toBeNull();
    expect(patch!.after).toMatch(/^import \{ existsSync \} from "node:fs";\n/);
    expect(patch!.after).toContain('if (existsSync(".env.local")) process.loadEnvFile(".env.local");\n');
    expect(patch!.after.endsWith(DRIZZLE_CONFIG)).toBe(true);
    expect(patch!.before).toBe(DRIZZLE_CONFIG);
    expect(patch!.rule).toBe("drizzle-config-env-load");
  });

  it("also matches drizzle.config.mjs and DIRECT_URL", () => {
    const patch = autofixDrizzleConfigEnvLoad(
      "nested/drizzle.config.mjs",
      `export default { dbCredentials: { url: process.env.DIRECT_URL } };`,
    );
    expect(patch).not.toBeNull();
    expect(patch!.after).toContain("process.loadEnvFile");
  });

  it("returns null when no DATABASE_URL/DIRECT_URL is referenced", () => {
    expect(autofixDrizzleConfigEnvLoad("drizzle.config.ts", `export default { url: "postgres://localhost" };`)).toBeNull();
  });

  it("returns null when a dotenv import already loads env files", () => {
    expect(autofixDrizzleConfigEnvLoad("drizzle.config.ts", `import "dotenv/config";\n${DRIZZLE_CONFIG}`)).toBeNull();
  });

  it("returns null when loadEnvFile is already called", () => {
    expect(
      autofixDrizzleConfigEnvLoad("drizzle.config.ts", `process.loadEnvFile(".env.local");\n${DRIZZLE_CONFIG}`),
    ).toBeNull();
  });

  it("ignores unrelated file paths", () => {
    expect(autofixDrizzleConfigEnvLoad("src/lib/db.ts", DRIZZLE_CONFIG)).toBeNull();
    expect(autofixDrizzleConfigEnvLoad("drizzle.config.js", DRIZZLE_CONFIG)).toBeNull();
  });
});

describe("autofixSchemaServerOnlyImport", () => {
  it("removes the server-only import line from schema.ts", () => {
    const patch = autofixSchemaServerOnlyImport("src/db/schema.ts", SCHEMA_WITH_SERVER_ONLY);
    expect(patch).not.toBeNull();
    expect(patch!.after).not.toContain("server-only");
    expect(patch!.after).toContain("pgTable(");
    expect(patch!.after.startsWith("import { integer, pgTable")).toBe(true);
    expect(patch!.before).toBe(SCHEMA_WITH_SERVER_ONLY);
  });

  it("handles single quotes and missing semicolon", () => {
    const patch = autofixSchemaServerOnlyImport("schema.ts", `import 'server-only'\nexport const x = pgTable("x", {});\n`);
    expect(patch).not.toBeNull();
    expect(patch!.after).not.toContain("server-only");
  });

  it("returns null for schema.ts without the import", () => {
    const content = SCHEMA_WITH_SERVER_ONLY.replace('import "server-only";\n', "");
    expect(autofixSchemaServerOnlyImport("src/db/schema.ts", content)).toBeNull();
  });

  it("returns null for non-schema.ts files even with the bad import and pgTable", () => {
    expect(autofixSchemaServerOnlyImport("src/db/tables.ts", SCHEMA_WITH_SERVER_ONLY)).toBeNull();
    expect(autofixSchemaServerOnlyImport("src/db/schema.test.ts", SCHEMA_WITH_SERVER_ONLY)).toBeNull();
  });

  it("returns null for schema.ts without pgTable", () => {
    expect(autofixSchemaServerOnlyImport("src/db/schema.ts", 'import "server-only";\nexport const x = 1;\n')).toBeNull();
  });
});

describe("autofixS3ClientChecksums", () => {
  const MULTILINE = `import { S3Client } from "@aws-sdk/client-s3";

export const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
});
`;

  it("inserts both checksum options into a multiline S3Client", () => {
    const patch = autofixS3ClientChecksums("src/lib/storage.ts", MULTILINE);
    expect(patch).not.toBeNull();
    expect(patch!.after).toContain('new S3Client({ requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",');
    expect(patch!.after).toContain("forcePathStyle: true");
    expect(patch!.after).toContain("region: \"auto\"");
    expect(patch!.before).toBe(MULTILINE);
  });

  it("inserts only the missing option", () => {
    const content = MULTILINE.replace("forcePathStyle: true", 'forcePathStyle: true, requestChecksumCalculation: "WHEN_REQUIRED"');
    const patch = autofixS3ClientChecksums("src/lib/storage.ts", content);
    expect(patch).not.toBeNull();
    expect(patch!.after).toContain('responseChecksumValidation: "WHEN_REQUIRED"');
    expect((patch!.after.match(/WHEN_REQUIRED/g) ?? []).length).toBe(2);
  });

  it("returns null when both options are already present", () => {
    const content = MULTILINE.replace(
      "forcePathStyle: true",
      'forcePathStyle: true, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED"',
    );
    expect(autofixS3ClientChecksums("src/lib/storage.ts", content)).toBeNull();
  });

  it("returns null for S3Client without path-style/self-hosted endpoint", () => {
    const content = `const s3 = new S3Client({ region: "us-east-1" });\n`;
    expect(autofixS3ClientChecksums("src/lib/storage.ts", content)).toBeNull();
  });

  it("returns null for files without an inline options object", () => {
    expect(autofixS3ClientChecksums("src/lib/storage.ts", "const options = {};\nconst s3 = new S3Client();\n")).toBeNull();
    expect(autofixS3ClientChecksums("src/lib/storage.ts", "const s3 = new S3Client(options);\n")).toBeNull();
  });

  it("returns null for files without any S3Client", () => {
    expect(autofixS3ClientChecksums("src/lib/storage.ts", "export const x = 1;\n")).toBeNull();
  });

  it("ignores non-code paths", () => {
    expect(autofixS3ClientChecksums("README.md", MULTILINE)).toBeNull();
  });
});

describe("autofixMissingUseClientDirective", () => {

  it('prepends "use client" when the diagnostic names the file and the client-component error', () => {
    const patch = autofixMissingUseClientDirective("src/app/counter.tsx", COMPONENT, DIAGNOSTIC);
    expect(patch).not.toBeNull();
    expect(patch!.after.startsWith('"use client";\n\n')).toBe(true);
    expect(patch!.after.endsWith(COMPONENT)).toBe(true);
    expect(patch!.before).toBe(COMPONENT);
  });

  it("matches the event-handler diagnostic too", () => {
    const diagnostic = `Error: src/app/form.tsx
Event handlers cannot be passed to Client Component props.`;
    const patch = autofixMissingUseClientDirective("src/app/form.tsx", COMPONENT, diagnostic);
    expect(patch).not.toBeNull();
    expect(patch!.after.startsWith('"use client"')).toBe(true);
  });

  it("returns null when the diagnostic does not mention this file", () => {
    expect(autofixMissingUseClientDirective("src/app/other.tsx", COMPONENT, DIAGNOSTIC)).toBeNull();
  });

  it("returns null when the diagnostic lacks a client-component error", () => {
    const diagnostic = "./src/app/counter.tsx\nType error: cannot find module 'left-pad'.";
    expect(autofixMissingUseClientDirective("src/app/counter.tsx", COMPONENT, diagnostic)).toBeNull();
  });

  it("returns null with no diagnostic output", () => {
    expect(autofixMissingUseClientDirective("src/app/counter.tsx", COMPONENT, "")).toBeNull();
  });

  it('returns null when the file already starts with "use client" or "use server"', () => {
    const useClient = `"use client";\n\n${COMPONENT}`;
    expect(autofixMissingUseClientDirective("src/app/counter.tsx", useClient, DIAGNOSTIC)).toBeNull();
    const useServer = `'use server';\n\nexport const x = 1;\n`;
    expect(autofixMissingUseClientDirective("src/app/counter.tsx", useServer, DIAGNOSTIC)).toBeNull();
  });

  it("returns null for non-tsx/jsx files even with a matching diagnostic", () => {
    expect(autofixMissingUseClientDirective("src/app/counter.ts", COMPONENT, DIAGNOSTIC)).toBeNull();
  });
});

describe("computeSafeAutofixes", () => {
  it("collects patches from every applicable rule in order", () => {
    const patches = computeSafeAutofixes(
      [
        { path: "src/db/schema.ts", content: SCHEMA_WITH_SERVER_ONLY },
        { path: "drizzle.config.ts", content: DRIZZLE_CONFIG },
        { path: "src/lib/storage.ts", content: `const s3 = new S3Client({ region: "auto", endpoint: process.env.S3_ENDPOINT });` },
      ],
      "",
    );
    expect(patches.map((p) => p.rule)).toEqual([
      "schema-server-only-import",
      "drizzle-config-env-load",
      "s3-client-checksums",
    ]);
    expect(patches.every((p) => p.after !== p.before)).toBe(true);
  });

  it("passes diagnostics to the use-client rule", () => {
    const patches = computeSafeAutofixes(
      [{ path: "src/app/counter.tsx", content: COMPONENT }],
      "./src/app/counter.tsx only works in a Client Component",
    );
    expect(patches).toHaveLength(1);
    expect(patches[0]!.rule).toBe("missing-use-client-directive");
  });

  it("returns an empty array for clean or unrelated files", () => {
    expect(computeSafeAutofixes([{ path: "src/app/page.tsx", content: "export default function Page() {}\n" }])).toEqual([]);
    expect(computeSafeAutofixes([{ path: "README.md", content: "hello" }])).toEqual([]);
  });

  it("leaves healthy files untouched", () => {
    const files = [
      { path: "drizzle.config.ts", content: `import "dotenv/config";\n${DRIZZLE_CONFIG}` },
      { path: "src/db/schema.ts", content: SCHEMA_WITH_SERVER_ONLY.replace('import "server-only";\n', "") },
    ];
    expect(computeSafeAutofixes(files)).toEqual([]);
  });
});

describe("buildDeterministicCommitMessage", () => {
  it("builds a feat commit from a normal request", () => {
    const message = buildDeterministicCommitMessage({
      request: "Add a pricing page with three plan cards",
      changedPaths: ["src/app/pricing/page.tsx", "src/app/pricing/plans.tsx"],
    });
    expect(message).toBe("feat: add a pricing page with three plan cards\n\n- src/app/pricing/page.tsx\n- src/app/pricing/plans.tsx");
  });

  it("infers fix from the request", () => {
    const message = buildDeterministicCommitMessage({
      request: "fix the broken signup flow",
      changedPaths: ["src/app/signup/page.tsx"],
    });
    expect(message.split("\n")[0]).toBe("fix: the broken signup flow");
  });

  it("infers style from the request", () => {
    const message = buildDeterministicCommitMessage({
      request: "adjust the button spacing and font",
      changedPaths: ["src/components/button.tsx"],
    });
    expect(message.split("\n")[0]).toBe("style: adjust the button spacing and font");
  });

  it("uses chore for config-only changes with no request", () => {
    const message = buildDeterministicCommitMessage({
      request: "",
      changedPaths: ["package.json", "drizzle.config.ts"],
    });
    expect(message.split("\n")[0]).toBe("chore: update package.json and drizzle.config.ts");
  });

  it("keeps the subject within 72 characters using an ellipsis", () => {
    const message = buildDeterministicCommitMessage({
      request: "build a comprehensive multi-tenant analytics dashboard with per-workspace usage charts and exportable reports",
      changedPaths: ["src/app/dashboard/page.tsx"],
    });
    const subject = message.split("\n")[0]!;
    expect(subject.length).toBeLessThanOrEqual(72);
    expect(subject.endsWith("…")).toBe(true);
    expect(subject.startsWith("feat: ")).toBe(true);
  });

  it("truncates multi-sentence requests to the first sentence", () => {
    const message = buildDeterministicCommitMessage({
      request: "Add search. Also tweak the footer later please.",
      changedPaths: ["src/app/search.tsx"],
    });
    expect(message.split("\n")[0]).toBe("feat: add search");
  });

  it("collapses duplicate paths and caps the file bullet list", () => {
    const paths = Array.from({ length: 25 }, (_, i) => `src/app/route-${i}.ts`);
    const message = buildDeterministicCommitMessage({
      request: "add many routes",
      changedPaths: [...paths, paths[0]!],
    });
    const lines = message.split("\n");
    expect(lines.filter((line) => line.startsWith("- "))).toHaveLength(20);
    expect(message).toContain("… and 5 more");
    expect(new Set(lines.filter((l) => l.startsWith("- "))).size).toBe(20);
  });

  it("formats subject, blank line, then bullet body", () => {
    const message = buildDeterministicCommitMessage({
      request: "add a settings page",
      changedPaths: ["src/app/settings/page.tsx"],
    });
    const [subject, blank, ...body] = message.split("\n");
    expect(subject).toBe("feat: add a settings page");
    expect(blank).toBe("");
    expect(body).toEqual(["- src/app/settings/page.tsx"]);
  });

  it("handles no changed paths", () => {
    const message = buildDeterministicCommitMessage({ request: "add a settings page", changedPaths: [] });
    expect(message).toBe("feat: add a settings page");
  });

  it("falls back to file-based subjects with no request", () => {
    const message = buildDeterministicCommitMessage({ request: "", changedPaths: ["src/app/page.tsx", "src/lib/x.ts"] });
    expect(message.split("\n")[0]).toBe("feat: update page.tsx and x.ts");
  });
});
