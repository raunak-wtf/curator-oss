import { describe, expect, it } from "vitest";
import { applyDirectElementPatch, extractThemeTokens, updateThemeTokensInCss } from "./direct-visual-edit";
import type { ProjectFile, VisualElementSelection } from "./types";

function makeFile(path: string, content: string): ProjectFile {
  return {
    id: `f-${path}`,
    projectId: "proj-1",
    path,
    content,
    size: content.length,
    updatedAt: new Date().toISOString(),
  };
}

const baseSelection: VisualElementSelection = {
  id: "/::h1",
  route: "/",
  selector: "main > h1",
  tagName: "h1",
  text: "Launch faster",
  attributes: { class: "text-3xl font-semibold text-white" },
  rect: { x: 0, y: 0, width: 300, height: 48 },
  viewport: { width: 1280, height: 800 },
  componentStack: [{ name: "Hero", source: { file: "app/page.tsx", line: 4 } }],
};

describe("direct zero-token visual edits", () => {
  it("patches static JSX text and Tailwind className directly in the target source file", () => {
    const files = [
      makeFile(
        "app/page.tsx",
        [
          "export default function Home() {",
          "  return (",
          "    <main>",
          '      <h1 className="text-3xl font-semibold text-white">Launch faster</h1>',
          "    </main>",
          "  );",
          "}",
        ].join("\n"),
      ),
    ];

    const result = applyDirectElementPatch({
      selection: baseSelection,
      files,
      nextText: "Ship with Curator",
      nextClassName: "text-5xl font-bold text-white",
    });

    expect(result.updated).toBe(true);
    if (result.updated) {
      expect(result.path).toBe("app/page.tsx");
      expect(result.after).toContain('<h1 className="text-5xl font-bold text-white">Ship with Curator</h1>');
    }
  });

  it("returns a helpful fallback reason when JSX content is dynamically computed", () => {
    const files = [
      makeFile(
        "app/page.tsx",
        "export default function Home({ title }: { title: string }) { return <main><h1>{title}</h1></main>; }",
      ),
    ];
    const result = applyDirectElementPatch({
      selection: { ...baseSelection, attributes: {} },
      files,
      nextText: "Static title",
    });
    expect(result.updated).toBe(false);
  });

  it("extracts and updates CSS custom properties in globals.css", () => {
    const css = [
      ":root {",
      "  --background: #0a0a0a;",
      "  --primary: #6c58f5;",
      "  --radius: 0.5rem;",
      "}",
    ].join("\n");

    const tokens = extractThemeTokens(css);
    expect(tokens).toEqual([
      { name: "--background", value: "#0a0a0a", scope: "root" },
      { name: "--primary", value: "#6c58f5", scope: "root" },
      { name: "--radius", value: "0.5rem", scope: "root" },
    ]);

    const updated = updateThemeTokensInCss(css, [{ name: "--primary", value: "#10b981" }]);
    expect(updated).toContain("--primary: #10b981;");
    expect(updated).toContain("--background: #0a0a0a;");
  });
});
