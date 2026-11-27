import { describe, expect, it } from "vitest";
import {
  SECURITY_REVIEW_PROFILES,
  SECURITY_REVIEW_SKILLS,
  securityMethodologyContext,
} from "./security-methodology";

describe("built-in security review methodology", () => {
  it("keeps stable, uniquely named review profiles and skills", () => {
    expect(SECURITY_REVIEW_PROFILES.map((profile) => profile.name)).toEqual([
      "quick",
      "standard",
      "deep",
      "full",
    ]);

    const names = SECURITY_REVIEW_SKILLS.map((skill) => skill.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([
      "scope-recon-and-coverage",
      "source-and-tool-assisted-review",
      "bounded-validation-and-triage",
      "risk-remediation-and-reporting",
    ]);
    expect(SECURITY_REVIEW_SKILLS.every((skill) => skill.description && skill.instructions.length >= 5)).toBe(true);
  });

  it("renders every method in stable order without bloating the system prompt", () => {
    const context = securityMethodologyContext();
    let previousIndex = -1;

    for (const skill of SECURITY_REVIEW_SKILLS) {
      const index = context.indexOf(`<security-skill name="${skill.name}">`);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }

    expect(context.length).toBeLessThan(14_000);
  });

  it("preserves the removed engine's stages and evidence gate", () => {
    const context = securityMethodologyContext();
    expect(context).toContain("repository intelligence");
    expect(context).toContain("dependencies and supply chain");
    expect(context).toContain("secrets and configuration");
    expect(context).toContain("static source analysis");
    expect(context).toContain("infrastructure as code and cloud policy");
    expect(context).toContain("optional bounded dynamic validation");
    expect(context).toContain("fresh skeptical verification pass");
    expect(context).toContain("coverage-critic pass");
    expect(context).toContain("directly imported and reachable in application source");
    expect(context).toContain("shared advisory aliases");
    expect(context).toContain("Calibrate contextual risk");
    expect(context).toContain("Critical, High, Medium, Low, Info");
    expect(context).toContain("concrete security-boundary result");
    expect(context).toContain("NEEDS VALIDATION section with no severity");
  });

  it("keeps tool use source-first and active testing safely bounded", () => {
    const context = securityMethodologyContext();
    expect(context).toContain("never install or update packages");
    expect(context).toContain("invoke npx or an equivalent downloader");
    expect(context).toContain("Do not read or print any .env* file or ../.cognix-env");
    expect(context).toContain("Never contact, scan, fuzz, brute-force, or exploit a deployed or shared endpoint");
    expect(context).toContain("Auto approval");
    expect(context).toContain("do not run repository scripts, tests, builds, servers");
    expect(context).toContain("only loopback, dummy principals and data");
  });
});
