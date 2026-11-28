import { describe, expect, it } from "vitest";
import {
  classifyFrontendDesignWork,
  createFrontendDesignBlueprint,
  renderFrontendDesignBlueprint,
} from "./frontend-design-blueprint";

describe("frontend design blueprint", () => {
  it("stays out of backend-only repairs and keeps focused UI edits lightweight", () => {
    expect(classifyFrontendDesignWork({ prompt: "Fix the webhook retry API", isNewProject: false })).toBe("none");
    expect(classifyFrontendDesignWork({ prompt: "Increase the settings button spacing", isNewProject: false })).toBe("lightweight");
  });

  it("uses a deep pass for new apps and visual references", () => {
    expect(classifyFrontendDesignWork({ prompt: "A notes app", isNewProject: true })).toBe("deep");
    expect(
      classifyFrontendDesignWork({ prompt: "Match this header", isNewProject: false, hasVisualReference: true }),
    ).toBe("deep");
  });

  it("produces domain and surface-specific direction instead of a generic template", () => {
    const blueprint = createFrontendDesignBlueprint({
      prompt: "Build a finance dashboard for tracking invoices and cash flow",
      isNewProject: true,
    });
    expect(blueprint).toMatchObject({ depth: "deep", surface: "workspace", family: "finance" });
    expect(blueprint?.direction).toContain("financial ledger");
    expect(blueprint?.composition).toContain("Open directly on the work");
    expect(blueprint?.guideTopics).toContain("design-critique");
  });

  it("routes screenshot work to reference forensics and renders compact contextual instructions", () => {
    const blueprint = createFrontendDesignBlueprint({
      prompt: "Recreate this shop page",
      isNewProject: false,
      hasVisualReference: true,
    });
    expect(blueprint?.guideTopics).toContain("reference-forensics");
    const rendered = renderFrontendDesignBlueprint(blueprint);
    expect(rendered).toContain("<frontend_design_blueprint>");
    expect(rendered).toContain("surface: commerce");
    expect(rendered.length).toBeLessThan(2_500);
  });
});
