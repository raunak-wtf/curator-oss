import { describe, expect, it } from "vitest";
import { runPublishCheck } from "./publish-check";
import type { ProjectFile } from "./types";

function makeFile(path: string, content: string): ProjectFile {
  return {
    id: `file-${path}`,
    projectId: "proj-1",
    path,
    content,
    size: content.length,
    updatedAt: new Date().toISOString(),
  };
}

describe("runPublishCheck", () => {
  it("flags hardcoded secrets, NEXT_PUBLIC secret exposure, unauthenticated mutating routes, and missing SEO metadata", () => {
    const files: ProjectFile[] = [
      makeFile(
        "app/layout.tsx",
        'export const metadata = { title: "Create Next App" };\nexport default function Layout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }',
      ),
      makeFile(
        "lib/auth.ts",
        'import { betterAuth } from "better-auth";\nexport const auth = betterAuth({});',
      ),
      makeFile(
        "app/api/items/route.ts",
        'export async function POST(request: Request) { const data = await request.json(); const leak = process.env.NEXT_PUBLIC_DATABASE_URL; const token = "super-secret-project-token-999"; return Response.json({ data, leak, token }); }',
      ),
      makeFile("app/page.tsx", 'export default function Page() { return <img src="/hero.png" />; }'),
    ];

    const report = runPublishCheck(files, { secretValues: ["super-secret-project-token-999"] });
    expect(report.readyToPublish).toBe(false);
    expect(report.score).toBeLessThan(60);
    expect(report.securityIssues.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "hardcoded-project-secret:app/api/items/route.ts",
        "next-public-secret:app/api/items/route.ts:NEXT_PUBLIC_DATABASE_URL",
        "unauthenticated-api:app/api/items/route.ts",
        "unvalidated-json:app/api/items/route.ts",
      ]),
    );
    // Ensure the raw secret value is never echoed back in any issue text
    expect(JSON.stringify(report)).not.toContain("super-secret-project-token-999");

    expect(report.seoIssues.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "seo-missing-metadata",
        "seo-boilerplate-title",
        "seo-missing-opengraph",
        "seo-missing-crawlers",
        "img-missing-alt:app/page.tsx",
      ]),
    );
  });

  it("scores a clean, well-configured Next.js app at 100/100", () => {
    const files: ProjectFile[] = [
      makeFile(
        "app/layout.tsx",
        [
          "export const metadata = {",
          '  title: "Atelier Studio",',
          '  description: "Client project portal",',
          '  openGraph: { title: "Atelier Studio", description: "Client project portal" },',
          "};",
        ].join("\n"),
      ),
      makeFile("app/robots.ts", "export default function robots() { return { rules: { userAgent: '*', allow: '/' } }; }"),
      makeFile("app/sitemap.ts", "export default function sitemap() { return []; }"),
      makeFile("app/page.tsx", 'export default function Page() { return <main><img src="/logo.png" alt="Atelier" /></main>; }'),
    ];

    const report = runPublishCheck(files);
    expect(report.readyToPublish).toBe(true);
    expect(report.score).toBe(100);
    expect(report.securityIssues).toHaveLength(0);
    expect(report.seoIssues).toHaveLength(0);
  });
});
