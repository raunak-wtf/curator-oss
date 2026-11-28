import { describe, expect, it } from "vitest";
import {
  BENCHMARK_SUITE,
  BENCHMARK_SUITE_VERSION,
  getBenchmarkById,
  listBenchmarks,
  type BenchmarkDefinition,
} from "./suite";
import {
  aggregateBenchmarkRuns,
  compareBenchmarkBaselines,
  evaluateBenchmarkRun,
  judgeBuildHealth,
  judgeCloudResources,
  judgeResponsiveAndAccessibility,
  judgeRouteProbes,
  judgeRuntimeConsole,
  percentile,
  type BenchmarkRunMetrics,
} from "./judges";

const FRONTEND_SLA = {
  firstPreviewP50Ms: 90_000,
  firstPreviewP95Ms: 180_000,
  completionP50Ms: 240_000,
  completionP95Ms: 420_000,
  turnsP50: 12,
  turnsP95: 20,
  inputTokensP50: 500_000,
  maxProductionBuilds: 1,
};

const FULLSTACK_SLA = {
  firstPreviewP50Ms: 120_000,
  firstPreviewP95Ms: 240_000,
  completionP50Ms: 360_000,
  completionP95Ms: 600_000,
  turnsP50: 18,
  turnsP95: 30,
  inputTokensP50: 900_000,
  maxProductionBuilds: 1,
};

const cloudNone = {
  hasDatabaseTables: false,
  hasAuthRoutes: false,
  hasStorageBucket: false,
  hasEmailAdapter: false,
};

const cloudAll = {
  hasDatabaseTables: true,
  hasAuthRoutes: true,
  hasStorageBucket: true,
  hasEmailAdapter: true,
};

function probes(routes: string[]) {
  return routes.map((route) => ({ route, status: 200, bodyLength: 1024 }));
}

function passingObservation(benchmark: BenchmarkDefinition) {
  return {
    buildPassed: true,
    productionBuilds: 1,
    routeProbes: probes(benchmark.requiredRoutes),
    browserErrors: 0,
    serverErrors: 0,
    overflowViewports: [],
    missingAltCount: 0,
    unlabeledIconButtons: 0,
    primaryInteractionPassed: true,
    cloudResources: cloudNone,
    turns: benchmark.sla.turnsP50,
    inputTokens: benchmark.sla.inputTokensP50,
  };
}

describe("benchmark suite", () => {
  it("exposes a suite version", () => {
    expect(BENCHMARK_SUITE_VERSION).toBe("1.0.0");
  });

  it("contains exactly the 7 Phase 0 benchmarks in order", () => {
    expect(BENCHMARK_SUITE.map((b) => b.id)).toEqual([
      "marketing-site",
      "crud-notes",
      "auth-dashboard",
      "realtime-chat-storage",
      "existing-project-edit",
      "screenshot-reconstruction",
      "runtime-error-repair",
    ]);
  });

  it("assigns categories and SLA tiers", () => {
    const byId = new Map(BENCHMARK_SUITE.map((b) => [b.id, b]));
    expect(byId.get("marketing-site")?.category).toBe("frontend");
    expect(byId.get("screenshot-reconstruction")?.category).toBe("frontend");
    expect(byId.get("crud-notes")?.category).toBe("fullstack");
    expect(byId.get("auth-dashboard")?.category).toBe("fullstack");
    expect(byId.get("realtime-chat-storage")?.category).toBe("fullstack");
    expect(byId.get("existing-project-edit")?.category).toBe("edit");
    expect(byId.get("runtime-error-repair")?.category).toBe("repair");
    for (const id of ["marketing-site", "screenshot-reconstruction", "existing-project-edit", "runtime-error-repair"]) {
      expect(byId.get(id)?.sla).toEqual(FRONTEND_SLA);
    }
    for (const id of ["crud-notes", "auth-dashboard", "realtime-chat-storage"]) {
      expect(byId.get(id)?.sla).toEqual(FULLSTACK_SLA);
    }
  });

  it("declares expected cloud features per benchmark", () => {
    expect(getBenchmarkById("marketing-site")?.expectedCloudFeatures).toEqual([]);
    expect(getBenchmarkById("crud-notes")?.expectedCloudFeatures).toEqual(["database"]);
    expect(getBenchmarkById("auth-dashboard")?.expectedCloudFeatures).toEqual(["database", "auth"]);
    expect(getBenchmarkById("realtime-chat-storage")?.expectedCloudFeatures).toEqual([
      "database",
      "auth",
      "storage",
    ]);
  });

  it("every benchmark has a prompt, routes, and interactions", () => {
    for (const benchmark of BENCHMARK_SUITE) {
      expect(benchmark.prompt.length).toBeGreaterThan(20);
      expect(benchmark.requiredRoutes.length).toBeGreaterThan(0);
      expect(benchmark.expectedInteractions.length).toBeGreaterThan(0);
    }
  });

  it("lists all benchmarks and looks one up by id", () => {
    expect(listBenchmarks()).toHaveLength(7);
    expect(getBenchmarkById("crud-notes")?.title).toContain("Notes");
    expect(getBenchmarkById("does-not-exist")).toBeUndefined();
  });
});

describe("judgeBuildHealth", () => {
  it("passes on a healthy single build", () => {
    const result = judgeBuildHealth({ buildPassed: true, productionBuilds: 1 });
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("fails when the build failed", () => {
    const result = judgeBuildHealth({ buildPassed: false, productionBuilds: 1 });
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain("build failed");
  });

  it("fails when builds exceed the default budget", () => {
    const result = judgeBuildHealth({ buildPassed: true, productionBuilds: 2 });
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain("at most 1");
  });

  it("allows extra builds when a budget is given", () => {
    const result = judgeBuildHealth({ buildPassed: true, productionBuilds: 3, maxExtraBuilds: 2 });
    expect(result.passed).toBe(true);
  });
});

describe("judgeRouteProbes", () => {
  it("passes when every required route probes clean", () => {
    const result = judgeRouteProbes(["/", "/about"], probes(["/", "/about"]));
    expect(result.passed).toBe(true);
  });

  it("fails on missing probes", () => {
    const result = judgeRouteProbes(["/missing"], []);
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain("was not probed");
  });

  it("fails on non-2xx status", () => {
    const result = judgeRouteProbes(["/x"], [{ route: "/x", status: 500, bodyLength: 100 }]);
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain("status 500");
  });

  it("fails on empty bodies", () => {
    const result = judgeRouteProbes(["/x"], [{ route: "/x", status: 200, bodyLength: 0 }]);
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain("body 0");
  });

  it("fails when the next error overlay is present", () => {
    const result = judgeRouteProbes(["/x"], [{ route: "/x", status: 200, bodyLength: 10, hasNextErrorOverlay: true }]);
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain("error overlay");
  });
});

describe("judgeRuntimeConsole", () => {
  it("passes with a clean console", () => {
    expect(judgeRuntimeConsole({ browserErrors: 0, serverErrors: 0 }).passed).toBe(true);
  });

  it("fails on browser errors", () => {
    const result = judgeRuntimeConsole({ browserErrors: 2, serverErrors: 0 });
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain("2 browser");
  });

  it("fails on server errors", () => {
    const result = judgeRuntimeConsole({ browserErrors: 0, serverErrors: 1 });
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain("1 server");
  });
});

describe("judgeResponsiveAndAccessibility", () => {
  const clean = {
    overflowViewports: [],
    missingAltCount: 0,
    unlabeledIconButtons: 0,
    primaryInteractionPassed: true,
  };

  it("passes on a clean observation", () => {
    expect(judgeResponsiveAndAccessibility(clean).passed).toBe(true);
  });

  it("fails on horizontal overflow", () => {
    const result = judgeResponsiveAndAccessibility({ ...clean, overflowViewports: ["iphone-se", "pixel-7"] });
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain("iphone-se");
  });

  it("fails on missing alt text", () => {
    const result = judgeResponsiveAndAccessibility({ ...clean, missingAltCount: 3 });
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain("alt text");
  });

  it("fails on unlabeled icon buttons", () => {
    const result = judgeResponsiveAndAccessibility({ ...clean, unlabeledIconButtons: 1 });
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain("accessible name");
  });

  it("fails when the primary interaction failed", () => {
    const result = judgeResponsiveAndAccessibility({ ...clean, primaryInteractionPassed: false });
    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain("primary interaction");
  });
});

describe("judgeCloudResources", () => {
  it("passes when nothing is expected", () => {
    expect(judgeCloudResources([], cloudNone).passed).toBe(true);
  });

  it("passes when all expected features are present", () => {
    const result = judgeCloudResources(["database", "auth", "storage"], {
      ...cloudNone,
      hasDatabaseTables: true,
      hasAuthRoutes: true,
      hasStorageBucket: true,
    });
    expect(result.passed).toBe(true);
    expect(result.checks).toEqual({ database: true, auth: true, storage: true });
  });

  it("fails per missing feature", () => {
    const result = judgeCloudResources(["database", "email"], { ...cloudNone, hasDatabaseTables: true });
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("email");
    expect(result.checks).toEqual({ database: true, email: false });
  });

  it("covers every feature flag mapping", () => {
    expect(judgeCloudResources(["database", "auth", "storage", "email"], cloudAll).passed).toBe(true);
  });
});

describe("evaluateBenchmarkRun", () => {
  const benchmark = getBenchmarkById("crud-notes")!;

  it("passes a fully healthy run", () => {
    const observation = {
      ...passingObservation(benchmark),
      cloudResources: { ...cloudNone, hasDatabaseTables: true },
    };
    const result = evaluateBenchmarkRun(benchmark, observation);
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
    expect(Object.values(result.checks).every(Boolean)).toBe(true);
  });

  it("collects failures across every failing judge", () => {
    const observation = {
      ...passingObservation(benchmark),
      buildPassed: false,
      productionBuilds: 2,
      routeProbes: [],
      browserErrors: 3,
      serverErrors: 1,
      overflowViewports: ["pixel-7"],
      missingAltCount: 2,
      unlabeledIconButtons: 1,
      primaryInteractionPassed: false,
      cloudResources: cloudNone,
      turns: benchmark.sla.turnsP95 + 5,
      inputTokens: benchmark.sla.inputTokensP50 + 1,
    };
    const result = evaluateBenchmarkRun(benchmark, observation);
    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/buildHealth/);
    expect(result.failures.join("\n")).toMatch(/routeProbes/);
    expect(result.failures.join("\n")).toMatch(/runtimeConsole/);
    expect(result.failures.join("\n")).toMatch(/responsiveAndAccessibility/);
    expect(result.failures.join("\n")).toMatch(/cloudResources/);
    expect(result.failures.join("\n")).toMatch(/sla/);
    expect(result.checks.buildHealth).toBe(false);
    expect(result.checks.turnsWithinSla).toBe(false);
    expect(result.checks.inputTokensWithinSla).toBe(false);
  });

  it("fails when only the SLA is violated", () => {
    const result = evaluateBenchmarkRun(benchmark, {
      ...passingObservation(benchmark),
      cloudResources: { ...cloudNone, hasDatabaseTables: true },
      turns: benchmark.sla.turnsP95 + 1,
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toContain("turns exceeded SLA");
  });

  it("fails on extra production builds against the SLA cap", () => {
    const result = evaluateBenchmarkRun(benchmark, {
      ...passingObservation(benchmark),
      cloudResources: { ...cloudNone, hasDatabaseTables: true },
      productionBuilds: 2,
    });
    expect(result.passed).toBe(false);
    expect(result.failures.join(" ")).toContain("production builds exceeded SLA");
  });
});

describe("percentile", () => {
  it("returns null for empty input", () => {
    expect(percentile([], 50)).toBeNull();
  });

  it("uses nearest-rank on odd samples", () => {
    expect(percentile([3, 1, 2], 50)).toBe(2);
    expect(percentile([3, 1, 2], 100)).toBe(3);
    expect(percentile([3, 1, 2], 0)).toBe(1);
  });

  it("returns the upper value for p50 on even samples", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile([10, 20], 95)).toBe(20);
  });

  it("handles a single sample", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
  });
});

describe("aggregateBenchmarkRuns", () => {
  const benchmark = getBenchmarkById("marketing-site")!;

  function run(overrides: Partial<BenchmarkRunMetrics>): BenchmarkRunMetrics {
    return {
      timeToFirstPreviewMs: 80_000,
      totalDurationMs: 200_000,
      turns: 10,
      inputTokens: 400_000,
      productionBuilds: 1,
      passed: true,
      ...overrides,
    };
  }

  it("returns null percentiles and zero pass rate for no runs", () => {
    const aggregate = aggregateBenchmarkRuns(benchmark, []);
    expect(aggregate.runCount).toBe(0);
    expect(aggregate.timeToFirstPreviewMs.p50).toBeNull();
    expect(aggregate.passRate).toBe(0);
    expect(aggregate.meetsSla).toBe(false);
  });

  it("computes p50/p95 across a healthy set of runs", () => {
    const aggregate = aggregateBenchmarkRuns(benchmark, [
      run({ timeToFirstPreviewMs: 60_000, totalDurationMs: 180_000 }),
      run({ timeToFirstPreviewMs: 80_000, totalDurationMs: 220_000 }),
      run({ timeToFirstPreviewMs: 100_000, totalDurationMs: 260_000 }),
    ]);
    expect(aggregate.runCount).toBe(3);
    expect(aggregate.timeToFirstPreviewMs.p50).toBe(80_000);
    expect(aggregate.timeToFirstPreviewMs.p95).toBe(100_000);
    expect(aggregate.totalDurationMs.p95).toBe(260_000);
    expect(aggregate.passRate).toBe(1);
    expect(aggregate.meetsSla).toBe(true);
  });

  it("computes pass rate from passed flags", () => {
    const aggregate = aggregateBenchmarkRuns(benchmark, [
      run({ passed: true }),
      run({ passed: false }),
      run({ passed: false }),
      run({ passed: false }),
    ]);
    expect(aggregate.passRate).toBe(0.25);
  });

  it("flags SLA misses on aggregates", () => {
    const aggregate = aggregateBenchmarkRuns(benchmark, [
      run({ timeToFirstPreviewMs: benchmark.sla.firstPreviewP50Ms + 1 }),
    ]);
    expect(aggregate.meetsSla).toBe(false);
  });

  it("meets the SLA exactly at the cap", () => {
    const aggregate = aggregateBenchmarkRuns(benchmark, [
      run({ timeToFirstPreviewMs: 60_000 }),
      run({ timeToFirstPreviewMs: benchmark.sla.firstPreviewP95Ms }),
    ]);
    expect(aggregate.meetsSla).toBe(true);
  });
});

describe("compareBenchmarkBaselines", () => {
  const benchmark = getBenchmarkById("marketing-site")!;

  function metrics(overrides: Partial<BenchmarkRunMetrics>): BenchmarkRunMetrics {
    return {
      timeToFirstPreviewMs: 80_000,
      totalDurationMs: 200_000,
      turns: 10,
      inputTokens: 400_000,
      productionBuilds: 1,
      passed: true,
      ...overrides,
    };
  }

  it("reports no regressions against an identical baseline", () => {
    const baseline = aggregateBenchmarkRuns(benchmark, [metrics({})]);
    const candidate = aggregateBenchmarkRuns(benchmark, [metrics({})]);
    const comparison = compareBenchmarkBaselines(baseline, candidate);
    expect(comparison.regressions).toEqual([]);
    expect(comparison.deltas["turns.p50"]).toBe(0);
    expect(comparison.deltas["passRate"]).toBe(0);
  });

  it("flags regressions on every worsening metric", () => {
    const baseline = aggregateBenchmarkRuns(benchmark, [
      metrics({ timeToFirstPreviewMs: 80_000, turns: 10, inputTokens: 400_000 }),
    ]);
    const candidate = aggregateBenchmarkRuns(benchmark, [
      metrics({ timeToFirstPreviewMs: 100_000, turns: 12, inputTokens: 500_000, passed: false }),
    ]);
    const comparison = compareBenchmarkBaselines(baseline, candidate);
    expect(comparison.regressions).toContain("timeToFirstPreviewMs.p50");
    expect(comparison.regressions).toContain("turns.p50");
    expect(comparison.regressions).toContain("inputTokens.p50");
    expect(comparison.regressions).toContain("passRate");
    expect(comparison.deltas["timeToFirstPreviewMs.p50"]).toBe(25);
  });

  it("does not flag improvements as regressions", () => {
    const baseline = aggregateBenchmarkRuns(benchmark, [metrics({ turns: 12 })]);
    const candidate = aggregateBenchmarkRuns(benchmark, [metrics({ turns: 8 })]);
    const comparison = compareBenchmarkBaselines(baseline, candidate);
    expect(comparison.regressions).toEqual([]);
    expect(comparison.deltas["turns.p50"]).toBeCloseTo(-33.333, 3);
  });

  it("flags a lost meetsSla status", () => {
    const baseline = aggregateBenchmarkRuns(benchmark, [metrics({})]);
    const candidate = aggregateBenchmarkRuns(benchmark, [
      metrics({ timeToFirstPreviewMs: benchmark.sla.firstPreviewP50Ms + 1 }),
    ]);
    const comparison = compareBenchmarkBaselines(baseline, candidate);
    expect(comparison.regressions).toContain("meetsSla");
  });
});
