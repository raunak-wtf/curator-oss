import { describe, expect, it } from "vitest";
import type { Project } from "../types";
import { FRONTEND_TASTE_SKILLS, frontendTasteContext } from "./frontend-taste";
import { buildSecurityPrompt } from "./security-prompt";
import { buildSystemPrompt } from "./system-prompt";

const project: Project = {
  id: "project-1",
  ownerId: "user-1",
  title: "Inventory Studio",
  description: "",
  status: "building",
  coverGradient: "aurora",
  sandboxId: "sandbox-1",
  previewUrl: null,
  publishSlug: null,
  publishedAt: null,
  showBadge: true,
  publicRemix: false,
  mode: "security",
  securitySource: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("frontend taste skills", () => {
  it("keeps a compact, uniquely named first-party skill pack", () => {
    const names = FRONTEND_TASTE_SKILLS.map((skill) => skill.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(["product-art-direction", "visual-composition", "interaction-and-production-polish"]);
    expect(FRONTEND_TASTE_SKILLS.every((skill) => skill.description && skill.instructions.length >= 3)).toBe(true);
    expect(frontendTasteContext().length).toBeLessThan(10_000);
  });

  it("renders every skill in stable order", () => {
    const context = frontendTasteContext();
    let previousIndex = -1;
    for (const skill of FRONTEND_TASTE_SKILLS) {
      const index = context.indexOf(`<taste-skill name="${skill.name}">`);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
  });

  it("does not leak the build-only taste pack into Security mode", () => {
    const prompt = buildSecurityPrompt(project, "/home/daytona/app");
    expect(prompt).not.toContain("Built-in frontend taste skills");
    expect(prompt).not.toContain("product-art-direction");
  });

  it("does not leak the Security review pack into Build mode", () => {
    const prompt = buildSystemPrompt({ ...project, mode: "build" }, "/home/daytona/app");
    expect(prompt).not.toContain("Built-in security review skills");
    expect(prompt).not.toContain("bounded-validation-and-triage");
  });
});
