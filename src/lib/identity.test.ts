import { describe, expect, it } from "vitest";
import { canonicalAccountId, isAdminEmail, parseAuthProvider } from "./identity";

describe("Auth0 identity & provider parsing", () => {
  it("identifies Email & Password accounts (auth0|...)", () => {
    expect(parseAuthProvider("auth0|66a1b2c3d4e5")).toEqual({
      provider: "auth0",
      label: "Email & Password",
      method: "password",
    });
  });

  it("identifies Google, GitHub, Apple, and Microsoft OAuth providers", () => {
    expect(parseAuthProvider("google-oauth2|1092348234")).toEqual({
      provider: "google-oauth2",
      label: "Google",
      method: "oauth",
    });
    expect(parseAuthProvider("github|998877")).toEqual({
      provider: "github",
      label: "GitHub",
      method: "oauth",
    });
    expect(parseAuthProvider("apple|001234.abc")).toEqual({
      provider: "apple",
      label: "Apple",
      method: "oauth",
    });
    expect(parseAuthProvider("windowslive|abcdef")).toEqual({
      provider: "windowslive",
      label: "Microsoft",
      method: "oauth",
    });
  });

  it("handles enterprise SSO, passwordless, and unknown providers gracefully", () => {
    expect(parseAuthProvider("email|5f123")).toEqual({
      provider: "email",
      label: "Passwordless Email",
      method: "passwordless",
    });
    expect(parseAuthProvider("samlp|okta-corp|user1")).toEqual({
      provider: "samlp",
      label: "Enterprise SSO",
      method: "sso",
    });
    expect(parseAuthProvider("custom-oauth2|42")).toEqual({
      provider: "custom-oauth2",
      label: "Custom",
      method: "oauth",
    });
  });

  it("evaluates admin allowlist case-insensitively", () => {
    const allowlist = "Founder@Cognix.dev, ops@cognix.dev";
    expect(isAdminEmail("founder@cognix.dev", allowlist)).toBe(true);
    expect(isAdminEmail("OPS@COGNIX.DEV", allowlist)).toBe(true);
    expect(isAdminEmail("customer@example.com", allowlist)).toBe(false);
    expect(isAdminEmail("", allowlist)).toBe(false);
  });

  it("keeps canonical account IDs deterministic for verified emails", () => {
    const a = canonicalAccountId("Alice@Example.com", true, "google-oauth2|1");
    const b = canonicalAccountId("alice@example.com ", true, "auth0|2");
    expect(a).toBe(b);
    expect(a.startsWith("account|")).toBe(true);
  });
});
