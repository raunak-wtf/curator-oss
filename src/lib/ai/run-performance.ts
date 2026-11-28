import type {
  AgentRunActivity,
  AgentRunPerformance,
  AgentRunStage,
  AgentRunTurnMetric,
} from "../types";
import type { TerminalCommandStats } from "./terminal-log";

const MAX_TURN_METRICS = 140;
const MAX_TOOL_NAMES = 40;

function safeInteger(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

export function isAgentRunPerformance(value: unknown): value is AgentRunPerformance {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AgentRunPerformance>;
  return candidate.schemaVersion === 1
    && typeof candidate.model === "object"
    && candidate.model !== null
    && typeof candidate.tools === "object"
    && candidate.tools !== null
    && typeof candidate.commands === "object"
    && candidate.commands !== null;
}

/**
 * Records bounded, non-sensitive performance telemetry for one agent run.
 * It never stores prompts, source, paths, tool inputs, command text, logs, or secrets.
 */
export function createRunPerformanceTracker(startedAtMs = Date.now()) {
  const startedAt = safeInteger(startedAtMs);
  const stages: Partial<Record<AgentRunStage, number>> = {};
  const turnMetrics: AgentRunTurnMetric[] = [];
  let activeStage: AgentRunStage | null = null;
  let activeStageStartedAt = startedAt;
  let firstPreviewAt: number | null = null;
  let attemptsSinceLastTurn = 0;
  let modelAttempts = 0;
  let modelDurationMs = 0;
  let contextRefreshes = 0;
  let unchangedFileRereads = 0;
  let previewRestarts = 0;
  let architecture: AgentRunPerformance["architecture"] | undefined;

  function flushStage(nowMs: number) {
    if (!activeStage) return;
    const now = safeInteger(nowMs);
    stages[activeStage] = safeInteger((stages[activeStage] ?? 0) + Math.max(0, now - activeStageStartedAt));
    activeStageStartedAt = now;
  }

  function enterStage(stage: AgentRunStage, nowMs = Date.now()) {
    flushStage(nowMs);
    activeStage = stage;
    activeStageStartedAt = safeInteger(nowMs);
  }

  /**
   * Runs an async operation inside a dedicated sub-stage and restores the caller's stage in `finally`
   * so stage timings stay mutually exclusive and attribute ~100% of wall-clock run duration.
   */
  async function withStage<T>(stage: AgentRunStage, fn: () => Promise<T>): Promise<T> {
    const previousStage = activeStage;
    enterStage(stage);
    try {
      return await fn();
    } finally {
      if (previousStage) {
        enterStage(previousStage);
      } else {
        flushStage(Date.now());
        activeStage = null;
      }
    }
  }

  function recordModelAttempt() {
    attemptsSinceLastTurn += 1;
    modelAttempts += 1;
  }

  function recordModelTurn(input: Omit<AgentRunTurnMetric, "index" | "attempts">) {
    const metric: AgentRunTurnMetric = {
      index: turnMetrics.length + 1,
      attempts: Math.max(1, attemptsSinceLastTurn),
      durationMs: safeInteger(input.durationMs),
      messageChars: safeInteger(input.messageChars),
      promptTokens: safeInteger(input.promptTokens),
      cachedPromptTokens: safeInteger(input.cachedPromptTokens),
      completionTokens: safeInteger(input.completionTokens),
      toolCalls: safeInteger(input.toolCalls),
    };
    attemptsSinceLastTurn = 0;
    modelDurationMs += metric.durationMs;
    if (turnMetrics.length < MAX_TURN_METRICS) turnMetrics.push(metric);
  }

  function recordContextRefresh() {
    contextRefreshes += 1;
  }

  function recordUnchangedFileReread(count = 1) {
    unchangedFileRereads += safeInteger(count);
  }

  function recordPreviewRestart(count = 1) {
    previewRestarts += safeInteger(count);
  }

  function setArchitecture(meta: AgentRunPerformance["architecture"]) {
    architecture = meta;
  }

  function markFirstPreview(nowMs = Date.now()) {
    if (firstPreviewAt === null) firstPreviewAt = safeInteger(nowMs);
  }

  function snapshot(input: {
    activities: AgentRunActivity[];
    commands: TerminalCommandStats;
    nowMs?: number;
  }): AgentRunPerformance {
    flushStage(input.nowMs ?? Date.now());

    const byNameEntries = new Map<string, { calls: number; errors: number; durationMs: number }>();
    let toolErrors = 0;
    let toolDurationMs = 0;
    for (const activity of input.activities) {
      const durationMs = safeInteger(activity.durationMs);
      const error = activity.status === "error" ? 1 : 0;
      toolErrors += error;
      toolDurationMs += durationMs;
      const current = byNameEntries.get(activity.name) ?? { calls: 0, errors: 0, durationMs: 0 };
      current.calls += 1;
      current.errors += error;
      current.durationMs += durationMs;
      byNameEntries.set(activity.name, current);
    }
    const byName = Object.fromEntries(
      [...byNameEntries.entries()]
        .sort((left, right) => right[1].durationMs - left[1].durationMs || right[1].calls - left[1].calls)
        .slice(0, MAX_TOOL_NAMES),
    );

    const previewStarts = safeInteger(input.commands.previewStarts);
    const totalPreviewRestarts = safeInteger(previewRestarts + Math.max(0, previewStarts - 1));

    return {
      schemaVersion: 1,
      timeToFirstPreviewMs: firstPreviewAt === null ? null : Math.max(0, firstPreviewAt - startedAt),
      stages: { ...stages },
      model: {
        turns: turnMetrics.length,
        attempts: modelAttempts,
        durationMs: safeInteger(modelDurationMs),
        contextRefreshes,
        turnMetrics: turnMetrics.map((metric) => ({ ...metric })),
      },
      tools: {
        calls: input.activities.length,
        errors: toolErrors,
        durationMs: safeInteger(toolDurationMs),
        unchangedFileRereads: safeInteger(unchangedFileRereads),
        byName,
      },
      commands: {
        count: safeInteger(input.commands.count),
        failed: safeInteger(input.commands.failed),
        durationMs: safeInteger(input.commands.durationMs),
        background: safeInteger(input.commands.background),
        productionBuilds: safeInteger(input.commands.productionBuilds),
        installs: safeInteger(input.commands.installs),
        previewStarts,
        previewRestarts: totalPreviewRestarts,
      },
      ...(architecture ? { architecture } : {}),
    };
  }

  return {
    enterStage,
    withStage,
    recordModelAttempt,
    recordModelTurn,
    recordContextRefresh,
    recordUnchangedFileReread,
    recordPreviewRestart,
    setArchitecture,
    markFirstPreview,
    snapshot,
  };
}
