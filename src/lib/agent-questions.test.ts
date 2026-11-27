import { describe, expect, it } from "vitest";
import {
  CLOUD_DECLINED_PROMPT,
  CLOUD_ENABLED_PROMPT,
  cloudWireUpPromptFor,
  formatAnswers,
  questionRequestFor,
} from "./agent-questions";
import type { Message } from "./types";

function makeAssistantMessage(questions: unknown): Message {
  return {
    id: "msg-1",
    projectId: "proj-1",
    role: "assistant",
    content: "Need input",
    metadata: questions === undefined ? {} : { questions },
    createdAt: "2026-11-27T00:00:00.000Z",
  };
}

describe("agent-questions", () => {
  describe("cloudWireUpPromptFor", () => {
    it("creates a holistic Cognix Cloud wire-up prompt when enabled from Overview", () => {
      const prompt = cloudWireUpPromptFor();
      expect(prompt).toContain("turned on Cognix Cloud");
      expect(prompt).toContain("Cognix Cloud Database");
      expect(prompt).toContain("Authentication");
      expect(prompt).toContain("Storage");
      expect(prompt).toContain("Emails");
      expect(prompt).toContain("production build");
    });

    it("tailors the wire-up prompt when enabled from Database", () => {
      const prompt = cloudWireUpPromptFor("database");
      expect(prompt).toContain("Database tab");
      expect(prompt).toContain("read_cloud_guide");
      expect(prompt).toContain("DATABASE_URL");
      expect(prompt).toContain("Cognix Cloud PostgreSQL");
    });

    it("tailors the wire-up prompt when enabled from Storage", () => {
      const prompt = cloudWireUpPromptFor("storage");
      expect(prompt).toContain("Storage tab");
      expect(prompt).toContain("S3_ENDPOINT");
      expect(prompt).toContain("S3_BUCKET");
      expect(prompt).toContain("S3_CDN_URL");
    });

    it("tailors the wire-up prompt when enabled from Emails", () => {
      const prompt = cloudWireUpPromptFor("email");
      expect(prompt).toContain("Emails tab");
      expect(prompt).toContain("RESEND_API_KEY");
      expect(prompt).toContain("EMAIL_FROM");
    });

    it("tailors the wire-up prompt when enabled from Authentication", () => {
      const prompt = cloudWireUpPromptFor("auth");
      expect(prompt).toContain("Authentication tab");
      expect(prompt).toContain("Cognix Cloud Authentication");
      expect(prompt).toContain("BETTER_AUTH_SECRET");
      expect(prompt).toContain("/api/auth/[...all]");
    });

    it("exports non-empty approval and decline prompts", () => {
      expect(CLOUD_ENABLED_PROMPT).toContain("Cognix Cloud");
      expect(CLOUD_DECLINED_PROMPT).toContain("Don't turn on Cognix Cloud");
    });
  });

  describe("questionRequestFor", () => {
    it("parses valid enable_cloud requests and filters invalid features", () => {
      const req = questionRequestFor(
        makeAssistantMessage({
          kind: "enable_cloud",
          reason: "Persist user notes in Postgres",
          features: ["database", "invalid_feature", "auth"],
        }),
      );
      expect(req).toEqual({
        kind: "enable_cloud",
        reason: "Persist user notes in Postgres",
        features: ["database", "auth"],
      });
    });

    it("returns null for malformed enable_cloud requests", () => {
      expect(
        questionRequestFor(
          makeAssistantMessage({
            kind: "enable_cloud",
            reason: "Persist notes",
            features: ["unknown"],
          }),
        ),
      ).toBeNull();
    });

    it("formats multi-question answers and skipped items cleanly", () => {
      const formatted = formatAnswers(
        {
          kind: "questions",
          questions: [
            { question: "Primary audience?", type: "single", options: ["Teams", "Solo"] },
            { question: "Modules?", type: "multiple", options: ["Billing", "Docs"] },
          ],
        },
        [["Teams"], []],
      );
      expect(formatted).toContain("- Primary audience?\n  Teams");
      expect(formatted).toContain("- Modules?\n  (skipped, use your best judgment)");
    });
  });
});
