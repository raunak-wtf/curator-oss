import { describe, expect, it } from "vitest";
import {
  LOW_CREDITS_THRESHOLD_HUNDREDTHS,
  PRO_MONTHLY_CREDITS_HUNDREDTHS,
  PRO_PLAN_NAME,
  PRO_PLAN_PRICE_CENTS,
  calculateAgentCredits,
  estimateTokensFromChars,
  formatCredits,
  formatCurrencyCents,
} from "./credits";

describe("Lovable-style effort-based credit calculation", () => {
  it("configures a single $10/month Curator Pro plan with 90 monthly credits and 3-credit low warning threshold", () => {
    expect(PRO_PLAN_NAME).toBe("Curator Pro");
    expect(PRO_PLAN_PRICE_CENTS).toBe(1000);
    expect(PRO_MONTHLY_CREDITS_HUNDREDTHS).toBe(9000);
    expect(LOW_CREDITS_THRESHOLD_HUNDREDTHS).toBe(300);
    expect(formatCurrencyCents(PRO_PLAN_PRICE_CENTS)).toBe("$10");
    expect(formatCredits(PRO_MONTHLY_CREDITS_HUNDREDTHS)).toBe("90");
  });

  it("charges fractional credits (~0.50) for light UI edits", () => {
    const result = calculateAgentCredits({
      mode: "build",
      promptTokens: 8_000,
      completionTokens: 1_200,
      turns: 2,
      toolCalls: 2,
      filesChanged: 1,
      commandsRun: 0,
      cloudActions: 0,
      durationMs: 4_500,
    });
    expect(result.creditsHundredths).toBeGreaterThanOrEqual(50);
    expect(result.creditsHundredths).toBeLessThanOrEqual(75);
    expect(result.complexityTier).toBe("light");
  });

  it("charges 1.00 base credit + variable research effort in Plan mode", () => {
    const simplePlan = calculateAgentCredits({
      mode: "plan",
      promptTokens: 5_000,
      completionTokens: 1_500,
      turns: 1,
      toolCalls: 0,
      filesChanged: 0,
      commandsRun: 0,
      cloudActions: 0,
      durationMs: 3_000,
    });
    expect(simplePlan.creditsHundredths).toBe(100);
    expect(simplePlan.complexityTier).toBe("standard");

    const deepPlan = calculateAgentCredits({
      mode: "plan",
      promptTokens: 80_000,
      completionTokens: 10_000,
      turns: 5,
      toolCalls: 12,
      filesChanged: 0,
      commandsRun: 0,
      cloudActions: 0,
      durationMs: 25_000,
    });
    expect(deepPlan.creditsHundredths).toBeGreaterThan(simplePlan.creditsHundredths);
    expect(deepPlan.creditsHundredths).toBeLessThanOrEqual(500);
  });

  it("scales up dynamically for multi-turn full-stack builds with cloud actions", () => {
    const fullStack = calculateAgentCredits({
      mode: "build",
      promptTokens: 160_000,
      completionTokens: 32_000,
      turns: 8,
      toolCalls: 22,
      filesChanged: 12,
      commandsRun: 4,
      cloudActions: 3,
      durationMs: 90_000,
    });
    expect(fullStack.creditsHundredths).toBeGreaterThanOrEqual(250);
    expect(["heavy", "extended"]).toContain(fullStack.complexityTier);
    expect(fullStack.creditsHundredths % 5).toBe(0);
  });

  it("estimates tokens safely and formats fractional credits cleanly", () => {
    expect(estimateTokensFromChars(0)).toBe(0);
    expect(estimateTokensFromChars(400)).toBe(100);
    expect(formatCredits(50)).toBe("0.50");
    expect(formatCredits(125)).toBe("1.25");
    expect(formatCredits(5000)).toBe("50");
  });
});
