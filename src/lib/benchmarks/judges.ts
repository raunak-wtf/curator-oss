import type { BenchmarkDefinition, ExpectedCloudFeature } from "./suite";

export interface RouteProbe {
  route: string;
  status: number;
  bodyLength: number;
  hasNextErrorOverlay?: boolean;
}

export interface CloudResourceObservation {
  hasDatabaseTables: boolean;
  hasAuthRoutes: boolean;
  hasStorageBucket: boolean;
  hasEmailAdapter: boolean;
}

export interface BenchmarkRunObservation {
  buildPassed: boolean;
  productionBuilds: number;
  routeProbes: RouteProbe[];
  browserErrors: number;
  serverErrors: number;
  overflowViewports: string[];
  missingAltCount: number;
  unlabeledIconButtons: number;
  primaryInteractionPassed: boolean;
  cloudResources: CloudResourceObservation;
  turns: number;
  inputTokens: number;
}

export interface JudgeResult {
  passed: boolean;
  failures: string[];
  checks: Record<string, boolean>;
}

export function judgeBuildHealth(input: {
  buildPassed: boolean;
  productionBuilds: number;
  maxExtraBuilds?: number;
}): JudgeResult {
  const maxBuilds = 1 + (input.maxExtraBuilds ?? 0);
  const withinBudget = input.productionBuilds <= maxBuilds;
  return {
    passed: input.buildPassed && withinBudget,
    failures: [
      ...(input.buildPassed ? [] : ["production build failed"]),
      ...(withinBudget ? [] : [`expected at most ${maxBuilds} production builds, saw ${input.productionBuilds}`]),
    ],
    checks: {
      buildPassed: input.buildPassed,
      productionBuildsWithinBudget: withinBudget,
    },
  };
}

export function judgeRouteProbes(requiredRoutes: string[], probes: RouteProbe[]): JudgeResult {
  const byRoute = new Map(probes.map((probe) => [probe.route, probe]));
  const checks: Record<string, boolean> = {};
  const failures: string[] = [];
  for (const route of requiredRoutes) {
    const probe = byRoute.get(route);
    if (!probe) {
      checks[route] = false;
      failures.push(`route ${route} was not probed`);
      continue;
    }
    const ok = probe.status >= 200 && probe.status < 300 && probe.bodyLength > 0 && probe.hasNextErrorOverlay !== true;
    checks[route] = ok;
    if (!ok) {
      failures.push(
        `route ${route} failed (status ${probe.status}, body ${probe.bodyLength}${
          probe.hasNextErrorOverlay ? ", next error overlay present" : ""
        })`,
      );
    }
  }
  return { passed: failures.length === 0, failures, checks };
}

export function judgeRuntimeConsole(input: { browserErrors: number; serverErrors: number }): JudgeResult {
  const browserClean = input.browserErrors === 0;
  const serverClean = input.serverErrors === 0;
  return {
    passed: browserClean && serverClean,
    failures: [
      ...(browserClean ? [] : [`${input.browserErrors} browser console error(s)`]),
      ...(serverClean ? [] : [`${input.serverErrors} server error(s)`]),
    ],
    checks: {
      browserConsoleClean: browserClean,
      serverLogsClean: serverClean,
    },
  };
}

export function judgeResponsiveAndAccessibility(input: {
  overflowViewports: string[];
  missingAltCount: number;
  unlabeledIconButtons: number;
  primaryInteractionPassed: boolean;
}): JudgeResult {
  const noOverflow = input.overflowViewports.length === 0;
  const altsOk = input.missingAltCount === 0;
  const labelsOk = input.unlabeledIconButtons === 0;
  const checks: Record<string, boolean> = {
    noHorizontalOverflow: noOverflow,
    imagesHaveAltText: altsOk,
    iconButtonsLabeled: labelsOk,
    primaryInteraction: input.primaryInteractionPassed,
  };
  const failures: string[] = [
    ...(noOverflow ? [] : [`horizontal overflow on: ${input.overflowViewports.join(", ")}`]),
    ...(altsOk ? [] : [`${input.missingAltCount} image(s) missing alt text`]),
    ...(labelsOk ? [] : [`${input.unlabeledIconButtons} icon-only button(s) without an accessible name`]),
    ...(input.primaryInteractionPassed ? [] : ["primary interaction failed"]),
  ];
  return { passed: failures.length === 0, failures, checks };
}

const FEATURE_FLAGS: Record<ExpectedCloudFeature, keyof CloudResourceObservation> = {
  database: "hasDatabaseTables",
  auth: "hasAuthRoutes",
  storage: "hasStorageBucket",
  email: "hasEmailAdapter",
};

export function judgeCloudResources(
  expected: BenchmarkDefinition["expectedCloudFeatures"],
  actual: CloudResourceObservation,
): JudgeResult {
  const checks: Record<string, boolean> = {};
  const failures: string[] = [];
  for (const feature of expected) {
    const present = actual[FEATURE_FLAGS[feature]];
    checks[feature] = present;
    if (!present) {
      failures.push(`expected cloud feature "${feature}" was not provisioned`);
    }
  }
  return { passed: failures.length === 0, failures, checks };
}

export function evaluateBenchmarkRun(
  benchmark: BenchmarkDefinition,
  observation: BenchmarkRunObservation,
): JudgeResult {
  const results: JudgeResult[] = [
    judgeBuildHealth({
      buildPassed: observation.buildPassed,
      productionBuilds: observation.productionBuilds,
    }),
    judgeRouteProbes(benchmark.requiredRoutes, observation.routeProbes),
    judgeRuntimeConsole({
      browserErrors: observation.browserErrors,
      serverErrors: observation.serverErrors,
    }),
    judgeResponsiveAndAccessibility({
      overflowViewports: observation.overflowViewports,
      missingAltCount: observation.missingAltCount,
      unlabeledIconButtons: observation.unlabeledIconButtons,
      primaryInteractionPassed: observation.primaryInteractionPassed,
    }),
    judgeCloudResources(benchmark.expectedCloudFeatures, observation.cloudResources),
  ];

  const turnsWithinSla = observation.turns <= benchmark.sla.turnsP95;
  const inputTokensWithinSla = observation.inputTokens <= benchmark.sla.inputTokensP50;
  const productionBuildsWithinSla = observation.productionBuilds <= benchmark.sla.maxProductionBuilds;

  const slaResult: JudgeResult = {
    passed: turnsWithinSla && inputTokensWithinSla && productionBuildsWithinSla,
    failures: [
      ...(turnsWithinSla ? [] : [`${observation.turns} turns exceeded SLA cap of ${benchmark.sla.turnsP95}`]),
      ...(inputTokensWithinSla
        ? []
        : [`${observation.inputTokens} input tokens exceeded SLA budget of ${benchmark.sla.inputTokensP50}`]),
      ...(productionBuildsWithinSla
        ? []
        : [
            `${observation.productionBuilds} production builds exceeded SLA cap of ${benchmark.sla.maxProductionBuilds}`,
          ]),
    ],
    checks: {
      turnsWithinSla,
      inputTokensWithinSla,
      productionBuildsWithinSla,
    },
  };

  const checks: Record<string, boolean> = {
    buildHealth: true,
    routeProbes: true,
    runtimeConsole: true,
    responsiveAndAccessibility: true,
    cloudResources: true,
    ...slaResult.checks,
  };
  const failures: string[] = [];
  const names = ["buildHealth", "routeProbes", "runtimeConsole", "responsiveAndAccessibility", "cloudResources"] as const;
  results.forEach((result, index) => {
    const name = names[index];
    checks[name] = result.passed;
    if (!result.passed) {
      failures.push(`${name}: ${result.failures.join("; ")}`);
    }
  });
  if (!slaResult.passed) {
    failures.push(`sla: ${slaResult.failures.join("; ")}`);
  }

  return { passed: failures.length === 0, failures, checks };
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index];
}

export interface BenchmarkRunMetrics {
  timeToFirstPreviewMs: number;
  totalDurationMs: number;
  turns: number;
  inputTokens: number;
  productionBuilds: number;
  passed: boolean;
}

export interface MetricPercentiles {
  p50: number | null;
  p95: number | null;
}

export interface BenchmarkAggregate {
  runCount: number;
  timeToFirstPreviewMs: MetricPercentiles;
  totalDurationMs: MetricPercentiles;
  turns: MetricPercentiles;
  inputTokens: MetricPercentiles;
  productionBuilds: MetricPercentiles;
  passRate: number;
  meetsSla: boolean;
}

export function aggregateBenchmarkRuns(
  benchmark: BenchmarkDefinition,
  runs: BenchmarkRunMetrics[],
): BenchmarkAggregate {
  const collect = (selector: (run: BenchmarkRunMetrics) => number): MetricPercentiles => ({
    p50: percentile(runs.map(selector), 50),
    p95: percentile(runs.map(selector), 95),
  });

  const passRate = runs.length === 0 ? 0 : runs.filter((run) => run.passed).length / runs.length;

  const timeToFirstPreviewMs = collect((run) => run.timeToFirstPreviewMs);
  const totalDurationMs = collect((run) => run.totalDurationMs);
  const turns = collect((run) => run.turns);
  const inputTokens = collect((run) => run.inputTokens);
  const productionBuilds = collect((run) => run.productionBuilds);

  const within = (value: number | null, cap: number) => value !== null && value <= cap;
  const meetsSla =
    runs.length > 0 &&
    within(timeToFirstPreviewMs.p50, benchmark.sla.firstPreviewP50Ms) &&
    within(timeToFirstPreviewMs.p95, benchmark.sla.firstPreviewP95Ms) &&
    within(totalDurationMs.p50, benchmark.sla.completionP50Ms) &&
    within(totalDurationMs.p95, benchmark.sla.completionP95Ms) &&
    within(turns.p50, benchmark.sla.turnsP50) &&
    within(turns.p95, benchmark.sla.turnsP95) &&
    within(inputTokens.p50, benchmark.sla.inputTokensP50) &&
    within(productionBuilds.p95, benchmark.sla.maxProductionBuilds);

  return {
    runCount: runs.length,
    timeToFirstPreviewMs,
    totalDurationMs,
    turns,
    inputTokens,
    productionBuilds,
    passRate,
    meetsSla,
  };
}

type AggregateMetricPath = "timeToFirstPreviewMs" | "totalDurationMs" | "turns" | "inputTokens" | "productionBuilds";

const DIRECTIONAL_METRICS: Array<{ key: string; path: AggregateMetricPath }> = [
  { key: "timeToFirstPreviewMs.p50", path: "timeToFirstPreviewMs" },
  { key: "timeToFirstPreviewMs.p95", path: "timeToFirstPreviewMs" },
  { key: "totalDurationMs.p50", path: "totalDurationMs" },
  { key: "totalDurationMs.p95", path: "totalDurationMs" },
  { key: "turns.p50", path: "turns" },
  { key: "turns.p95", path: "turns" },
  { key: "inputTokens.p50", path: "inputTokens" },
  { key: "inputTokens.p95", path: "inputTokens" },
  { key: "productionBuilds.p50", path: "productionBuilds" },
  { key: "productionBuilds.p95", path: "productionBuilds" },
];

function deltaPercent(baseline: number | null, candidate: number | null): number | null {
  if (baseline === null || candidate === null || baseline === 0) return null;
  return ((candidate - baseline) / baseline) * 100;
}

export interface BaselineComparison {
  deltas: Record<string, number | null>;
  regressions: string[];
}

export function compareBenchmarkBaselines(baseline: BenchmarkAggregate, candidate: BenchmarkAggregate): BaselineComparison {
  const deltas: Record<string, number | null> = {};
  const regressions: string[] = [];

  for (const metric of DIRECTIONAL_METRICS) {
    const level = metric.key.endsWith(".p95") ? "p95" : "p50";
    const base = baseline[metric.path][level];
    const cand = candidate[metric.path][level];
    const delta = deltaPercent(base, cand);
    deltas[metric.key] = delta;
    if (cand !== null && base !== null && cand > base) {
      regressions.push(metric.key);
    }
  }

  const passRateDelta = deltaPercent(baseline.passRate, candidate.passRate);
  deltas["passRate"] = passRateDelta;
  if (candidate.passRate < baseline.passRate) {
    regressions.push("passRate");
  }

  deltas["meetsSla"] = baseline.meetsSla === candidate.meetsSla ? 0 : null;
  if (baseline.meetsSla && !candidate.meetsSla) {
    regressions.push("meetsSla");
  }

  return { deltas, regressions };
}
