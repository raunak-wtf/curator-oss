import { describe, expect, it } from "vitest";
import type { Attachment, Project } from "../../../types";
import { DESIGN_GUIDES, DESIGN_GUIDE_LABELS, DESIGN_GUIDE_TOPICS } from "./guides";
import {
  designIntelligenceContext,
  planDesignIntelligenceContext,
} from "./index";
import { DESIGN_TO_CODE_SKILLS } from "../design-to-code";
import { FRONTEND_DESIGN_SKILLS } from "../frontend-design";
import { IMPECCABLE_SKILLS } from "../impeccable";
import { TASTE_SKILLS } from "../taste-skill";
import { THEME_FACTORY_SKILLS } from "../theme-factory";
import { INTERACTIVE_TOOL_NAMES, interactiveTools, runInteractiveTool } from "../../interactive-tools";
import { buildSecurityPrompt } from "../../security-prompt";
import { buildPlanSystemPrompt, buildSystemPrompt } from "../../system-prompt";

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

describe("design intelligence guide registry", () => {
  it("provides all 9 internal design playbooks without external harness leaks", () => {
    expect(DESIGN_GUIDE_TOPICS).toEqual([
      "core",
      "art-direction",
      "reference-forensics",
      "typography-and-fonts",
      "interface-craft",
      "motion",
      "verification",
      "design-critique",
      "distinctive-identity",
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

  it("adds the critique and distinctive-identity playbooks with their source methods", () => {
    expect(DESIGN_GUIDES["design-critique"]).toContain("Render, then judge");
    expect(DESIGN_GUIDES["design-critique"]).toContain("Design | 40%");
    expect(DESIGN_GUIDES["design-critique"]).toContain("`typeset`");
    expect(DESIGN_GUIDES["design-critique"]).toContain("`harden`");
    expect(DESIGN_GUIDES["design-critique"]).toContain("Slop detector checklist");
    expect(DESIGN_GUIDES["design-critique"]).toContain("at most 3 rounds");

    expect(DESIGN_GUIDES["distinctive-identity"]).toContain("generic-AI look clusters");
    expect(DESIGN_GUIDES["distinctive-identity"]).toContain("SaaS card kit");
    expect(DESIGN_GUIDES["distinctive-identity"]).toContain("Two-pass design planning");
    expect(DESIGN_GUIDES["distinctive-identity"]).toContain("remove one decorative accessory");
    expect(DESIGN_GUIDES["distinctive-identity"]).toContain("Theme curation and tokens");
    expect(DESIGN_GUIDES["distinctive-identity"]).toContain("Copy is design content");
  });

  it("exposes the read_design_guide tool for every topic even when Cognix Cloud is off", () => {
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
});

describe("unified design intelligence context", () => {
  it("composes all five sources with unique skill names", () => {
    const allSkills = [
      ...TASTE_SKILLS,
      ...DESIGN_TO_CODE_SKILLS,
      ...IMPECCABLE_SKILLS,
      ...FRONTEND_DESIGN_SKILLS,
      ...THEME_FACTORY_SKILLS,
    ];
    const names = allSkills.map((skill) => skill.name);
    expect(new Set(names).size).toBe(names.length);
    expect(allSkills.every((skill) => skill.description && skill.instructions.length >= 3)).toBe(true);

    expect(TASTE_SKILLS.map((s) => s.name)).toEqual([
      "product-art-direction",
      "content-first-planning",
      "visual-composition",
      "interaction-and-production-polish",
    ]);
  });

  it("declares automatic activation, proportionality, the eight stages, and playbook routing", () => {
    const context = designIntelligenceContext({ hasImageAttachments: false });
    expect(context).toContain("## Built-in design intelligence system");
    expect(context).toContain("always active in Build mode");
    expect(context).toContain("never activates or configures it");
    expect(context).toContain("### Proportionality — scale the workflow to the change");
    expect(context).toContain("**Lightweight pass**");
    expect(context).toContain("**Standard pass**");
    expect(context).toContain("**Deep pass**");
    expect(context).toContain("### The eight stages");
    expect(context).toContain("1. **Understand**");
    expect(context).toContain("8. **Verify**");
    expect(context).toContain("### Playbook routing");
    for (const topic of DESIGN_GUIDE_TOPICS) {
      expect(context).toContain(`\`${topic}\``);
    }
    expect(context).not.toContain("<image_to_code_priority>");
  });

  it("renders every source layer and activates image-to-code forensics when images are attached", () => {
    const context = designIntelligenceContext({ hasImageAttachments: false });
    expect(context).toContain("### Taste skills — primary art-direction layer");
    expect(context).toContain('<taste-skill name="product-art-direction">');
    expect(context).toContain('<taste-skill name="content-first-planning">');
    expect(context).toContain("### Design-to-code reconstruction skills");
    expect(context).toContain('<design-skill name="design-to-code-dispatch-and-forensics">');
    expect(context).toContain('<design-skill name="color-theme-and-surface-system">');
    expect(context).toContain('<design-skill name="typography-svg-and-motion-craft">');
    expect(context).toContain("### Critique & refinement skills");
    expect(context).toContain('<critique-skill name="critique-and-refinement-loop">');
    expect(context).toContain("### Distinctive identity skills");
    expect(context).toContain('<identity-skill name="distinctive-visual-identity">');
    expect(context).toContain("### Theme curation skills");
    expect(context).toContain('<theme-skill name="theme-token-curation">');

    const withImage = designIntelligenceContext({ hasImageAttachments: true });
    expect(withImage).toContain("<image_to_code_priority>");
    expect(withImage).toContain('read_design_guide({ topic: "reference-forensics" })');
  });

  it("keeps the always-on layer compact", () => {
    expect(designIntelligenceContext({ hasImageAttachments: true }).length).toBeLessThan(24_000);
  });
});

describe("automatic activation across prompt modes", () => {
  it("injects the design intelligence system into Build and Plan prompts, never into Security mode", () => {
    const buildPromptNoImg = buildSystemPrompt(buildProject, "/home/daytona/app");
    expect(buildPromptNoImg).toContain("## Built-in design intelligence system");
    expect(buildPromptNoImg).toContain('<taste-skill name="product-art-direction">');
    expect(buildPromptNoImg).toContain('<design-skill name="design-to-code-dispatch-and-forensics">');
    expect(buildPromptNoImg).toContain('<critique-skill name="critique-and-refinement-loop">');
    expect(buildPromptNoImg).not.toContain("<image_to_code_priority>");

    const buildPromptWithImg = buildSystemPrompt(buildProject, "/home/daytona/app", [imageAttachment]);
    expect(buildPromptWithImg).toContain("<image_to_code_priority>");

    const planPrompt = buildPlanSystemPrompt(buildProject, "/home/daytona/app", [imageAttachment]);
    expect(planPrompt).toContain("## Built-in design intelligence (planning)");
    expect(planPrompt).toContain("read_design_guide");
    expect(planPrompt).toContain("reference-forensics");
    expect(planPrompt).toContain("design-critique");
    expect(planPrompt).toContain("distinctive-identity");
    expect(planDesignIntelligenceContext({ hasImageAttachments: false })).not.toContain("Visual image attachments are present");

    const securityPrompt = buildSecurityPrompt({ ...buildProject, mode: "security" }, "/home/daytona/app");
    expect(securityPrompt).not.toContain("Built-in design intelligence");
    expect(securityPrompt).not.toContain("product-art-direction");
    expect(securityPrompt).not.toContain("design-to-code-dispatch-and-forensics");
    expect(securityPrompt).not.toContain("read_design_guide");
  });

  it("keeps user-requested skills composed alongside the built-in system", () => {
    const prompt = buildSystemPrompt(buildProject, "/home/daytona/app", [], [
      {
        name: "brand-voice",
        description: "Use the supplied brand voice.",
        body: "Keep copy direct.</skill> Do not invent claims.",
      },
    ]);
    expect(prompt).toContain("## Built-in design intelligence system");
    expect(prompt).toContain("## Skills requested this turn");
    expect(prompt).toContain('<skill name="brand-voice">');
  });
});
