#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const BENCHMARK_SUITE = [
  {
    id: "marketing-site",
    title: "Marketing site for a design studio",
    category: "frontend",
    expectedCloudFeatures: [],
    requiredRoutes: ["/", "/services", "/pricing", "/contact"],
    sla: {
      firstPreviewP50Ms: 90000,
      firstPreviewP95Ms: 180000,
      completionP50Ms: 240000,
      completionP95Ms: 420000,
      turnsP50: 12,
      turnsP95: 20,
      inputTokensP50: 500000,
      maxProductionBuilds: 1,
    },
  },
  {
    id: "crud-notes",
    title: "Notes app with create, edit, delete",
    category: "fullstack",
    expectedCloudFeatures: ["database"],
    requiredRoutes: ["/", "/notes", "/notes/new"],
    sla: {
      firstPreviewP50Ms: 120000,
      firstPreviewP95Ms: 240000,
      completionP50Ms: 360000,
      completionP95Ms: 600000,
      turnsP50: 18,
      turnsP95: 30,
      inputTokensP50: 900000,
      maxProductionBuilds: 1,
    },
  },
  {
    id: "auth-dashboard",
    title: "Dashboard behind sign in",
    category: "fullstack",
    expectedCloudFeatures: ["database", "auth"],
    requiredRoutes: ["/", "/sign-in", "/dashboard"],
    sla: {
      firstPreviewP50Ms: 120000,
      firstPreviewP95Ms: 240000,
      completionP50Ms: 360000,
      completionP95Ms: 600000,
      turnsP50: 18,
      turnsP95: 30,
      inputTokensP50: 900000,
      maxProductionBuilds: 1,
    },
  },
  {
    id: "realtime-chat-storage",
    title: "Chat room with file attachments",
    category: "fullstack",
    expectedCloudFeatures: ["database", "auth", "storage"],
    requiredRoutes: ["/", "/sign-in", "/chat"],
    sla: {
      firstPreviewP50Ms: 120000,
      firstPreviewP95Ms: 240000,
      completionP50Ms: 360000,
      completionP95Ms: 600000,
      turnsP50: 18,
      turnsP95: 30,
      inputTokensP50: 900000,
      maxProductionBuilds: 1,
    },
  },
  {
    id: "existing-project-edit",
    title: "Edit an existing project",
    category: "edit",
    expectedCloudFeatures: [],
    requiredRoutes: ["/", "/pricing"],
    sla: {
      firstPreviewP50Ms: 90000,
      firstPreviewP95Ms: 180000,
      completionP50Ms: 240000,
      completionP95Ms: 420000,
      turnsP50: 12,
      turnsP95: 20,
      inputTokensP50: 500000,
      maxProductionBuilds: 1,
    },
  },
  {
    id: "screenshot-reconstruction",
    title: "Reconstruct a design from a screenshot",
    category: "frontend",
    expectedCloudFeatures: [],
    requiredRoutes: ["/"],
    sla: {
      firstPreviewP50Ms: 90000,
      firstPreviewP95Ms: 180000,
      completionP50Ms: 240000,
      completionP95Ms: 420000,
      turnsP50: 12,
      turnsP95: 20,
      inputTokensP50: 500000,
      maxProductionBuilds: 1,
    },
  },
  {
    id: "runtime-error-repair",
    title: "Repair a runtime error",
    category: "repair",
    expectedCloudFeatures: [],
    requiredRoutes: ["/", "/items"],
    sla: {
      firstPreviewP50Ms: 90000,
      firstPreviewP95Ms: 180000,
      completionP50Ms: 240000,
      completionP95Ms: 420000,
      turnsP50: 12,
      turnsP95: 20,
      inputTokensP50: 500000,
      maxProductionBuilds: 1,
    },
  },
];

const METRIC_SPECS = [
  { key: "timeToFirstPreviewMs", label: "timeToFirstPreviewMs", kind: "ms" },
  { key: "totalDurationMs", label: "totalDurationMs", kind: "ms" },
  { key: "turns", label: "turns", kind: "int" },
  { key: "inputTokens", label: "inputTokens", kind: "int" },
  { key: "productionBuilds", label: "productionBuilds", kind: "int" },
];

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index];
}

function formatMs(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  if (value >= 60_000) {
    const minutes = Math.floor(value / 60_000);
    const seconds = ((value % 60_000) / 1000).toFixed(1);
    return `${minutes}m ${seconds}s`;
  }
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}

function formatCount(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return Math.round(value).toLocaleString("en-US");
}

function formatMetric(value, kind) {
  return kind === "ms" ? formatMs(value) : formatCount(value);
}

function formatDelta(base, cand) {
  if (base === null || base === undefined || cand === null || cand === undefined || base === 0) return "n/a";
  const pct = ((cand - base) / base) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Normalizes flat benchmark records, `/api/admin/performance` `recentRuns` entries,
 * and historical `credit_usage_events` rows into one consistent metrics shape.
 */
function normalizeRun(raw) {
  if (!raw || typeof raw !== "object") return null;
  const perf = raw.performance && typeof raw.performance === "object" ? raw.performance : null;
  const model = perf?.model && typeof perf.model === "object" ? perf.model : null;
  const commands = perf?.commands && typeof perf.commands === "object" ? perf.commands : null;

  const turnMetrics = Array.isArray(model?.turnMetrics) ? model.turnMetrics : [];
  const summedPromptTokens =
    turnMetrics.length > 0
      ? turnMetrics.reduce((sum, turn) => sum + (finiteNumber(turn?.promptTokens) ?? 0), 0)
      : null;

  const timeToFirstPreviewMs =
    finiteNumber(raw.timeToFirstPreviewMs) ?? finiteNumber(perf?.timeToFirstPreviewMs);
  const totalDurationMs =
    finiteNumber(raw.totalDurationMs) ??
    finiteNumber(perf?.totalDurationMs) ??
    finiteNumber(raw.duration_ms);
  const turns = finiteNumber(raw.turns) ?? finiteNumber(model?.turns);
  const inputTokens =
    finiteNumber(raw.inputTokens) ??
    finiteNumber(raw.promptTokens) ??
    finiteNumber(raw.prompt_tokens) ??
    summedPromptTokens;
  const productionBuilds =
    finiteNumber(raw.productionBuilds) ?? finiteNumber(commands?.productionBuilds);

  let passed = false;
  if (typeof raw.passed === "boolean") {
    passed = raw.passed;
  } else if (typeof raw.status === "string") {
    passed = raw.status === "completed";
  }

  const stages = {};
  if (perf?.stages && typeof perf.stages === "object") {
    for (const [stage, entry] of Object.entries(perf.stages)) {
      const dur = finiteNumber(typeof entry === "number" ? entry : entry?.durationMs);
      if (dur !== null && dur > 0) stages[stage] = dur;
    }
  }

  return {
    benchmarkId: typeof raw.benchmarkId === "string" ? raw.benchmarkId : null,
    timeToFirstPreviewMs,
    totalDurationMs,
    turns,
    inputTokens,
    productionBuilds,
    passed,
    status: typeof raw.status === "string" ? raw.status : passed ? "completed" : "failed",
    stages,
    architecture: perf?.architecture ?? raw.architecture ?? null,
  };
}

function loadMetricsFile(filePath) {
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.recentRuns)
      ? parsed.recentRuns
      : Array.isArray(parsed?.runs)
        ? parsed.runs
        : null;
  if (!list) {
    throw new Error('Expected a JSON array of runs or { "recentRuns": [...] }.');
  }
  return list.map(normalizeRun).filter(Boolean);
}

function summarizeRuns(runs, benchmarkId = null) {
  const pick = (key) => runs.map((run) => run[key]).filter((v) => typeof v === "number" && Number.isFinite(v));
  const passedCount = runs.filter((run) => run.passed).length;
  const passRate = runs.length === 0 ? null : passedCount / runs.length;

  const metrics = {};
  for (const spec of METRIC_SPECS) {
    const values = pick(spec.key);
    metrics[spec.key] = {
      count: values.length,
      p50: percentile(values, 50),
      p95: percentile(values, 95),
    };
  }

  const stageMap = new Map();
  for (const run of runs) {
    for (const [stage, dur] of Object.entries(run.stages)) {
      const arr = stageMap.get(stage) ?? [];
      arr.push(dur);
      stageMap.set(stage, arr);
    }
  }
  const stageP50 = {};
  for (const [stage, values] of stageMap.entries()) {
    stageP50[stage] = percentile(values, 50);
  }

  const inferredBenchmarkId =
    benchmarkId ??
    (() => {
      const ids = [...new Set(runs.map((r) => r.benchmarkId).filter(Boolean))];
      return ids.length === 1 ? ids[0] : null;
    })();
  const benchmark = inferredBenchmarkId ? BENCHMARK_SUITE.find((b) => b.id === inferredBenchmarkId) ?? null : null;

  let sla = null;
  if (benchmark && runs.length > 0) {
    const within = (v, cap) => v !== null && v <= cap;
    const checks = {
      firstPreviewP50: within(metrics.timeToFirstPreviewMs.p50, benchmark.sla.firstPreviewP50Ms),
      firstPreviewP95: within(metrics.timeToFirstPreviewMs.p95, benchmark.sla.firstPreviewP95Ms),
      completionP50: within(metrics.totalDurationMs.p50, benchmark.sla.completionP50Ms),
      completionP95: within(metrics.totalDurationMs.p95, benchmark.sla.completionP95Ms),
      turnsP50: within(metrics.turns.p50, benchmark.sla.turnsP50),
      turnsP95: within(metrics.turns.p95, benchmark.sla.turnsP95),
      inputTokensP50: within(metrics.inputTokens.p50, benchmark.sla.inputTokensP50),
      productionBuildsP95: within(metrics.productionBuilds.p95, benchmark.sla.maxProductionBuilds),
    };
    sla = {
      benchmarkId: benchmark.id,
      meetsSla: Object.values(checks).every(Boolean),
      checks,
    };
  }

  return {
    runCount: runs.length,
    passedCount,
    passRate,
    metrics,
    stageP50,
    sla,
  };
}

function usage() {
  console.log(`Usage:
  node scripts/run-benchmarks.mjs --list [--json]
  node scripts/run-benchmarks.mjs --evaluate <metrics.json> [--baseline <baseline.json>] [--benchmark <id>] [--json]
  node --env-file=.env.local scripts/run-benchmarks.mjs --export-db <out.json> [--limit 200] [--mode build]`);
}

function listBenchmarks(json) {
  if (json) {
    console.log(JSON.stringify(BENCHMARK_SUITE, null, 2));
    return;
  }
  for (const benchmark of BENCHMARK_SUITE) {
    console.log(`${benchmark.id} [${benchmark.category}] ${benchmark.title}`);
    console.log(`  routes: ${benchmark.requiredRoutes.join(", ")}`);
    if (benchmark.expectedCloudFeatures.length > 0) {
      console.log(`  cloud features: ${benchmark.expectedCloudFeatures.join(", ")}`);
    }
    const sla = benchmark.sla;
    console.log(
      `  SLA: first preview p50 ${formatMs(sla.firstPreviewP50Ms)} / p95 ${formatMs(sla.firstPreviewP95Ms)}, completion p50 ${formatMs(sla.completionP50Ms)} / p95 ${formatMs(sla.completionP95Ms)}, turns p50 ${sla.turnsP50} / p95 ${sla.turnsP95}, tokens p50 ${formatCount(sla.inputTokensP50)}, max builds ${sla.maxProductionBuilds}`,
    );
  }
}

function getFlagValue(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return null;
  return args[index + 1];
}

function evaluate(filePath, options = {}) {
  let runs;
  try {
    runs = loadMetricsFile(filePath);
  } catch (error) {
    console.error(`Failed to load ${filePath}: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const summary = summarizeRuns(runs, options.benchmarkId ?? null);
  let baselineSummary = null;
  const regressions = [];

  if (options.baselinePath) {
    try {
      const baselineRuns = loadMetricsFile(options.baselinePath);
      baselineSummary = summarizeRuns(baselineRuns, options.benchmarkId ?? null);
    } catch (error) {
      console.error(`Failed to load baseline ${options.baselinePath}: ${error.message}`);
      process.exitCode = 1;
      return;
    }

    for (const spec of METRIC_SPECS) {
      for (const level of ["p50", "p95"]) {
        const base = baselineSummary.metrics[spec.key][level];
        const cand = summary.metrics[spec.key][level];
        if (base !== null && cand !== null && cand > base) {
          regressions.push(`${spec.key}.${level}`);
        }
      }
    }
    if (baselineSummary.passRate !== null && summary.passRate !== null && summary.passRate < baselineSummary.passRate) {
      regressions.push("passRate");
    }
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          candidate: summary,
          ...(baselineSummary ? { baseline: baselineSummary, regressions } : {}),
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`Benchmark runs: ${summary.runCount}`);
  console.log(
    `Pass rate: ${summary.passRate === null ? "n/a" : `${(summary.passRate * 100).toFixed(0)}% (${summary.passedCount}/${summary.runCount})`}`,
  );
  for (const spec of METRIC_SPECS) {
    const m = summary.metrics[spec.key];
    let line = `${spec.label}: p50 ${formatMetric(m.p50, spec.kind)} / p95 ${formatMetric(m.p95, spec.kind)} over ${m.count} run(s)`;
    if (baselineSummary) {
      const bm = baselineSummary.metrics[spec.key];
      line += `  [baseline p50 ${formatMetric(bm.p50, spec.kind)}, delta ${formatDelta(bm.p50, m.p50)}]`;
    }
    console.log(line);
  }

  const stageEntries = Object.entries(summary.stageP50).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  if (stageEntries.length > 0) {
    console.log(
      `Stage p50 breakdown: ${stageEntries.map(([stage, ms]) => `${stage}=${formatMs(ms)}`).join(", ")}`,
    );
  }

  if (summary.sla) {
    const failedChecks = Object.entries(summary.sla.checks)
      .filter(([, ok]) => !ok)
      .map(([name]) => name);
    console.log(
      `SLA (${summary.sla.benchmarkId}): ${summary.sla.meetsSla ? "PASS" : `FAIL (${failedChecks.join(", ")})`}`,
    );
  }

  if (baselineSummary) {
    console.log(
      `Baseline comparison: ${regressions.length === 0 ? "no regressions" : `regressions in ${regressions.join(", ")}`}`,
    );
  }
}

async function exportFromDatabase(outPath, options = {}) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required for --export-db (run with node --env-file=.env.local).");
    process.exitCode = 1;
    return;
  }
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(databaseUrl);
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 200));
  const mode = options.mode ?? null;

  const rows = mode
    ? await sql`
        SELECT id, mode, status, error_category, started_at, completed_at, total_duration_ms, performance
        FROM agent_run_metrics
        WHERE mode = ${mode}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `
    : await sql`
        SELECT id, mode, status, error_category, started_at, completed_at, total_duration_ms, performance
        FROM agent_run_metrics
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;

  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    sampleSize: rows.length,
    recentRuns: rows.map((row) => ({
      id: row.id,
      mode: row.mode,
      status: row.status,
      errorCategory: row.error_category,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      totalDurationMs: Number(row.total_duration_ms),
      performance: row.performance,
    })),
  };

  mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Exported ${rows.length} privacy-safe agent_run_metrics row(s) to ${outPath}`);
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  usage();
} else if (args.includes("--list")) {
  listBenchmarks(args.includes("--json"));
} else if (args.includes("--evaluate")) {
  const targetPath = getFlagValue(args, "--evaluate");
  if (!targetPath) {
    console.error("--evaluate requires a path to a metrics JSON file.");
    process.exitCode = 1;
  } else {
    evaluate(targetPath, {
      baselinePath: getFlagValue(args, "--baseline"),
      benchmarkId: getFlagValue(args, "--benchmark"),
      json: args.includes("--json"),
    });
  }
} else if (args.includes("--export-db")) {
  const outPath = getFlagValue(args, "--export-db");
  if (!outPath) {
    console.error("--export-db requires an output JSON path.");
    process.exitCode = 1;
  } else {
    await exportFromDatabase(outPath, {
      limit: getFlagValue(args, "--limit"),
      mode: getFlagValue(args, "--mode"),
    });
  }
} else {
  console.error(`Unknown argument: ${args[0]}`);
  usage();
  process.exitCode = 1;
}
