import { createSign } from "node:crypto";
import { GitHubError } from "./client";

/**
 * GitHub App authentication, so commits are made by the app's bot account (like `lovable-dev[bot]`)
 * instead of the signed-in user.
 *
 * 1. Sign a short-lived JWT with the app's private key.
 * 2. Exchange it for an installation access token scoped to the one linked repository,
 *    with only `contents: write`. The token lasts an hour and is cached in memory only.
 *
 * Server-only. The private key and tokens never reach a browser, a log, or a sandbox.
 */

const API = "https://api.github.com";
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

declare global {
  var __cognixInstallationTokens: Map<string, { token: string; expiresAt: number }> | undefined;
}
const cache = globalThis.__cognixInstallationTokens ?? (globalThis.__cognixInstallationTokens = new Map());

function privateKey() {
  const raw = process.env.GITHUB_APP_PRIVATE_KEY?.trim().replace(/^["']|["']$/g, "");
  if (!raw) return null;
  // Accept the PEM as-is, with escaped newlines (common in .env files), or base64-encoded.
  const pem = raw.includes("BEGIN") ? raw.replace(/\\n/g, "\n") : Buffer.from(raw, "base64").toString("utf8");
  return pem.includes("PRIVATE KEY") ? pem : null;
}

/** True when commits can be made as the GitHub App's bot account. */
export function isBotCommitConfigured() {
  return Boolean(process.env.GITHUB_CLIENT_ID?.startsWith("Iv") && privateKey());
}

function appJwt() {
  const key = privateKey();
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!key || !clientId) throw new GitHubError("GITHUB_APP_PRIVATE_KEY isn't set on this Cognix server.", "not_configured", 503);
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  // GitHub accepts the app's client ID as the issuer.
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: now - 60, exp: now + 540, iss: clientId })}`;
  try {
    return `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(key, "base64url")}`;
  } catch {
    throw new GitHubError("GITHUB_APP_PRIVATE_KEY isn't a valid private key. Download a new one from your GitHub App's settings.", "not_configured", 503);
  }
}

async function appRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${appJwt()}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Cognix",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof GitHubError) throw error;
    throw new GitHubError("Cognix couldn't reach GitHub. Try again in a moment.", "unavailable", 502);
  }
  const payload = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (response.ok) return payload;
  if (response.status === 401) {
    throw new GitHubError("GitHub rejected the app's private key. Check that GITHUB_APP_PRIVATE_KEY belongs to this GitHub App.", "not_configured", 503);
  }
  if (response.status === 404 || response.status === 422) {
    throw new GitHubError(
      "The Cognix GitHub App isn't installed on this repository. Install it with access to the repository, then try again.",
      "app_access",
      403,
    );
  }
  throw new GitHubError(`GitHub returned an error (${payload.message ?? response.status}). Try again in a moment.`, "unavailable", 502);
}

/** An installation token that can only write contents of `owner/repo`. */
export async function installationTokenFor(fullName: string) {
  const cached = cache.get(fullName);
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) return cached.token;
  const [, repo] = fullName.split("/");
  const installation = await appRequest<{ id: number }>("GET", `/repos/${fullName}/installation`);
  const issued = await appRequest<{ token: string; expires_at: string }>("POST", `/app/installations/${installation.id}/access_tokens`, {
    repositories: [repo],
    permissions: { contents: "write", metadata: "read" },
  });
  cache.set(fullName, { token: issued.token, expiresAt: new Date(issued.expires_at).getTime() });
  return issued.token;
}

/** Drops cached tokens, for example when a repository is unlinked. */
export function forgetInstallationToken(fullName: string) {
  cache.delete(fullName);
}
