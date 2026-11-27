import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewSlugForProjectId } from "@/lib/domains";
import type { Project } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  getProjectForEdgePreview: vi.fn(),
  getPublishedProject: vi.fn(),
  getPublishedProjectByHostname: vi.fn(),
  hasRegisteredDomain: vi.fn(),
  getPreviewProxyTarget: vi.fn(),
  getPublishedProxyTarget: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  getProjectForEdgePreview: mocks.getProjectForEdgePreview,
  getPublishedProject: mocks.getPublishedProject,
  getPublishedProjectByHostname: mocks.getPublishedProjectByHostname,
  hasRegisteredDomain: mocks.hasRegisteredDomain,
}));

vi.mock("@/lib/daytona", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/daytona")>();
  return {
    ...actual,
    getPreviewProxyTarget: mocks.getPreviewProxyTarget,
    getPublishedProxyTarget: mocks.getPublishedProxyTarget,
  };
});

import { GET as allowDomainGet } from "./allow-domain/route";
import { GET as resolveEdgeGet } from "./resolve/route";

const sampleUuid = "d4ebb9ff-212e-307b-07e5-492181c82ba6";
const sampleProject: Project = {
  id: sampleUuid,
  ownerId: "user-1",
  title: "Demo SaaS",
  description: "",
  status: "published",
  coverGradient: "from-indigo-500 to-purple-500",
  sandboxId: "sbx-123",
  previewUrl: null,
  publishSlug: "demo-saas",
  publishedAt: "2026-11-27T00:00:00.000Z",
  showBadge: true,
  publicRemix: false,
  mode: "build",
  securitySource: null,
  createdAt: "2026-11-27T00:00:00.000Z",
  updatedAt: "2026-11-27T00:00:00.000Z",
};

describe("edge proxy routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("APP_BASE_URL", "https://curator.codes");
    vi.stubEnv("COGNIX_APPS_DOMAIN", "curatorsite.in");
    vi.stubEnv("COGNIX_EDGE_SECRET", "edge-secret-test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resolves Lovable-style random preview subdomains (<adj>-<noun>-<hex8>.curatorsite.in) to Daytona port 3000", async () => {
    const previewSlug = previewSlugForProjectId(sampleUuid)!;
    mocks.getProjectForEdgePreview.mockResolvedValue(sampleProject);
    mocks.getPreviewProxyTarget.mockResolvedValue({
      upstream: "https://3000-sbx-123.proxy.daytona.work",
      token: "preview-tok-3000",
    });

    const response = await resolveEdgeGet(
      new Request(`http://127.0.0.1:3005/api/edge/resolve?host=${previewSlug}.curatorsite.in`, {
        headers: { "x-cognix-edge-secret": "edge-secret-test" },
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.kind).toBe("preview");
    expect(body.upstream).toBe("https://3000-sbx-123.proxy.daytona.work");
    expect(body.badge).toBeNull();
    expect(body.headers["X-Daytona-Preview-Token"]).toBe("preview-tok-3000");
    expect(body.headers["X-Forwarded-Host"]).toBe(`${previewSlug}.curatorsite.in`);
  });

  it("resolves <name>.curatorsite.in to Daytona port 3001 with badge metadata", async () => {
    mocks.getPublishedProject.mockResolvedValue(sampleProject);
    mocks.getPublishedProxyTarget.mockResolvedValue({
      upstream: "https://3001-sbx-123.proxy.daytona.work",
      token: "pub-tok-3001",
    });

    const response = await resolveEdgeGet(
      new Request("http://127.0.0.1:3005/api/edge/resolve?host=demo-saas.curatorsite.in", {
        headers: { "x-cognix-edge-secret": "edge-secret-test" },
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.upstream).toBe("https://3001-sbx-123.proxy.daytona.work");
    expect(body.badge).toBeTruthy();
    expect(body.headers["X-Daytona-Preview-Token"]).toBe("pub-tok-3001");
  });

  it("approves Caddy On-Demand TLS only for builder hosts, apps subdomains, or registered custom domains", async () => {
    mocks.hasRegisteredDomain.mockImplementation(async (host: string) => host === "app.customer.com");

    const okBuilder = await allowDomainGet(
      new Request("http://127.0.0.1:3005/api/edge/allow-domain?secret=edge-secret-test&domain=curator.codes"),
    );
    expect(okBuilder.status).toBe(200);

    const okCustom = await allowDomainGet(
      new Request("http://127.0.0.1:3005/api/edge/allow-domain?secret=edge-secret-test&domain=app.customer.com"),
    );
    expect(okCustom.status).toBe(200);

    const denied = await allowDomainGet(
      new Request("http://127.0.0.1:3005/api/edge/allow-domain?secret=edge-secret-test&domain=unregistered.evil.com"),
    );
    expect(denied.status).toBe(404);

    const badSecret = await allowDomainGet(
      new Request("http://127.0.0.1:3005/api/edge/allow-domain?secret=wrong&domain=curator.codes"),
    );
    expect(badSecret.status).toBe(403);
  });
});
