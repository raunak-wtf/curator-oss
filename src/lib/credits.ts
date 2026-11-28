import type { CreditComplexityTier } from "./types";

/** Single paid plan: $10/month Curator Pro with 90 monthly credits and no free tier. */
export const PRO_PLAN_CODE = "pro_monthly";
export const PRO_PLAN_NAME = "Curator Pro";
export const PRO_PLAN_PRICE_CENTS = 1000; // $10.00 / month
export const PRO_PLAN_CURRENCY = "USD";

/**
 * Stored in credit hundredths (100 = 1.00 credit) to prevent floating-point drift.
 * 90.00 monthly credits at $10/mo, aligned with Lovable's effort-based scale where
 * quick edits cost ~0.50 credits, Plan mode costs 1.00 + research effort, and full-stack
 * builds cost ~1.50–4.00+ credits depending on actual agent effort.
 */
export const PRO_MONTHLY_CREDITS_HUNDREDTHS = 9_000;
/** Unused monthly credits roll over on renewal up to 2x monthly allowance (180.00 credits). */
export const PRO_MAX_ROLLOVER_CREDITS_HUNDREDTHS = 18_000;
/** Threshold below which a low-credit warning appears above the prompt input (3.00 credits). */
export const LOW_CREDITS_THRESHOLD_HUNDREDTHS = 300;

export type AgentCreditInput = {
  mode: "build" | "plan" | "security";
  promptTokens: number;
  completionTokens: number;
  turns: number;
  toolCalls: number;
  filesChanged: number;
  commandsRun: number;
  cloudActions: number;
  durationMs: number;
};

export type AgentCreditCalculation = {
  /** Deducted credits in hundredths (e.g. 50 = 0.50 credits, 125 = 1.25 credits). */
  creditsHundredths: number;
  /** Human-readable complexity bucket. */
  complexityTier: CreditComplexityTier;
  /** Short breakdown string stored in the ledger. */
  description: string;
};

function safeInt(value: number, min = 0, fallback = min): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.trunc(value));
}

function roundToNearestFiveHundredths(hundredths: number): number {
  if (!Number.isFinite(hundredths)) return 5;
  return Math.max(5, Math.round(hundredths / 5) * 5);
}

/**
 * Calculates Lovable-style effort-based credits for an agent run.
 *
 * Modeled directly after Lovable's documented credit model:
 * - Plan Mode: 1.00 base credit + variable investigation effort (tool calls & token volume).
 * - Build / Security Mode: dynamic effort-based consumption scaling smoothly with actual work:
 *   - Trivial Q&A / no code changes: ~0.25–0.50 credits
 *   - Simple UI tweak (1–2 files): ~0.50–0.75 credits
 *   - Standard feature (multiple files + build): ~0.85–1.75 credits
 *   - Full-stack build (DB/Auth/Storage + verification loop): ~1.80–4.50+ credits
 */
export function calculateAgentCredits(input: AgentCreditInput): AgentCreditCalculation {
  const promptTokens = safeInt(input.promptTokens, 0);
  const completionTokens = safeInt(input.completionTokens, 0);
  const turns = safeInt(input.turns, 1);
  const toolCalls = safeInt(input.toolCalls, 0);
  const filesChanged = safeInt(input.filesChanged, 0);
  const commandsRun = safeInt(input.commandsRun, 0);
  const cloudActions = safeInt(input.cloudActions, 0);

  // Token work component (hundredths of a credit)
  const tokenEffort =
    (promptTokens / 100_000) * 35 +
    (completionTokens / 25_000) * 55;

  let rawHundredths: number;

  if (input.mode === "plan") {
    // Lovable Plan Mode: 1.00 base credit + variable research effort
    const researchEffort = toolCalls * 4 + tokenEffort * 0.45 + Math.max(0, turns - 1) * 4;
    rawHundredths = Math.min(500, Math.max(100, 100 + researchEffort));
  } else {
    // Build & Security Mode: pure effort-based metering
    const executionEffort =
      turns * 8 +
      toolCalls * 4 +
      filesChanged * 6 +
      commandsRun * 8 +
      cloudActions * 10;

    const minFloor = filesChanged > 0 || commandsRun > 0 || cloudActions > 0 ? 50 : 25;
    // Cap a single prompt run at 15.00 credits to protect users from runaway loops
    rawHundredths = Math.min(1_500, Math.max(minFloor, tokenEffort + executionEffort));
  }

  const creditsHundredths = roundToNearestFiveHundredths(rawHundredths);

  const complexityTier: CreditComplexityTier =
    creditsHundredths <= 75
      ? "light"
      : creditsHundredths <= 175
        ? "standard"
        : creditsHundredths <= 350
          ? "heavy"
          : "extended";

  const parts: string[] = [];
  if (input.mode === "plan") {
    parts.push("Plan mode");
  } else if (input.mode === "security") {
    parts.push("Security review");
  } else {
    parts.push("Build run");
  }
  if (filesChanged > 0) parts.push(`${filesChanged} ${filesChanged === 1 ? "file" : "files"}`);
  if (toolCalls > 0) parts.push(`${toolCalls} ${toolCalls === 1 ? "action" : "actions"}`);
  if (cloudActions > 0) parts.push(`${cloudActions} cloud`);

  return {
    creditsHundredths,
    complexityTier,
    description: parts.join(" · "),
  };
}

/** Fallback token estimator when an OpenAI-compatible gateway omits `usage` in streaming mode (~4 chars/token). */
export function estimateTokensFromChars(charCount: number): number {
  if (!Number.isFinite(charCount) || charCount <= 0) return 0;
  return Math.max(1, Math.ceil(charCount / 4));
}

export function formatCredits(creditsHundredths: number): string {
  const safe = Number.isFinite(creditsHundredths) ? creditsHundredths : 0;
  const value = safe / 100;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function formatCurrencyCents(cents: number, currency = "USD"): string {
  const safe = Number.isFinite(cents) ? cents : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: safe % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(safe / 100);
}
