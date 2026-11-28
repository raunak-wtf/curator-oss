/**
 * Server-only feature flags controlling the staged Build Performance Roadmap rollout.
 * All optimization flags default to `false` until explicitly enabled in server env for canary testing.
 */

function parseBooleanFlag(raw: string | undefined): boolean {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export const DEFAULT_SCAFFOLD_VERSION = "1.1.0";

export function isScaffoldBootstrapEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseBooleanFlag(env.COGNIX_PERF_SCAFFOLD_BOOTSTRAP);
}

export function isBoundedAgentEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseBooleanFlag(env.COGNIX_PERF_BOUNDED_AGENT);
}

export function isContextCompactionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseBooleanFlag(env.COGNIX_PERF_CONTEXT_COMPACTION);
}

export function isOneBuildPolicyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseBooleanFlag(env.COGNIX_PERF_ONE_BUILD);
}

export function getPinnedScaffoldVersion(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.COGNIX_SCAFFOLD_VERSION?.trim();
  return value && /^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/i.test(value) ? value : DEFAULT_SCAFFOLD_VERSION;
}

export function getPerformanceArchitectureMetadata(env: NodeJS.ProcessEnv = process.env) {
  return {
    scaffoldVersion: getPinnedScaffoldVersion(env),
    flags: {
      scaffoldBootstrap: isScaffoldBootstrapEnabled(env),
      boundedAgent: isBoundedAgentEnabled(env),
      contextCompaction: isContextCompactionEnabled(env),
      oneBuildPolicy: isOneBuildPolicyEnabled(env),
    },
  };
}
