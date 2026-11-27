import { describe, expect, it } from "vitest";
import { CLOUD_ARCHITECTURE_SKILLS, CLOUD_DETECTION_SKILL, cloudSkillsContext } from "./cloud-skills";

describe("cloud-skills (internal automatic agent intelligence)", () => {
  it("injects automatic Cloud capability detection when Cognix Cloud is off", () => {
    const offContext = cloudSkillsContext(false);
    expect(offContext).toContain("## Built-in Cognix Cloud intelligence");
    expect(offContext).toContain(`<cloud-skill name="${CLOUD_DETECTION_SKILL.name}">`);
    expect(offContext).toContain("request_cognix_cloud");
    expect(offContext).not.toContain("cognix-cloud-orchestration");
  });

  it("injects all 5 internal Cloud architecture skills automatically when Cognix Cloud is on", () => {
    const onContext = cloudSkillsContext(true);
    expect(onContext).toContain("## Built-in Cognix Cloud architecture skills");
    for (const skill of CLOUD_ARCHITECTURE_SKILLS) {
      expect(onContext).toContain(`<cloud-skill name="${skill.name}">`);
    }
    expect(onContext).toContain("process.loadEnvFile");
    expect(onContext).toContain("drizzleAdapter");
    expect(onContext).toContain("forcePathStyle: true");
  });
});
