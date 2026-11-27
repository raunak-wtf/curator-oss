import type { Sandbox } from "@daytona/sdk";
import { describe, expect, it } from "vitest";
import {
  buildDevServerCommand,
  clonePublishedDependenciesCommand,
  devServerLogPath,
  getPreviewHealth,
  isDirectPreviewProxyConfigured,
  isHealthyPreviewStatus,
  publishedAutoStopMinutes,
  publishedBuildLimitsSource,
  publishedProxyHeaders,
} from "./daytona";

function sandboxReturning(result: string) {
  return {
    getWorkDir: async () => "/root",
    process: {
      executeCommand: async () => ({ exitCode: 0, result }),
    },
  } as unknown as Sandbox;
}

describe("getPreviewHealth", () => {
  it.each(["200", "204", "301"])("accepts HTTP %s as preview-ready", async (status) => {
    await expect(getPreviewHealth(sandboxReturning(`COGNIX_HTTP_${status}`))).resolves.toEqual({
      healthy: true,
      reachable: true,
      status,
    });
  });

  it.each(["404", "500"])("rejects reachable HTTP %s responses", async (status) => {
    await expect(getPreviewHealth(sandboxReturning(`COGNIX_HTTP_${status}`))).resolves.toEqual({
      healthy: false,
      reachable: true,
      status,
    });
  });

  it("distinguishes a closed port from an HTTP error", async () => {
    await expect(getPreviewHealth(sandboxReturning("curl failed\nCOGNIX_HTTP_000"))).resolves.toEqual({
      healthy: false,
      reachable: false,
      status: "000",
    });
  });
});

describe("isHealthyPreviewStatus", () => {
  it("accepts successful responses and redirects but rejects proxy failures", () => {
    expect(isHealthyPreviewStatus(200)).toBe(true);
    expect(isHealthyPreviewStatus(307)).toBe(true);
    expect(isHealthyPreviewStatus(404)).toBe(false);
    expect(isHealthyPreviewStatus(502)).toBe(false);
  });
});

describe("published dependency snapshots", () => {
  it("reuses the verified workspace dependency tree without a second package install", () => {
    const command = clonePublishedDependenciesCommand("/root/app/node_modules", "/root/release/node_modules");
    expect(command).toContain("cp -al");
    expect(command).toContain("ln -s");
    expect(command).not.toContain("npm install");
    expect(command).not.toContain("npm ci");
  });

  it("limits Next.js build worker discovery inside small sandboxes", () => {
    expect(publishedBuildLimitsSource).toContain("slice(0, 1)");
    expect(publishedBuildLimitsSource).toContain("availableParallelism = () => 1");
  });
});

describe("direct custom preview proxy configuration", () => {
  it("enables direct preview proxy only when both apps domain and edge secret exist", () => {
    expect(isDirectPreviewProxyConfigured({})).toBe(false);
    expect(isDirectPreviewProxyConfigured({ COGNIX_APPS_DOMAIN: "apps.curatorsite.in" })).toBe(false);
    expect(
      isDirectPreviewProxyConfigured({ COGNIX_APPS_DOMAIN: "apps.curatorsite.in", COGNIX_EDGE_SECRET: "secret-123" }),
    ).toBe(true);
  });

  it("parses scale-to-zero auto-stop minutes safely", () => {
    expect(publishedAutoStopMinutes({})).toBe(0);
    expect(publishedAutoStopMinutes({ COGNIX_PUBLISHED_AUTOSTOP_MINUTES: "15" })).toBe(15);
    expect(publishedAutoStopMinutes({ COGNIX_PUBLISHED_AUTOSTOP_MINUTES: "-5" })).toBe(0);
    expect(publishedAutoStopMinutes({ COGNIX_PUBLISHED_AUTOSTOP_MINUTES: "invalid" })).toBe(0);
  });

  it("builds Daytona custom preview proxy headers with token and forwarded host trust", () => {
    expect(publishedProxyHeaders({ token: "tok-xyz" }, "shop.example.com")).toEqual({
      "X-Daytona-Preview-Token": "tok-xyz",
      "X-Daytona-Skip-Preview-Warning": "true",
      "X-Daytona-Disable-CORS": "true",
      "X-Forwarded-Host": "shop.example.com",
      "X-Forwarded-Proto": "https",
      "X-Daytona-Trust-Forwarded-Host": "true",
    });
  });

  it("tees dev-server output outside the project root with COGNIX_HOSTED_PREVIEW and worker limits enabled", () => {
    expect(devServerLogPath("/home/daytona/app")).toBe("/home/daytona/.cognix-dev-server.log");
    const cmd = buildDevServerCommand("/home/daytona/app", 3000);
    expect(cmd).toContain("COGNIX_HOSTED_PREVIEW=1");
    expect(cmd).toContain("--max-old-space-size=512");
    expect(cmd).toContain("npm run start");
    expect(cmd).toContain("npm run dev");
    expect(cmd).toContain(".cognix-runtime-limits.cjs");
    expect(cmd).toContain("tee -a '/home/daytona/.cognix-dev-server.log'");
    expect(cmd).not.toContain("/home/daytona/app/.cognix-dev-server.log");
  });
});
