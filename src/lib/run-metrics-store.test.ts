import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRunPerformance } from "./types";

vi.mock("./db", () => ({ db: null, isDatabaseConfigured: false }));

const { getAdminPerformanceData, listRecentAgentRunMetrics, recordAgentRunMetric } = await import("./store");

const performance: AgentRunPerformance = {
  schemaVersion: 1,
  timeToFirstPreviewMs: 1_200,
  stages: { sandbox: 300, setup: 400, agent: 500 },
  model: { turns: 1, attempts: 1, durationMs: 400, contextRefreshes: 0, turnMetrics: [] },
  tools: { calls: 0, errors: 0, durationMs: 0, byName: {} },
  commands: { count: 0, failed: 0, durationMs: 0, background: 0, productionBuilds: 0, installs: 0, previewStarts: 0 },
};

describe("agent run metrics store", () => {
  beforeEach(async () => {
    const existing = await listRecentAgentRunMetrics(500);
    globalThis.__cognixMemoryStore!.agentRunMetrics = existing.filter(() => false);
  });

  it("persists and idempotently updates a privacy-safe run snapshot", async () => {
    const base = {
      id: "11111111-1111-4111-8111-111111111111",
      projectId: null,
      userId: "user-1",
      messageId: null,
      mode: "build" as const,
      startedAt: "2026-11-28T00:00:00.000Z",
      completedAt: "2026-11-28T00:00:02.000Z",
      totalDurationMs: 2_000,
      performance,
    };

    await recordAgentRunMetric({ ...base, status: "checkpoint" });
    await recordAgentRunMetric({ ...base, status: "completed", totalDurationMs: 2_500 });

    const rows = await listRecentAgentRunMetrics();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: base.id, status: "completed", totalDurationMs: 2_500 });
    expect(JSON.stringify(rows[0])).not.toContain("prompt");
  });

  it("calculates admin percentiles without returning user identity data", async () => {
    for (const [index, durationMs] of [1_000, 2_000, 10_000].entries()) {
      await recordAgentRunMetric({
        id: `11111111-1111-4111-8111-11111111111${index}`,
        projectId: null,
        userId: `user-${index}`,
        messageId: null,
        mode: "build",
        status: "completed",
        startedAt: "2026-11-28T00:00:00.000Z",
        completedAt: "2026-11-28T00:00:10.000Z",
        totalDurationMs: durationMs,
        performance: { ...performance, timeToFirstPreviewMs: durationMs / 2 },
      });
    }

    const data = await getAdminPerformanceData();
    expect(data.summary.totalDurationMs).toEqual({ p50: 2_000, p95: 10_000 });
    expect(data.summary.firstPreviewMs).toEqual({ p50: 1_000, p95: 5_000 });
    expect(data.recentRuns[0]).not.toHaveProperty("userId");
    expect(data.recentRuns[0]).not.toHaveProperty("projectId");
  });
});
