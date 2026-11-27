import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { decryptSecret, encryptSecret, isSecretsEncryptionConfigured } from "../secrets-crypto";
import { GitHubError } from "./client";

/**
 * GitHub sign-in: authorization code flow with PKCE (S256) and a `state` value. For GitHub Apps that are
 * not installed yet, the install page is used instead; it returns the same `state` but no PKCE, so the
 * state check and the confidential client secret protect that exchange.
 * The state, PKCE verifier, and return path travel in an encrypted, httpOnly, short-lived cookie
 * scoped to /api/github, so a forged callback cannot complete without the browser that started it.
 */

export const GITHUB_OAUTH_COOKIE = "cognix_github_oauth";
export const GITHUB_OAUTH_COOKIE_PATH = "/api/github";
const STATE_TTL_MS = 10 * 60 * 1000;
/** `repo` is required to create private repositories and push commits. `read:user` identifies the account. */
export const GITHUB_SCOPES = ["repo", "read:user"];

export function isGitHubConfigured() {
  return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET && process.env.APP_BASE_URL && isSecretsEncryptionConfigured);
}

function config() {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const baseUrl = process.env.APP_BASE_URL;
  if (!clientId || !clientSecret || !baseUrl || !isSecretsEncryptionConfigured) {
    throw new GitHubError(
      "GitHub isn't set up on this Cognix server yet. Add GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, APP_BASE_URL, and COGNIX_SECRETS_KEY.",
      "not_configured",
      503,
    );
  }
  return { clientId, clientSecret, redirectUri: new URL("/api/github/callback", baseUrl).toString() };
}

/** Only same-site relative paths, so the callback cannot redirect to another site. */
export function safeReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  try {
    const url = new URL(value, "https://cognix.invalid");
    return url.origin === "https://cognix.invalid" ? `${url.pathname}${url.search}` : "/";
  } catch {
    return "/";
  }
}

type OAuthCookie = {
  state: string;
  /** Null for the install flow: GitHub's installation page doesn't pass a PKCE challenge through. */
  verifier: string | null;
  mode: GitHubFlowMode;
  returnTo: string;
  ownerId: string;
  expiresAt: number;
};

/** "authorize" signs the user in; "install" installs the GitHub App on their account and signs them in. */
export type GitHubFlowMode = "authorize" | "install";

/** GitHub App client IDs start with "Iv"; OAuth App client IDs do not. */
export function isGitHubApp() {
  return (process.env.GITHUB_CLIENT_ID ?? "").startsWith("Iv");
}

/** The App's URL name from https://github.com/apps/<slug>, needed to send users to its install page. */
export function githubAppSlug() {
  const slug = process.env.GITHUB_APP_SLUG?.trim();
  return slug && /^[a-z0-9][a-z0-9-]{0,99}$/i.test(slug) ? slug : null;
}

export function beginGitHubAuthorization(ownerId: string, returnTo: string, mode: GitHubFlowMode = "authorize") {
  const { clientId, redirectUri } = config();
  const state = randomBytes(32).toString("base64url");
  const slug = githubAppSlug();
  let url: URL;
  let verifier: string | null = null;

  if (mode === "install" && isGitHubApp() && slug) {
    // With "Request user authorization (OAuth) during installation" on, GitHub installs the app,
    // then redirects to the callback URL with an authorization code and this same state.
    url = new URL(`https://github.com/apps/${slug}/installations/new`);
    url.searchParams.set("state", state);
  } else {
    verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", GITHUB_SCOPES.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("allow_signup", "true");
  }

  const payload: OAuthCookie = {
    state,
    verifier,
    mode: verifier ? "authorize" : "install",
    returnTo: safeReturnPath(returnTo),
    ownerId,
    expiresAt: Date.now() + STATE_TTL_MS,
  };
  const encrypted = encryptSecret(JSON.stringify(payload));
  const cookie = `${encrypted.iv}.${encrypted.authTag}.${encrypted.ciphertext}`;
  return { url: url.toString(), cookie, maxAgeSeconds: STATE_TTL_MS / 1000 };
}

/** Validates the callback against the cookie. Throws for anything that is not the exact flow this browser started. */
export function verifyGitHubCallback(cookie: string | undefined, input: { state: string | null; ownerId: string }) {
  if (!cookie || !input.state) throw new GitHubError("The GitHub sign-in expired. Start connecting again.", "conflict", 400);
  const parts = cookie.split(".");
  // Strict canonical base64 only, so altered cookies are rejected before decryption.
  if (parts.length !== 3 || parts.some((part) => !part || Buffer.from(part, "base64").toString("base64") !== part)) {
    throw new GitHubError("The GitHub sign-in couldn't be verified. Start connecting again.", "conflict", 400);
  }
  const [iv, authTag, ciphertext] = parts;
  let payload: OAuthCookie;
  try {
    payload = JSON.parse(decryptSecret({ iv, authTag, ciphertext })) as OAuthCookie;
  } catch {
    throw new GitHubError("The GitHub sign-in couldn't be verified. Start connecting again.", "conflict", 400);
  }
  const expected = Buffer.from(payload.state);
  const received = Buffer.from(input.state);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new GitHubError("The GitHub sign-in couldn't be verified. Start connecting again.", "conflict", 400);
  }
  if (payload.expiresAt < Date.now()) throw new GitHubError("The GitHub sign-in expired. Start connecting again.", "conflict", 400);
  if (payload.ownerId !== input.ownerId) {
    throw new GitHubError("You signed in as a different Cognix user while connecting. Start connecting again.", "conflict", 400);
  }
  // Cookies written before the install flow existed have no mode.
  return { ...payload, mode: payload.mode ?? "authorize", verifier: payload.verifier ?? null };
}

type TokenResponse = {
  access_token?: string;
  scope?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
};

async function requestToken(params: Record<string, string>) {
  const { clientId, clientSecret } = config();
  let response: Response;
  try {
    response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "Cognix" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, ...params }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch {
    throw new GitHubError("Cognix couldn't reach GitHub. Try again.", "unavailable", 502);
  }
  // GitHub reports OAuth failures as HTTP 200 with an `error` field.
  const payload = (await response.json().catch(() => ({}))) as TokenResponse;
  return { ok: response.ok && Boolean(payload.access_token), payload };
}

function tokensFrom(payload: TokenResponse) {
  const now = Date.now();
  return {
    accessToken: payload.access_token!,
    scopes: (payload.scope ?? "").split(/[,\s]+/).filter(Boolean).join(" "),
    expiresAt: payload.expires_in ? new Date(now + payload.expires_in * 1000).toISOString() : null,
    refreshToken: payload.refresh_token ?? null,
    refreshExpiresAt: payload.refresh_token_expires_in ? new Date(now + payload.refresh_token_expires_in * 1000).toISOString() : null,
  };
}

/**
 * Works with both kinds of GitHub client:
 * - OAuth Apps return a non-expiring token whose `scope` must include `repo`.
 * - GitHub Apps return an empty `scope` (access comes from the app's permissions and the repositories it is
 *   installed on) and, by default, a token that expires in 8 hours with a refresh token.
 */
export async function exchangeGitHubCode(code: string, verifier: string | null) {
  const { redirectUri } = config();
  const { ok, payload } = await requestToken({ code, redirect_uri: redirectUri, ...(verifier ? { code_verifier: verifier } : {}) });
  if (!ok) {
    console.warn(`[github] code exchange failed: ${payload.error ?? "no access token"}`);
    throw new GitHubError(
      `GitHub didn't approve the connection${payload.error_description ? `: ${payload.error_description}` : ""}. Try again.`,
      payload.error === "incorrect_client_credentials" || payload.error === "redirect_uri_mismatch" ? "not_configured" : "forbidden",
      400,
    );
  }
  const tokens = tokensFrom(payload);
  const isOAuthApp = tokens.scopes.length > 0;
  if (isOAuthApp && !tokens.scopes.split(" ").includes("repo")) {
    throw new GitHubError("Cognix needs repository access to commit your code. Connect again and approve the requested access.", "forbidden", 400);
  }
  return tokens;
}

/** Exchanges a single-use refresh token for a new token pair (GitHub Apps with expiring tokens). */
export async function refreshGitHubToken(refreshToken: string) {
  const { ok, payload } = await requestToken({ grant_type: "refresh_token", refresh_token: refreshToken });
  if (!ok) {
    console.warn(`[github] token refresh failed: ${payload.error ?? "no access token"}`);
    throw new GitHubError("Your GitHub connection expired. Reconnect GitHub to continue.", "token_revoked", 401);
  }
  return tokensFrom(payload);
}

/** GitHub App user tokens can't be revoked by a grant call, but deleting the token is enough. Best effort. */
export async function revokeGitHubGrant(accessToken: string) {
  const { clientId, clientSecret } = config();
  if (clientId.startsWith("Iv")) {
    await fetch(`https://api.github.com/applications/${clientId}/token`, {
      method: "DELETE",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "Cognix",
      },
      body: JSON.stringify({ access_token: accessToken }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => undefined);
    return;
  }
  await fetch(`https://api.github.com/applications/${clientId}/grant`, {
    method: "DELETE",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "Cognix",
    },
    body: JSON.stringify({ access_token: accessToken }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => undefined);
}
