import { describe, expect, it } from "vitest";
import {
  BUILTIN_CLOUD_SKILLS,
  CLOUD_ARCHITECTURE_SKILLS,
  cloudSkillsContext,
  isBuiltinCloudSkillName,
  resolveBuiltinCloudSkills,
} from "./cloud-skills";

describe("cloud-skills", () => {
  it("renders built-in Cloud architecture skills only when Cognix Cloud is enabled", () => {
    expect(cloudSkillsContext(false)).toBe("");

    const active = cloudSkillsContext(true);
    expect(active).toContain("## Built-in Cognix Cloud architecture skills");
    for (const skill of CLOUD_ARCHITECTURE_SKILLS) {
      expect(active).toContain(`<cloud-skill name="${skill.name}">`);
    }
    expect(active).toContain("process.loadEnvFile");
    expect(active).toContain("drizzleAdapter");
    expect(active).toContain("forcePathStyle: true");
  });

  it("exposes /cloud-* slash skills and resolves them in prompt order", () => {
    expect(BUILTIN_CLOUD_SKILLS.map((s) => s.name)).toEqual([
      "cloud-fullstack",
      "cloud-database",
      "cloud-auth",
      "cloud-storage",
      "cloud-email",
    ]);
    expect(isBuiltinCloudSkillName("cloud-fullstack")).toBe(true);
    expect(isBuiltinCloudSkillName("custom-skill")).toBe(false);

    const resolved = resolveBuiltinCloudSkills(["cloud-auth", "unknown", "cloud-database"]);
    expect(resolved.map((s) => s.name)).toEqual(["cloud-auth", "cloud-database"]);
  });
});
