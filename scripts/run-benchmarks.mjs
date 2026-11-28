#!/usr/bin/env node
import { readFileSync } from "node:fs";

const BENCHMARK_SUITE = [
  {
    id: "marketing-site",
    title: "Marketing site for a design studio",
    category: "frontend",
    expectedCloudFeatures: [],
    requiredRoutes: ["/", "/services", "/pricing", "/contact"],
    sla: { firstPreviewP50Ms: 90000, firstPreviewP95Ms: 180000, completionP50Ms: 240000, completionP95Ms: 420000, turnsP50: 12, turnsP95: 20, inputTokensP50: 500000, maxProductionBuilds: 1 },
  },
  {
    id: "crud-notes",
    title: "Notes app with create, edit, delete",
    category: "fullstack",
    expectedCloudFeatures: ["database"],
    requiredRoutes: ["/", "/notes", "/notes/new"],
    sla: { firstPreviewP50Ms: 120000, firstPreviewP95Ms: 240000, completionP50Ms: 360000, completionP95Ms: 600000, turnsP50: 18, turnsP95: 30, inputTokensP50: 900000, maxProductionBuilds: 1 },
  },
  {
    id: "auth-dashboard",
    title: "Dashboard behind sign in",
    category: "fullstack",
    expectedCloudFeatures: ["database", "auth"],
    requiredRoutes: ["/", "/sign-in", "/dashboard"],
    sla: { firstPreviewP50Ms: 120000, firstPreviewP95Ms: 240000, completionP50Ms: 360000, completionP95Ms: 600000, turnsP50: 18, turnsP95: 30, inputTokensP50: 900000, maxProductionBuilds: 1 },
  },
  {
    id: "realtime-chat-storage",
    title: "Chat room with file attachments",
    category: "fullstack",
    expectedCloudFeatures: ["database", "auth", "storage"],
    requiredRoutes: ["/", "/sign-in", "/chat"],
    sla: { firstPreviewP50Ms: 120000, firstPreviewP95Ms: 240000, completionP50Ms: 360000, completionP95Ms: 600000, turnsP50: 18, turnsP95: 30, inputTokensP50: 900000, maxProductionBuilds: 1 },
  },
  {
    id: "existing-project-edit",
    title: "Edit an existing project",
    category: "edit",
    expectedCloudFeatures: [],
    requiredRoutes: ["/", "/pricing"],
    sla: { firstPreviewP50Ms: 90000, firstPreviewP95Ms: 180000, completionP50Ms: 240000, completionP95Ms: 420000, turnsP50: 12, turnsP95: 20, inputTokensP50: 500000, maxProductionBuilds: 1 },
  },
  {
    id: "screenshot-reconstruction",
    title: "Reconstruct a design from a screenshot",
    category: "frontend",
    expectedCloudFeatures: [],
    requiredRoutes: ["/"],
    sla: { firstPreviewP50Ms: 90000, firstPreviewP95Ms: 180000, completionP50Ms: 240000, completionP95Ms: 420000, turnsP50: 12, turnsP95: 20, inputTokensP50: 500000, maxProductionBuilds: 1 },
  },
  {
    id: "runtime-error-repair",
    title: "Repair a runtime error",
    category: "repair",
    expectedCloudFeatures: [],
    requiredRoutes: ["/", "/items"],
    sla: { firstPreviewP50Ms: 90000, firstPreviewP95Ms: 180000, completionP50Ms: 240000, completionP95Ms: 420000, turnsP50: 12, turnsP95: 20, inputTokensP50: 500000, maxProductionBuilds: 1 },
  },
];

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index];
}

function formatMs(value) {
  if (value === null || value === undefined) return "n/a";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${value}ms`;
}

function usage() {
  console.log(`Usage:
  node scripts/run-benchmarks.mjs --list
  node scripts/run-benchmarks.mjs --list --json
  node scripts/run-benchmarks.mjs --evaluate <metrics.json>`);
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
      `  SLA: first preview p50 ${formatMs(sla.firstPreviewP50Ms)} / p95 ${formatMs(sla.firstPreviewP95Ms)}, completion p50 ${formatMs(sla.completionP50Ms)} / p95 ${formatMs(sla.completionP95Ms)}, turns p50 ${sla.turnsP50} / p95 ${sla.turnsP95}, tokens p50 ${sla.inputTokensP50}, max builds ${sla.maxProductionBuilds}`,
    );
  }
}

function evaluate(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    console.error(`Failed to read ${filePath}: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(`Failed to parse ${filePath}: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const runs = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.recentRuns) ? parsed.recentRuns : null;
  if (!runs) {
    console.error('Expected a JSON array of runs or { "recentRuns": [...] }.');
    process.exitCode = 1;
    return;
  }

  const pick = (key) => runs.map((run) => run[key]).filter((value) => typeof value === "number");
  const metrics = ["timeToFirstPreviewMs", "totalDurationMs", "turns", "inputTokens", "productionBuilds"];
  const passedCount = runs.filter((run) => run.passed === true).length;

  console.log(`Benchmark runs: ${runs.length}`);
  console.log(`Pass rate: ${runs.length === 0 ? "n/a" : `${((passedCount / runs.length) * 100).toFixed(0)}%`}`);
  for (const metric of metrics) {
    const values = pick(metric);
    console.log(`${metric}: p50 ${formatMs(percentile(values, 50))} / p95 ${formatMs(percentile(values, 95))} over ${values.length} run(s)`);
  }
}

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  usage();
} else if (args[0] === "--list") {
  listBenchmarks(args.includes("--json"));
} else if (args[0] === "--evaluate") {
  if (args.length < 2) {
    console.error("--evaluate requires a path to a metrics JSON file.");
    process.exitCode = 1;
  } else {
    evaluate(args[1]);
  }
} else {
  console.error(`Unknown argument: ${args[0]}`);
  usage();
  process.exitCode = 1;
}
