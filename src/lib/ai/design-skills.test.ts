import { describe, expect, it } from "vitest";
import type { Attachment, Project } from "../types";
import { DESIGN_GUIDES, DESIGN_GUIDE_LABELS, DESIGN_GUIDE_TOPICS } from "./design-guides";
import { DESIGN_TO_CODE_SKILLS, designToCodeContext, planDesignToCodeContext } from "./design-skills";
import { INTERACTIVE_TOOL_NAMES, interactiveTools, runInteractiveTool } from "./interactive-tools";
import { buildSecurityPrompt } from "./security-prompt";
import { buildPlanSystemPrompt, buildSystemPrompt } from "./system-prompt";

const buildProject: Project = {
  id: "project-design-1",
  ownerId: "user-1",
  title: "Fieldnote Studio",
  description: "",
  status: "building",
  coverGradient: "aurora",
  sandboxId: "sandbox-1",
  previewUrl: null,
  publishSlug: null,
  publishedAt: null,
  showBadge: true,
  publicRemix: false,
  mode: "build",
  securitySource: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const imageAttachment: Attachment = {
  id: "att-img-1",
  projectId: buildProject.id,
  ownerId: buildProject.ownerId,
  name: "landing-mockup.png",
  contentType: "image/png",
  size: 24_000,
  objectKey: "objects/landing-mockup.png",
  sandboxPath: "/home/daytona/app/uploads/att-img-1-landing-mockup.png",
  createdAt: new Date().toISOString(),
};

describe("internal design-to-code system (Atharvsinh-codez/skills)", () => {
  it("provides all 7 Cognix-adapted internal design playbooks without external harness leaks", () => {
    expect(DESIGN_GUIDE_TOPICS).toEqual([
      "core",
      "art-direction",
      "reference-forensics",
      "typography-and-fonts",
      "interface-craft",
      "motion",
      "verification",
    ]);

    for (const topic of DESIGN_GUIDE_TOPICS) {
      const content = DESIGN_GUIDES[topic];
      expect(DESIGN_GUIDE_LABELS[topic]).toBeTruthy();
      expect(content.length).toBeGreaterThan(1_000);
      expect(content).not.toContain(".openai/hosting.json");
      expect(content).not.toContain("control-browser");
      expect(content).not.toContain("sites-building");
      expect(content).not.toContain("imagegen");
    }

    expect(DESIGN_GUIDES["typography-and-fonts"]).toContain("GeistSerif");
    expect(DESIGN_GUIDES["interface-craft"]).toContain("Zero emojis");
    expect(DESIGN_GUIDES["motion"]).toContain("cubic-bezier(0.23, 1, 0.32, 1)");
    expect(DESIGN_GUIDES["reference-forensics"]).toContain("Observed");
  });

  it("exposes internal read_design_guide tool even when Cognix Cloud is off and never pauses runs", () => {
    expect(INTERACTIVE_TOOL_NAMES).toContain("read_design_guide");
    const toolDef = interactiveTools.find((tool) => tool.function.name === "read_design_guide");
    expect(toolDef).toBeDefined();

    for (const topic of DESIGN_GUIDE_TOPICS) {
      const result = runInteractiveTool(
        "read_design_guide",
        { topic },
        { cloudEnabled: false, alreadyAsked: false },
      );
      expect(result.request).toBeUndefined();
      expect(result.output).toBe(DESIGN_GUIDES[topic]);
      expect(result.summary).toContain(DESIGN_GUIDE_LABELS[topic]);
    }
  });

  it("renders unique internal design skills and activates image-to-code forensics when images are attached", () => {
    const names = DESIGN_TO_CODE_SKILLS.map((skill) => skill.name);
    expect(new Set(names).size).toBe(names.length);

    const textOnly = designToCodeContext({ hasImageAttachments: false });
    expect(textOnly).toContain("## Built-in design-to-code system");
    expect(textOnly).toContain("read_design_guide");
    expect(textOnly).toContain("Strict SVG-only iconography & zero emojis");
    expect(textOnly).toContain("lightest-sufficient grouping ladder");
    expect(textOnly).toContain("concentric border radii");
    expect(textOnly).not.toContain("<image_to_code_priority>");

    const withImage = designToCodeContext({ hasImageAttachments: true });
    expect(withImage).toContain("<image_to_code_priority>");
    expect(withImage).toContain('read_design_guide({ topic: "reference-forensics" })');
  });

  it("injects internal design-to-code automatically into Build and Plan prompts, never into Security mode", () => {
    const buildPromptNoImg = buildSystemPrompt(buildProject, "/home/daytona/app");
    expect(buildPromptNoImg).toContain("## Built-in design-to-code system");
    expect(buildPromptNoImg).toContain('<design-skill name="design-to-code-dispatch-and-forensics">');
    expect(buildPromptNoImg).toContain('<design-skill name="color-theme-and-surface-system">');
    expect(buildPromptNoImg).toContain('<design-skill name="typography-svg-and-motion-craft">');
    expect(buildPromptNoImg).not.toContain("<image_to_code_priority>");

    const buildPromptWithImg = buildSystemPrompt(buildProject, "/home/daytona/app", [imageAttachment]);
    expect(buildPromptWithImg).toContain("<image_to_code_priority>");

    const planPrompt = buildPlanSystemPrompt(buildProject, "/home/daytona/app", [imageAttachment]);
    expect(planPrompt).toContain("## Built-in design-to-code planning intelligence");
    expect(planPrompt).toContain("read_design_guide");
    expect(planPrompt).toContain("reference-forensics");
    expect(planDesignToCodeContext({ hasImageAttachments: false })).not.toContain("Visual image attachments are present");

    const securityPrompt = buildSecurityPrompt({ ...buildProject, mode: "security" }, "/home/daytona/app");
    expect(securityPrompt).not.toContain("Built-in design-to-code system");
    expect(securityPrompt).not.toContain("design-to-code-dispatch-and-forensics");
    expect(securityPrompt).not.toContain("read_design_guide");
  });
});
