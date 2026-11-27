import { describe, expect, it } from "vitest";
import { SECURITY_TOOL_ORDER, SECURITY_TOOL_TABS, TOOL_ORDER, TOOL_TABS } from "./tool-launcher";

describe("workspace tool launcher", () => {
  it("keeps the security agent in chat instead of exposing a separate scanner tool", () => {
    expect(SECURITY_TOOL_ORDER).toEqual(["terminal", "code", "cloud", "git"]);
    expect(Object.values(SECURITY_TOOL_TABS).map((tool) => tool.label)).toEqual(["Shell", "Files", "Secrets", "Git Control"]);
    expect(JSON.stringify(SECURITY_TOOL_TABS)).not.toMatch(/scan|findings/i);
  });

  it("keeps the Build-mode tool set unchanged", () => {
    expect(TOOL_ORDER).toEqual(["terminal", "code", "cloud", "git"]);
    expect(Object.keys(TOOL_TABS)).toEqual(TOOL_ORDER);
  });
});
