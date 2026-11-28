import { createHash } from "node:crypto";
import type { AuthMethod } from "./types";

export function canonicalAccountId(email: string, emailVerified: boolean, providerSubject: string) {
  if (!emailVerified) return providerSubject;
  const normalizedEmail = email.trim().toLowerCase();
  const digest = createHash("sha256").update(normalizedEmail).digest("hex").slice(0, 40);
  return `account|${digest}`;
}

export type ParsedAuthProvider = {
  /** Raw Auth0 connection prefix (e.g. "auth0", "google-oauth2", "github"). */
  provider: string;
  /** Human-readable provider label (e.g. "Email & Password", "Google", "GitHub"). */
  label: string;
  /** Broad sign-in category for filtering and analytics. */
  method: AuthMethod;
};

const KNOWN_PROVIDERS: Record<string, { label: string; method: AuthMethod }> = {
  auth0: { label: "Email & Password", method: "password" },
  "Username-Password-Authentication": { label: "Email & Password", method: "password" },
  "google-oauth2": { label: "Google", method: "oauth" },
  google: { label: "Google", method: "oauth" },
  github: { label: "GitHub", method: "oauth" },
  apple: { label: "Apple", method: "oauth" },
  windowslive: { label: "Microsoft", method: "oauth" },
  waad: { label: "Microsoft", method: "oauth" },
  microsoft: { label: "Microsoft", method: "oauth" },
  linkedin: { label: "LinkedIn", method: "oauth" },
  facebook: { label: "Facebook", method: "oauth" },
  twitter: { label: "X / Twitter", method: "oauth" },
  discord: { label: "Discord", method: "oauth" },
  bitbucket: { label: "Bitbucket", method: "oauth" },
  gitlab: { label: "GitLab", method: "oauth" },
  email: { label: "Passwordless Email", method: "passwordless" },
  sms: { label: "Passwordless SMS", method: "passwordless" },
  samlp: { label: "Enterprise SSO", method: "sso" },
  oidc: { label: "Enterprise OIDC", method: "sso" },
  adfs: { label: "Enterprise ADFS", method: "sso" },
  oauth2: { label: "OAuth", method: "oauth" },
};

/**
 * Extracts the Auth0 sign-in provider from an OIDC `sub` claim (e.g. `google-oauth2|12345`, `auth0|abc`).
 */
export function parseAuthProvider(subject: string | null | undefined): ParsedAuthProvider {
  const raw = (subject ?? "").trim();
  if (!raw) {
    return { provider: "unknown", label: "Unknown", method: "oauth" };
  }

  const pipeIdx = raw.indexOf("|");
  const prefix = (pipeIdx > 0 ? raw.slice(0, pipeIdx) : raw).trim();
  const normalized = prefix.toLowerCase();

  const exact = KNOWN_PROVIDERS[prefix] ?? KNOWN_PROVIDERS[normalized];
  if (exact) {
    return { provider: normalized, label: exact.label, method: exact.method };
  }

  if (normalized.includes("saml") || normalized.includes("oidc") || normalized.includes("enterprise")) {
    return { provider: normalized, label: "Enterprise SSO", method: "sso" };
  }

  if (normalized.includes("password") || normalized === "db") {
    return { provider: normalized, label: "Email & Password", method: "password" };
  }

  // Format unknown OAuth connection identifiers cleanly (e.g. "custom-oauth2" -> "Custom OAuth")
  const cleaned = prefix
    .replace(/-oauth2?$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  const titleCased = cleaned
    ? cleaned.replace(/\b\w/g, (char) => char.toUpperCase())
    : "OAuth";
  return {
    provider: normalized,
    label: titleCased,
    method: "oauth",
  };
}

export function getAdminEmailSet(envValue?: string): Set<string> {
  const raw = envValue ?? process.env.COGNIX_ADMIN_EMAILS ?? process.env.ADMIN_EMAILS ?? "";
  const emails = new Set<string>();
  for (const part of raw.split(/[,;\n]/)) {
    const clean = part.trim().toLowerCase();
    if (clean) emails.add(clean);
  }
  return emails;
}

export function isAdminEmail(email: string | null | undefined, envValue?: string): boolean {
  if (!email) return false;
  return getAdminEmailSet(envValue).has(email.trim().toLowerCase());
}
