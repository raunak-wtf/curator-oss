import { describe, expect, it } from "vitest";
import {
  buildConsoleFixPrompt,
  computeConsoleFingerprint,
  extractServerErrorsFromLog,
  isIgnorableConsoleError,
  redactConsoleSecrets,
  selectActionableConsoleErrors,
} from "./preview-console";
import type { PreviewConsoleEntry } from "./types";

describe("redactConsoleSecrets", () => {
  it("redacts PostgreSQL URLs, storage/email API keys, bearer tokens, and project secret values", () => {
    const raw = [
      "Connected to postgresql://neondb_owner:supersecret123@ep-cool-sky.aws.neon.tech/neondb?sslmode=require",
      "Auth header: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secretpayload",
      "Keys: bk_live_1234567890abcdef re_abcdef1234567890 AKIAIOSFODNN7EXAMPLE",
      "Custom secret: my-better-auth-secret-val",
    ].join("\n");

    const clean = redactConsoleSecrets(raw, ["my-better-auth-secret-val"]);
    expect(clean).toContain("postgresql://[REDACTED]");
    expect(clean).not.toContain("supersecret123");
    expect(clean).toContain("Bearer [REDACTED]");
    expect(clean).toContain("bk_[REDACTED]");
    expect(clean).toContain("re_[REDACTED]");
    expect(clean).toContain("AKIA[REDACTED]");
    expect(clean).not.toContain("my-better-auth-secret-val");
    expect(clean).toContain("Custom secret: [REDACTED]");
  });
});

describe("extractServerErrorsFromLog", () => {
  it("extracts Next.js runtime errors, PostgresError stack blocks, and HTTP 500 route failures while ignoring 200/404 noise", () => {
    const serverLog = [
      "▲ Next.js 16.2.10 (Turbopack)",
      "✓ Ready in 620ms",
      " GET / 200 in 140ms",
      " GET /favicon.ico 404 in 12ms",
      " GET /sw.js 404 in 9ms",
      "⨯ PostgresError: relation \"projects\" does not exist",
      "    at Object.handler (src/app/api/projects/route.ts:18:12)",
      "    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)",
      " POST /api/projects 500 in 84ms",
    ].join("\n");

    const extracted = extractServerErrorsFromLog(serverLog);
    expect(extracted.length).toBeGreaterThanOrEqual(1);
    expect(extracted.some((item) => item.message.includes('relation "projects" does not exist'))).toBe(true);
    expect(extracted.some((item) => item.message.includes("POST /api/projects returned HTTP 500"))).toBe(true);
    expect(extracted.some((item) => item.message.includes("favicon.ico"))).toBe(false);
  });
});

describe("selectActionableConsoleErrors & buildConsoleFixPrompt", () => {
  it("deduplicates matching fingerprints, respects baseline/dismissed filters, and formats a structured fix prompt", () => {
    const fp = computeConsoleFingerprint({
      source: "network",
      level: "error",
      message: "POST /api/auth/sign-up/email → HTTP 500 (DATABASE_URL is not set)",
      statusCode: 500,
    });
    const entries: PreviewConsoleEntry[] = [
      {
        id: "1",
        projectId: "proj-1",
        source: "browser",
        level: "error",
        message: "ResizeObserver loop completed with undelivered notifications.",
        stack: null,
        route: "/",
        statusCode: null,
        fingerprint: "benign",
        repeatCount: 1,
        createdAt: "2026-11-27T10:00:00.000Z",
      },
      {
        id: "2",
        projectId: "proj-1",
        source: "network",
        level: "error",
        message: "POST /api/auth/sign-up/email → HTTP 500 (DATABASE_URL is not set)",
        stack: "Error: DATABASE_URL is not set\n    at src/lib/db.ts:7:11",
        route: "/sign-up",
        statusCode: 500,
        fingerprint: fp,
        repeatCount: 2,
        createdAt: "2026-11-27T10:05:00.000Z",
      },
    ];

    expect(isIgnorableConsoleError(entries[0])).toBe(true);
    const actionable = selectActionableConsoleErrors(entries);
    expect(actionable).toHaveLength(1);
    expect(actionable[0].statusCode).toBe(500);

    expect(
      selectActionableConsoleErrors(entries, { dismissedFingerprints: new Set([fp]) }),
    ).toHaveLength(0);

    const fixPrompt = buildConsoleFixPrompt(actionable, 2);
    expect(fixPrompt).toContain("Fix this runtime error detected in the live app preview");
    expect(fixPrompt).toContain("HTTP 500");
    expect(fixPrompt).toContain("route: /sign-up");
    expect(fixPrompt).toContain("read_preview_console");
    expect(fixPrompt).toContain("previous fix attempt did not clear this runtime error");
  });
});
