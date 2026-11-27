import { describe, expect, it } from "vitest";
import { inferPromptCloudFeatures } from "./cloud-intent";

describe("inferPromptCloudFeatures (v0-style Turn-0 Cloud auto-detection)", () => {
  it("detects database, auth, and storage while respecting explicit 'no email' constraints", () => {
    const prompt = `Build "Fieldnote Studio", a client project & deliverable portal for small design agencies.
What users should be able to do:
- Create an account with name, email, and password, sign in immediately (no email verification or email sending), and sign out.
- Create, edit, search, filter, and delete client projects with an overview dashboard.
- Upload design previews (PNG/JPG/WebP) or PDF files with thumbnails and download links.
- Generate a toggleable public read-only client review link (/review/[shareToken]).`;

    const features = inferPromptCloudFeatures(prompt);
    expect(features).toEqual(expect.arrayContaining(["database", "auth", "storage"]));
    expect(features).not.toContain("email");
  });

  it("includes email when transactional or verification emails are requested", () => {
    const features = inferPromptCloudFeatures(
      "Build a multi-tenant SaaS CRM where users sign up, verify email, and send email invites to teammates.",
    );
    expect(features).toEqual(expect.arrayContaining(["database", "auth", "email"]));
  });

  it("returns empty array for purely client-side utilities and static landing pages", () => {
    expect(inferPromptCloudFeatures("Build a minimal Pomodoro timer with dark mode and sound cues.")).toEqual([]);
    expect(inferPromptCloudFeatures("Create a clean marketing landing page for an architecture studio.")).toEqual([]);
  });
});
