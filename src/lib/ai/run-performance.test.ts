import { describe, expect, it } from "vitest";
import { createRunPerformanceTracker, isAgentRunPerformance } from "./run-performance";

describe("run performance telemetry", () => {
  it("records stage, model, tool, command, and first-preview metrics without payload data", () => {
    const tracker = createRunPerformanceTracker(1_000);
    tracker.enterStage("sandbox", 1_000);
    tracker.enterStage("setup", 1_250);
    tracker.recordModelAttempt();
    tracker.recordModelAttempt();
    tracker.recordModelTurn({
      durationMs: 800,
      messageChars: 12_000,
      promptTokens: 3_000,
      cachedPromptTokens: 500,
      completionTokens: 400,
      toolCalls: 2,
    });
    tracker.recordContextRefresh();
    tracker.markFirstPreview(2_500);
    tracker.enterStage("agent", 1_500);

    const result = tracker.snapshot({
      nowMs: 3_000,
      activities: [
        { id: "a", name: "read_file", label: "Read file", status: "done", durationMs: 120 },
        { id: "b", name: "run_command", label: "Failed", status: "error", durationMs: 300 },
      ],
      commands: {
        count: 3,
        failed: 1,
        durationMs: 900,
        background: 1,
        productionBuilds: 1,
        installs: 1,
        previewStarts: 1,
      },
    });

    expect(result.timeToFirstPreviewMs).toBe(1_500);
    expect(result.stages).toEqual({ sandbox: 250, setup: 250, agent: 1_500 });
    expect(result.model).toMatchObject({ turns: 1, attempts: 2, durationMs: 800, contextRefreshes: 1 });
    expect(result.model.turnMetrics[0]).toMatchObject({ attempts: 2, messageChars: 12_000, cachedPromptTokens: 500 });
    expect(result.tools).toMatchObject({ calls: 2, errors: 1, durationMs: 420, unchangedFileRereads: 0 });
    expect(result.tools.byName.read_file).toEqual({ calls: 1, errors: 0, durationMs: 120 });
    expect(result.commands).toMatchObject({ count: 3, failed: 1, productionBuilds: 1, installs: 1, previewRestarts: 0 });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(isAgentRunPerformance(result)).toBe(true);
    expect(isAgentRunPerformance({})).toBe(false);
  });

  it("tracks nested sub-stages cleanly along with preview restarts and unchanged-file rereads", async () => {
    const tracker = createRunPerformanceTracker(Date.now());
    tracker.enterStage("agent");
    await tracker.withStage("model", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await tracker.withStage("build", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    tracker.recordUnchangedFileReread(2);
    tracker.recordPreviewRestart();

    const result = tracker.snapshot({
      activities: [],
      commands: {
        count: 2,
        failed: 0,
        durationMs: 20,
        background: 2,
        productionBuilds: 1,
        installs: 0,
        previewStarts: 2,
      },
    });

    expect((result.stages.model ?? 0) + (result.stages.build ?? 0)).toBeGreaterThanOrEqual(15);
    expect(result.tools.unchangedFileRereads).toBe(2);
    // 1 explicit restart + 1 extra preview start beyond the initial start
    expect(result.commands.previewRestarts).toBe(2);
  });

  it("only records the first preview milestone", () => {
    const tracker = createRunPerformanceTracker(5_000);
    tracker.markFirstPreview(5_900);
    tracker.markFirstPreview(8_000);
    const result = tracker.snapshot({
      nowMs: 8_500,
      activities: [],
      commands: { count: 0, failed: 0, durationMs: 0, background: 0, productionBuilds: 0, installs: 0, previewStarts: 0 },
    });
    expect(result.timeToFirstPreviewMs).toBe(900);
  });
});
