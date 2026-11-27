import { describe, expect, it } from "vitest";
import {
  extractExplicitNameFromPrompt,
  fallbackProjectNameFromPrompt,
  generateProjectName,
  resolveProjectNameModel,
  sanitizeGeneratedProjectName,
} from "./project-name";

describe("project-name generator", () => {
  it("prefers PROJECT_NAME_GEN_MODEL and falls back to OPENAI_MODEL", () => {
    expect(
      resolveProjectNameModel({
        PROJECT_NAME_GEN_MODEL: "gpt-4o-mini-fast",
        OPENAI_MODEL: "gpt-5",
      }),
    ).toBe("gpt-4o-mini-fast");

    expect(
      resolveProjectNameModel({
        PROJECT_NAME_GEN_MODEL: "   ",
        OPENAI_MODEL: "gpt-5",
      }),
    ).toBe("gpt-5");

    expect(resolveProjectNameModel({})).toBeNull();
  });

  it("uses PROJECT_NAME_GEN_MODEL and returns a clean domain-compatible name and slug", async () => {
    let capturedModel = "";
    const result = await generateProjectName(
      'Build "Fieldnote Studio", a client project & deliverable portal for small design agencies.',
      {
        env: {
          OPENAI_API_KEY: "test-key",
          PROJECT_NAME_GEN_MODEL: "qwen-name-gen",
          OPENAI_MODEL: "main-coder",
        },
        createCompletion: async ({ model }) => {
          capturedModel = model;
          return '<think>Picking the brand name</think>\n"Fieldnote Studio.io"';
        },
      },
    );

    expect(capturedModel).toBe("qwen-name-gen");
    expect(result).toEqual({
      title: "Fieldnote Studio",
      slug: "fieldnote-studio",
      source: "model",
    });
  });

  it("retries once on transient model failure and succeeds on attempt 2", async () => {
    let attempts = 0;
    const result = await generateProjectName("Create an inventory and purchase order tracker for coffee roasters", {
      env: {
        OPENAI_API_KEY: "test-key",
        PROJECT_NAME_GEN_MODEL: "fast-namer",
      },
      createCompletion: async () => {
        attempts += 1;
        if (attempts === 1) throw new TypeError("fetch failed");
        return "Roast Ledger";
      },
    });

    expect(attempts).toBe(2);
    expect(result).toEqual({
      title: "Roast Ledger",
      slug: "roast-ledger",
      source: "model",
    });
  });

  it("sanitizes quotes, filler verbs, TLDs, and reserved subdomain words", () => {
    expect(sanitizeGeneratedProjectName('Name: "Build Pulse CRM.app!"')).toEqual({
      title: "Pulse CRM",
      slug: "pulse-crm",
    });

    // Reserved single-word subdomain ("Dashboard" -> "dashboard" is reserved) gets safely suffixed
    const reserved = sanitizeGeneratedProjectName("Dashboard");
    expect(reserved?.title).toBe("Dashboard Studio");
    expect(reserved?.slug).toBe("dashboard-studio");
  });

  it("extracts explicit quoted names or generates clean 2-3 word fallback names when offline", async () => {
    expect(
      extractExplicitNameFromPrompt(
        'Build "Fieldnote Studio", a client project & deliverable portal for small design agencies.',
      ),
    ).toEqual({
      title: "Fieldnote Studio",
      slug: "fieldnote-studio",
    });

    const unnamed = fallbackProjectNameFromPrompt(
      "Build a full-stack notes and knowledge base app using Tailwind CSS with search",
    );
    expect(unnamed.title).not.toMatch(/^Build\b/i);
    expect(unnamed.slug).toMatch(/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$/);

    const offline = await generateProjectName('Build "Harbor Desk", a support inbox for SaaS teams', {
      env: {},
    });
    expect(offline).toEqual({
      title: "Harbor Desk",
      slug: "harbor-desk",
      source: "fallback",
    });
  });
});
