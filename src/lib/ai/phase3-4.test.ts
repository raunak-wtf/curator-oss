import { describe, expect, it } from "vitest";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  compactAgentMessages,
  shouldCompactContext,
  truncateCommandOutputDeterministically,
  type CompactionState,
} from "./context-compaction";
import {
  parseBuildDiagnostics,
} from "./diagnostic-parser";
import { createAgentLoopGuard, resolveAdaptiveTurnBudget } from "./loop-guard";

const baseBudgetInput = {
  mode: "build" as const,
  prompt: "Build a marketing site with several sections",
  isNewProject: true,
  cloudFeaturesCount: 0,
  hasVisualSelections: false,
};

describe("resolveAdaptiveTurnBudget", () => {
  it("uses plan budgets for plan mode", () => {
    expect(
      resolveAdaptiveTurnBudget({ ...baseBudgetInput, mode: "plan", prompt: "" }),
    ).toEqual({ softBudget: 12, hardBudget: 18, category: "plan" });
  });

  it("uses security budgets for security mode", () => {
    expect(
      resolveAdaptiveTurnBudget({ ...baseBudgetInput, mode: "security", prompt: "" }),
    ).toEqual({ softBudget: 14, hardBudget: 24, category: "security" });
  });

  it("uses repair budgets for error repair runs", () => {
    expect(
      resolveAdaptiveTurnBudget({ ...baseBudgetInput, isErrorRepair: true }),
    ).toEqual({ softBudget: 10, hardBudget: 16, category: "repair" });
  });

  it("prefers repair over localized edit", () => {
    expect(
      resolveAdaptiveTurnBudget({
        ...baseBudgetInput,
        isNewProject: false,
        hasVisualSelections: true,
        isErrorRepair: true,
      }),
    ).toEqual({ softBudget: 10, hardBudget: 16, category: "repair" });
  });

  it("classifies localized edits on existing projects", () => {
    expect(
      resolveAdaptiveTurnBudget({
        ...baseBudgetInput,
        isNewProject: false,
        prompt: "short",
        hasVisualSelections: false,
      }),
    ).toEqual({ softBudget: 12, hardBudget: 16, category: "localized_edit" });
    expect(
      resolveAdaptiveTurnBudget({
        ...baseBudgetInput,
        isNewProject: false,
        hasVisualSelections: true,
        prompt: "x".repeat(400),
      }),
    ).toEqual({ softBudget: 12, hardBudget: 16, category: "localized_edit" });
  });

  it("does not classify new projects as localized edits even with short prompts", () => {
    expect(
      resolveAdaptiveTurnBudget({ ...baseBudgetInput, prompt: "short" }),
    ).toEqual({ softBudget: 16, hardBudget: 22, category: "frontend_new" });
  });

  it("classifies fullstack new projects when cloud features are requested", () => {
    expect(
      resolveAdaptiveTurnBudget({ ...baseBudgetInput, cloudFeaturesCount: 2 }),
    ).toEqual({ softBudget: 20, hardBudget: 30, category: "fullstack_new" });
  });

  it("keeps the localized-edit classification ahead of cloud features", () => {
    expect(
      resolveAdaptiveTurnBudget({
        ...baseBudgetInput,
        isNewProject: false,
        prompt: "tiny",
        cloudFeaturesCount: 3,
      }),
    ).toEqual({ softBudget: 12, hardBudget: 16, category: "localized_edit" });
  });

  it("falls back to frontend_new", () => {
    expect(resolveAdaptiveTurnBudget(baseBudgetInput)).toEqual({
      softBudget: 16,
      hardBudget: 22,
      category: "frontend_new",
    });
  });
});

describe("createAgentLoopGuard", () => {
  it("detects unchanged rereads and warns on repetition", () => {
    const guard = createAgentLoopGuard();
    const first = guard.recordFileRead("src/app/page.tsx", "export default function Page() {}");
    expect(first.isUnchangedReread).toBe(false);
    expect(first.rereadCount).toBe(0);
    expect(typeof first.hash).toBe("string");

    const second = guard.recordFileRead("src/app/page.tsx", "export default function Page() {}");
    expect(second.isUnchangedReread).toBe(true);
    expect(second.rereadCount).toBe(1);
    expect(second.warning).toContain("src/app/page.tsx");
    expect(guard.stats().unchangedFileRereads).toBe(1);
  });

  it("tracks reads per range key and treats changed content as a fresh read", () => {
    const guard = createAgentLoopGuard();
    guard.recordFileRead("src/lib/db.ts", "const a = 1;");
    const changed = guard.recordFileRead("src/lib/db.ts", "const a = 2;");
    expect(changed.isUnchangedReread).toBe(false);

    const rangeRead = guard.recordFileRead("src/lib/db.ts", "const a = 2;", "lines:10-40");
    expect(rangeRead.isUnchangedReread).toBe(false);

    const rangeReread = guard.recordFileRead("src/lib/db.ts", "const a = 2;", "lines:10-40");
    expect(rangeReread.isUnchangedReread).toBe(true);
  });

  it("invalidates cached reads after mutation via invalidateFile and invalidateAllFiles", () => {
    const guard = createAgentLoopGuard();
    guard.recordFileRead("src/app/page.tsx", "v1");
    guard.invalidateFile("src/app/page.tsx");
    const afterInvalidate = guard.recordFileRead("src/app/page.tsx", "v1");
    expect(afterInvalidate.isUnchangedReread).toBe(false);

    guard.recordFileRead("src/components/a.tsx", "v1", "range-a");
    guard.recordFileRead("src/components/b.tsx", "v1");
    guard.invalidateAllFiles();
    expect(guard.recordFileRead("src/components/a.tsx", "v1", "range-a").isUnchangedReread).toBe(false);
    expect(guard.recordFileRead("src/components/b.tsx", "v1").isUnchangedReread).toBe(false);
  });

  it("clears range-keyed cache entries when invalidating by path", () => {
    const guard = createAgentLoopGuard();
    guard.recordFileRead("src/lib/store.ts", "content", "lines:1-50");
    guard.invalidateFile("src/lib/store.ts");
    expect(guard.recordFileRead("src/lib/store.ts", "content", "lines:1-50").isUnchangedReread).toBe(false);
  });

  it("flags repeated commands and identical failure streaks", () => {
    const guard = createAgentLoopGuard();
    const first = guard.recordCommand("npm run build", 1, "TS2322");
    expect(first.repeated).toBe(false);
    expect(first.identicalFailureStreak).toBe(1);

    const second = guard.recordCommand("npm run build", 1, "TS2322");
    expect(second.repeated).toBe(true);
    expect(second.identicalFailureStreak).toBe(2);
    expect(second.warning).toContain("failed identically");
    expect(guard.stats().repeatedCommands).toBe(1);
    expect(guard.stats().maxErrorStreak).toBe(2);
  });

  it("resets the failure streak when the failure signature changes", () => {
    const guard = createAgentLoopGuard();
    guard.recordCommand("npm run build", 1, "TS2322");
    guard.recordCommand("npm run build", 1, "TS2322");
    const changed = guard.recordCommand("npm run build", 1, "MODULE_NOT_FOUND");
    expect(changed.identicalFailureStreak).toBe(1);
    expect(guard.stats().maxErrorStreak).toBe(2);
  });

  it("does not count successful repeats as failure streaks", () => {
    const guard = createAgentLoopGuard();
    guard.recordCommand("npm run build", 0);
    const repeat = guard.recordCommand("npm run build", 0);
    expect(repeat.repeated).toBe(true);
    expect(repeat.identicalFailureStreak).toBe(0);
    expect(guard.stats().maxErrorStreak).toBe(0);
  });

  it("flags repeated preview checks regardless of route order", () => {
    const guard = createAgentLoopGuard();
    const first = guard.recordPreviewCheck(["/", "/about"]);
    expect(first.repeated).toBe(false);

    const second = guard.recordPreviewCheck(["/about", "/"]);
    expect(second.repeated).toBe(true);
    expect(second.warning).toContain("already checked");
    expect(guard.stats().repeatedPreviewChecks).toBe(1);
  });

  it("treats different route sets as distinct checks", () => {
    const guard = createAgentLoopGuard();
    guard.recordPreviewCheck(["/"]);
    expect(guard.recordPreviewCheck(["/dashboard"]).repeated).toBe(false);
  });
});

describe("shouldCompactContext", () => {
  it("does not compact before turn 6", () => {
    expect(
      shouldCompactContext({
        turn: 5,
        turnsSinceLastCompaction: 10,
        estimatedChars: 200_000,
        lastToolResultChars: 50_000,
      }),
    ).toBe(false);
  });

  it("compacts when turn budget thresholds are hit", () => {
    expect(
      shouldCompactContext({ turn: 6, turnsSinceLastCompaction: 6, estimatedChars: 0, lastToolResultChars: 0 }),
    ).toBe(true);
    expect(
      shouldCompactContext({ turn: 6, turnsSinceLastCompaction: 0, estimatedChars: 0, lastToolResultChars: 24_000 }),
    ).toBe(true);
    expect(
      shouldCompactContext({ turn: 6, turnsSinceLastCompaction: 0, estimatedChars: 90_000, lastToolResultChars: 0 }),
    ).toBe(true);
  });

  it("honors a custom char threshold", () => {
    expect(
      shouldCompactContext({
        turn: 6,
        turnsSinceLastCompaction: 0,
        estimatedChars: 30_000,
        lastToolResultChars: 0,
        charThreshold: 20_000,
      }),
    ).toBe(true);
    expect(
      shouldCompactContext({ turn: 6, turnsSinceLastCompaction: 0, estimatedChars: 30_000, lastToolResultChars: 0 }),
    ).toBe(false);
  });
});

describe("truncateCommandOutputDeterministically", () => {
  it("returns short output unchanged", () => {
    expect(truncateCommandOutputDeterministically("ok")).toBe("ok");
  });

  it("truncates long output while keeping head, tail, and diagnostic lines", () => {
    const filler = "filler line that is not diagnostic\n".repeat(400);
    const output = `head line\n${filler}src/app/page.tsx(12,5): error TS2322: Type 'string' is not assignable to type 'number'\n${filler}Failed to compile.\n${filler}tail line\n`;
    const truncated = truncateCommandOutputDeterministically(output, 2_000);
    expect(truncated.length).toBeLessThan(output.length);
    expect(truncated).toContain("output head");
    expect(truncated).toContain("output tail");
    expect(truncated).toContain("error TS2322");
    expect(truncated).toContain("Failed to compile");
    expect(truncated).toContain("head line");
    expect(truncated).toContain("tail line");
  });

  it("extracts stack frames from runtime errors", () => {
    const filler = "x".repeat(100) + "\n";
    const output = `${filler.repeat(80)}TypeError: Cannot read properties of undefined (reading 'map')\n    at renderList (src/components/list.tsx:10:17)\n    at Page (src/app/page.tsx:5:3)\n${filler.repeat(80)}`;
    const truncated = truncateCommandOutputDeterministically(output, 1_500);
    expect(truncated).toContain("TypeError");
    expect(truncated).toContain("at renderList");
  });
});

const baseState: CompactionState = {
  originalPrompt: "Build a task manager with auth",
  mode: "build",
  changedFiles: [{ path: "src/app/page.tsx", hash: "abc123def456" }],
  unresolvedErrors: ["error TS2322 in src/app/page.tsx"],
  verifiedChecks: [],
  constraints: ["Use the App Router"],
};

function toolMessage(id: string): ChatCompletionMessageParam {
  return { role: "tool", tool_call_id: id, content: "tool output" };
}

function assistantToolCallMessage(id: string): ChatCompletionMessageParam {
  return {
    role: "assistant",
    content: null,
    tool_calls: [{ id, type: "function", function: { name: "read_file", arguments: "{}" } }],
  };
}

describe("compactAgentMessages", () => {
  it("keeps the system message, a compaction summary, and the recent messages", () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: "You are a builder agent." },
      { role: "user", content: "Build it" },
      { role: "assistant", content: "Working on it" },
      { role: "user", content: "Keep going" },
      { role: "assistant", content: "Almost done" },
      { role: "user", content: "Finish" },
      { role: "assistant", content: "Done" },
    ];
    const compacted = compactAgentMessages(messages, baseState, 3);
    expect(compacted[0]).toEqual({ role: "system", content: "You are a builder agent." });
    expect(compacted[1]?.role).toBe("user");
    const summary = String(compacted[1]?.content ?? "");
    expect(summary).toContain("<context-compaction>");
    expect(summary).toContain("Build a task manager with auth");
    expect(summary).toContain("src/app/page.tsx");
    expect(summary).toContain("error TS2322 in src/app/page.tsx");
    expect(summary).toContain("Use the App Router");
    expect(compacted).toHaveLength(1 + 1 + 3);
    expect(compacted.at(-1)).toEqual({ role: "assistant", content: "Done" });
  });

  it("never fabricates verified checks", () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "go" },
      { role: "assistant", content: "ok" },
    ];
    const compacted = compactAgentMessages(messages, { ...baseState, verifiedChecks: [] });
    const summary = String(compacted.find((message) => message.role === "user" && typeof message.content === "string")?.content ?? "");
    expect(summary).toContain("None verified yet");
  });

  it("lists verified checks when present", () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "go" },
      { role: "assistant", content: "ok" },
    ];
    const compacted = compactAgentMessages(messages, {
      ...baseState,
      verifiedChecks: ["npm run build passed"],
    });
    const summary = String(compacted.find((message) => message.role === "user" && typeof message.content === "string")?.content ?? "");
    expect(summary).toContain("npm run build passed");
    expect(summary).not.toContain("None verified yet");
  });

  it("drops leading orphaned tool messages whose assistant caller was compacted away", () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "go" },
      assistantToolCallMessage("call-1"),
      toolMessage("call-1"),
      assistantToolCallMessage("call-2"),
      toolMessage("call-2"),
      { role: "assistant", content: "final answer" },
    ];
    const compacted = compactAgentMessages(messages, baseState, 3);
    expect(compacted[0]?.role).toBe("system");
    const afterSummary = compacted.slice(2);
    expect(afterSummary[0]?.role).not.toBe("tool");
    const orphanedIds = new Set(["call-1"]);
    for (const message of afterSummary) {
      if (message.role === "tool") {
        expect(orphanedIds.has(message.tool_call_id)).toBe(false);
      }
      if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
        for (const call of message.tool_calls) {
          const hasMatchingTool = afterSummary.some(
            (candidate) => candidate.role === "tool" && candidate.tool_call_id === call.id,
          );
          expect(hasMatchingTool).toBe(true);
        }
      }
    }
    expect(compacted.at(-1)).toEqual({ role: "assistant", content: "final answer" });
  });

  it("keeps a leading tool message when its assistant caller is retained", () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "go" },
      { role: "assistant", content: "older" },
      assistantToolCallMessage("call-1"),
      toolMessage("call-1"),
      { role: "assistant", content: "after tool" },
    ];
    const compacted = compactAgentMessages(messages, baseState, 3);
    const afterSummary = compacted.slice(2);
    expect(afterSummary).toHaveLength(3);
    const toolIds = new Set(
      afterSummary.filter((message) => message.role === "tool").map((message) => message.tool_call_id),
    );
    const callIds = new Set(
      afterSummary
        .filter((message): message is Extract<ChatCompletionMessageParam, { role: "assistant" }> =>
          message.role === "assistant" && Array.isArray(message.tool_calls),
        )
        .flatMap((message) => (message.tool_calls ?? []).map((call) => call.id)),
    );
    for (const id of toolIds) {
      expect(callIds.has(id)).toBe(true);
    }
  });

  it("handles messages without a system message", () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: "user", content: "go" },
      { role: "assistant", content: "ok" },
    ];
    const compacted = compactAgentMessages(messages, baseState, 2);
    expect(compacted[0]?.role).toBe("user");
    expect(String(compacted[0]?.content)).toContain("<context-compaction>");
    expect(compacted.at(-1)).toEqual({ role: "assistant", content: "ok" });
  });

  it("handles an empty message list", () => {
    const compacted = compactAgentMessages([], baseState);
    expect(compacted).toHaveLength(1);
    expect(String(compacted[0]?.content)).toContain("<context-compaction>");
  });
});

describe("parseBuildDiagnostics", () => {
  it("parses tsc-style TypeScript errors", () => {
    const output = [
      "Building the app…",
      "src/app/page.tsx(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
    ].join("\n");
    const [diagnostic] = parseBuildDiagnostics(output);
    expect(diagnostic).toEqual({
      category: "typescript",
      code: "TS2322",
      filePath: "src/app/page.tsx",
      line: 12,
      message: "Type 'string' is not assignable to type 'number'.",
      suggestedFix: expect.stringContaining("TS2322"),
    });
  });

  it("parses vite-style TypeScript errors", () => {
    const output = "src/lib/utils.ts:4:19 - error TS2339: Property 'id' does not exist on type 'Task'.";
    const [diagnostic] = parseBuildDiagnostics(output);
    expect(diagnostic?.category).toBe("typescript");
    expect(diagnostic?.code).toBe("TS2339");
    expect(diagnostic?.filePath).toBe("src/lib/utils.ts");
    expect(diagnostic?.line).toBe(4);
  });

  it("parses Next.js client-boundary errors", () => {
    const output = `You're importing a component that needs useState. It only works in a Client Component but the parent component ("src/components/form.tsx") it's rendered in is a Server Component.`;
    const [diagnostic] = parseBuildDiagnostics(output);
    expect(diagnostic?.category).toBe("nextjs");
    expect(diagnostic?.code).toBe("client-boundary");
    expect(diagnostic?.filePath).toBe("src/components/form.tsx");
    expect(diagnostic?.suggestedFix).toContain('"use client"');
  });

  it("parses Next.js dynamic server usage errors", () => {
    const output = 'Error: Dynamic server usage (Route: /dashboard) — fix by adding export const dynamic = "force-dynamic"';
    const [diagnostic] = parseBuildDiagnostics(output);
    expect(diagnostic?.category).toBe("nextjs");
    expect(diagnostic?.code).toBe("dynamic-server-usage");
    expect(diagnostic?.suggestedFix).toContain("force-dynamic");
  });

  it("parses Next.js module-not-found and image errors", () => {
    const output = [
      "Module not found: Can't resolve 'framer-motion'",
      "Error: Invalid src prop (localhost:3000/img.png) on `next/image`, hostname not configured",
    ].join("\n");
    const diagnostics = parseBuildDiagnostics(output);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]?.code).toBe("module-not-found");
    expect(diagnostics[1]?.code).toBe("invalid-image-src");
  });

  it("parses npm dependency errors", () => {
    const output = [
      "npm ERR! code ERESOLVE",
      "npm ERR! While resolving react@19.0.0",
      "npm ERR! code ETARGET",
      "npm ERR! No matching version found for drizzle-orm@99.0.0",
    ].join("\n");
    const diagnostics = parseBuildDiagnostics(output);
    expect(diagnostics.some((diagnostic) => diagnostic.code === "ERESOLVE")).toBe(true);
    expect(diagnostics.some((diagnostic) => diagnostic.code === "ETARGET")).toBe(true);
    expect(diagnostics.every((diagnostic) => diagnostic.category === "dependency")).toBe(true);
  });

  it("parses pnpm errors", () => {
    const diagnostics = parseBuildDiagnostics("ERR_PNPM_NO_MATCHING_VERSION");
    expect(diagnostics[0]?.category).toBe("dependency");
    expect(diagnostics[0]?.code).toBe("ERR_PNPM_NO_MATCHING_VERSION");
  });

  it("parses drizzle config, server-only, and missing relation errors", () => {
    const output = [
      "Error: Cannot read properties of undefined (reading 'dialect') in drizzle.config.ts",
      "Error: Attempted import of 'server-only' from a client component",
      'error: relation "tasks" does not exist',
    ].join("\n");
    const diagnostics = parseBuildDiagnostics(output);
    const codes = diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain("drizzle-config");
    expect(codes).toContain("server-only");
    expect(codes).toContain("relation-missing");
    expect(diagnostics.every((diagnostic) => diagnostic.category === "drizzle")).toBe(true);
  });

  it("parses runtime errors", () => {
    const diagnostics = parseBuildDiagnostics([
      "TypeError: Cannot read properties of undefined (reading 'map')",
      "SyntaxError: Unexpected token '}'",
      "ReferenceError: tasks is not defined",
    ].join("\n"));
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["TypeError", "SyntaxError", "ReferenceError"]);
    expect(diagnostics.every((diagnostic) => diagnostic.category === "runtime")).toBe(true);
  });

  it("deduplicates identical diagnostics", () => {
    const line = "src/app/page.tsx(12,5): error TS2322: Type 'string' is not assignable to type 'number'.";
    const diagnostics = parseBuildDiagnostics(`${line}\n${line}\n${line}`);
    expect(diagnostics).toHaveLength(1);
  });

  it("caps results to maxItems", () => {
    const lines = Array.from(
      { length: 30 },
      (_, index) => `src/app/file${index}.tsx(1,1): error TS2304: Cannot find name 'x${index}'.`,
    );
    const diagnostics = parseBuildDiagnostics(lines.join("\n"), 5);
    expect(diagnostics).toHaveLength(5);
  });

  it("returns an empty list for clean output", () => {
    expect(parseBuildDiagnostics("✓ Compiled successfully\n")).toEqual([]);
  });
});
