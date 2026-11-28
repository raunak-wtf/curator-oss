import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runAgent } from "../src/lib/ai/runner";
import { evaluateBenchmarkRun, type RouteProbe } from "../src/lib/benchmarks/judges";
import { getBenchmarkById } from "../src/lib/benchmarks/suite";
import { deleteNeonProject } from "../src/lib/cloud/neon";
import { deleteProjectSandbox, getProjectRoot, getSandbox } from "../src/lib/daytona";
import { getPerformanceArchitectureMetadata } from "../src/lib/feature-flags";
import {
  createProject,
  deleteProject,
  getProject,
  getProjectCloud,
  listRecentAgentRunMetrics,
} from "../src/lib/store";
import type { AgentEvent, Viewer } from "../src/lib/types";

function arg(name: string, fallback?: string): string {
  const idx = process.argv.indexOf(name);
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required flag ${name}`);
}

async function main() {
  const benchmarkId = arg("--benchmark", "marketing-site");
  const label = arg("--label", "baseline");
  const outPath = arg("--out");
  const append = process.argv.includes("--append");

  const benchmark = getBenchmarkById(benchmarkId);
  if (!benchmark) {
    throw new Error(`Unknown benchmark id: ${benchmarkId}`);
  }

  const viewer: Viewer = {
    id: "benchmark|cognix-perf-harness",
    email: "perf-benchmark@cognix.invalid",
    emailVerified: false,
    name: "Cognix Benchmark Harness",
    picture: undefined,
    authProvider: "harness",
    authProviderLabel: "Benchmark Harness",
    authMethod: "oauth",
    authSubject: "benchmark|cognix-perf-harness",
  };

  const arch = getPerformanceArchitectureMetadata();
  console.log(`[bench] starting label=${label} benchmark=${benchmark.id} flags=${JSON.stringify(arch.flags)}`);

  const project = await createProject(viewer, benchmark.prompt, {
    title: `[Benchmark ${label}] ${benchmark.title}`,
  });

  const startedAt = Date.now();
  let firstPreviewMs: number | null = null;
  let statusCount = 0;
  let runError: string | null = null;
  const routeProbes: RouteProbe[] = [];

  const emit = async (event: AgentEvent) => {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (event.type === "status") {
      statusCount += 1;
      if (statusCount <= 40 || statusCount % 5 === 0) {
        console.log(`[bench +${elapsed}s] status: ${event.label}`);
      }
    } else if (event.type === "preview") {
      if (firstPreviewMs === null) {
        firstPreviewMs = Date.now() - startedAt;
        console.log(`[bench +${elapsed}s] FIRST PREVIEW ready (ms=${firstPreviewMs})`);
      } else {
        console.log(`[bench +${elapsed}s] preview updated`);
      }
    } else if (event.type === "done") {
      console.log(
        `[bench +${elapsed}s] DONE changedPaths=${event.changedPaths?.length ?? 0} commands=${event.commands?.length ?? 0} totalTokens=${event.totalTokens ?? 0}`,
      );
    }
  };

  try {
    await runAgent({
      project,
      prompt: benchmark.prompt,
      history: [],
      attachments: [],
      visualSelections: [],
      chatMode: "build",
      emit,
    });

    // Probe required routes directly inside the running sandbox before cleanup
    const refreshed = (await getProject(project.id, viewer.id)) ?? project;
    const sandbox = await getSandbox(refreshed);
    if (sandbox) {
      const root = await getProjectRoot(sandbox);
      for (const route of benchmark.requiredRoutes) {
        const cmd = `body=$(curl -sS -w '\\nCOGNIX_HTTP_%{http_code}' --max-time 10 "http://127.0.0.1:3000${route}" || printf '\\nCOGNIX_HTTP_000'); status=$(printf '%s' "$body" | tail -n 1 | sed 's/COGNIX_HTTP_//'); html=$(printf '%s' "$body" | sed '$d'); len=$(printf '%s' "$html" | wc -c | tr -d ' '); overlay=0; printf '%s' "$html" | grep -qiE '__next_error__|NEXT_HTTP_ERROR_FALLBACK|Application error: a client-side exception' && overlay=1; printf 'STATUS=%s LEN=%s OVERLAY=%s\\n' "$status" "$len" "$overlay"`;
        const res = await sandbox.process.executeCommand(cmd, root, undefined, 20);
        const match = res.result.match(/STATUS=(\d+)\s+LEN=(\d+)\s+OVERLAY=(\d+)/);
        routeProbes.push({
          route,
          status: match ? Number(match[1]) : 0,
          bodyLength: match ? Number(match[2]) : 0,
          hasNextErrorOverlay: match ? match[3] === "1" : true,
        });
      }
      console.log(`[bench] routeProbes=${JSON.stringify(routeProbes)}`);
    }
  } catch (error) {
    runError = error instanceof Error ? error.message : String(error);
    console.error(`[bench] runAgent FAILED: ${runError}`);
  } finally {
    const latestProject = (await getProject(project.id, viewer.id).catch(() => null)) ?? project;
    const cloud = await getProjectCloud(project.id).catch(() => null);
    if (cloud?.neonProjectId) {
      console.log(`[bench] deleting temporary Neon project ${cloud.neonProjectId}...`);
      await deleteNeonProject(cloud.neonProjectId).catch((err) => {
        console.error(`[bench] warning: deleteNeonProject failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
    if (latestProject.sandboxId) {
      console.log(`[bench] cleaning up temporary Daytona sandbox ${latestProject.sandboxId}...`);
      await deleteProjectSandbox(latestProject).catch((err) => {
        console.error(`[bench] warning: deleteProjectSandbox failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
    console.log(`[bench] deleting temporary project ${project.id}...`);
    await deleteProject(project.id, viewer.id).catch((err) => {
      console.error(`[bench] warning: deleteProject failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  // Fetch the privacy-safe metric row persisted by runAgent
  const recent = await listRecentAgentRunMetrics(20);
  const metric =
    recent.find(
      (row) => row.projectId === null && row.userId === viewer.id && new Date(row.startedAt).getTime() >= startedAt - 5_000,
    ) ?? recent.find((row) => row.userId === viewer.id);

  if (!metric) {
    throw new Error("Could not locate persisted agent_run_metrics row after run.");
  }

  const inputTokens = metric.performance.model.turnMetrics.reduce((sum, t) => sum + t.promptTokens, 0);
  const turns = metric.performance.model.turns;
  const productionBuilds = metric.performance.commands.productionBuilds;
  const routeJudgeOk =
    routeProbes.length === benchmark.requiredRoutes.length &&
    routeProbes.every((p) => p.status >= 200 && p.status < 300 && p.bodyLength > 0 && !p.hasNextErrorOverlay);

  const judgeResult = evaluateBenchmarkRun(benchmark, {
    buildPassed: metric.status === "completed" && !runError,
    productionBuilds: Math.max(0, productionBuilds),
    routeProbes,
    browserErrors: 0,
    serverErrors: 0,
    overflowViewports: [],
    missingAltCount: 0,
    unlabeledIconButtons: 0,
    primaryInteractionPassed: routeJudgeOk,
    cloudResources: {
      hasDatabaseTables: false,
      hasAuthRoutes: false,
      hasStorageBucket: false,
      hasEmailAdapter: false,
    },
    turns,
    inputTokens,
  });

  const record = {
    id: metric.id,
    label,
    benchmarkId: benchmark.id,
    mode: metric.mode,
    status: metric.status,
    passed: metric.status === "completed" && routeJudgeOk && !runError,
    slaPassed: judgeResult.passed,
    judgeFailures: judgeResult.failures,
    errorCategory: metric.errorCategory,
    startedAt: metric.startedAt,
    completedAt: metric.completedAt,
    totalDurationMs: metric.totalDurationMs,
    timeToFirstPreviewMs: metric.performance.timeToFirstPreviewMs ?? firstPreviewMs,
    turns,
    inputTokens,
    productionBuilds,
    routeProbes,
    performance: metric.performance,
  };

  let existingRuns: unknown[] = [];
  if (append) {
    try {
      const prev = JSON.parse(readFileSync(outPath, "utf8"));
      existingRuns = Array.isArray(prev?.recentRuns) ? prev.recentRuns : Array.isArray(prev) ? prev : [];
    } catch {
      existingRuns = [];
    }
  }

  mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        label,
        benchmarkId: benchmark.id,
        capturedAt: new Date().toISOString(),
        architecture: arch,
        recentRuns: [...existingRuns, record],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(
    `[bench] SAVED ${outPath} | status=${record.status} routeOk=${routeJudgeOk} totalMs=${record.totalDurationMs} firstPreviewMs=${record.timeToFirstPreviewMs} turns=${turns} inputTokens=${inputTokens} prodBuilds=${productionBuilds}`,
  );
  if (runError) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
