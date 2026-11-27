/**
 * Minimal GitHub REST client. Runs only on the Cognix server: the token passed in here
 * must never be sent to a browser, written to a log, or copied into a project sandbox.
 */

const API = "https://api.github.com";
const API_VERSION = "2022-11-28";
const TIMEOUT_MS = 20_000;
/** Where Cognix pushes its version when GitHub and Cognix have diverged, like Lovable's `lovable-sync`. */
export const SYNC_BRANCH = "cognix-sync";

/** Machine-readable reasons the UI and agent can act on. */
export type GitHubErrorCode =
  | "not_configured"
  | "not_connected"
  | "token_revoked"
  | "forbidden"
  | "app_access"
  | "not_found"
  | "name_taken"
  | "rate_limited"
  | "conflict"
  | "diverged"
  | "local_changes"
  | "too_large"
  | "no_sandbox"
  | "unavailable";

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly code: GitHubErrorCode,
    /** HTTP status for Cognix's own API response. */
    readonly status = 400,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

function tooLarge(maxBytes: number) {
  return `This repository is larger than ${Math.round(maxBytes / (1024 * 1024))} MB compressed, which is more than a security review can import. Choose a smaller repository or branch.`;
}

export type GitHubUser = { id: number; login: string; avatar_url: string | null };
export type GitHubRepo = {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  private: boolean;
  default_branch: string;
  size: number;
  owner: { login: string };
  permissions?: { admin?: boolean; push?: boolean; pull?: boolean };
  updated_at?: string;
  pushed_at?: string | null;
};
export type GitTreeEntry = { path: string; mode: string; type: "blob" | "tree" | "commit"; sha: string; size?: number };

async function request<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "Cognix",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new GitHubError("Cognix couldn't reach GitHub. Try again in a moment.", "unavailable", 502);
  }
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => ({}))) as { message?: string; errors?: { message?: string; code?: string }[] };
  if (response.ok) return payload as T;

  const detail = payload.message ?? `HTTP ${response.status}`;
  if (response.status === 401) {
    throw new GitHubError("GitHub rejected the saved connection. Reconnect GitHub to continue.", "token_revoked", 401);
  }
  if (response.status === 403 || response.status === 429) {
    if (response.headers.get("x-ratelimit-remaining") === "0" || response.status === 429) {
      throw new GitHubError("GitHub's rate limit was reached. Wait a few minutes, then try again.", "rate_limited", 429);
    }
    // GitHub App user tokens get this when the installation hasn't granted the permission or repository.
    if (/resource not accessible by integration/i.test(detail)) {
      const creating = method === "POST" && path === "/user/repos";
      throw new GitHubError(
        creating
          ? "The Cognix GitHub App can't create repositories on your account yet. On GitHub, open Settings → Applications → Installed GitHub Apps → Configure, accept any new permissions, and set Repository access to All repositories. Then disconnect and reconnect GitHub in Cognix."
          : "The Cognix GitHub App doesn't have access to this repository. On GitHub, open Settings → Applications → Installed GitHub Apps → Configure, accept any new permissions (Contents: read and write), and add this repository or choose All repositories. Then disconnect and reconnect GitHub in Cognix.",
        "app_access",
        403,
      );
    }
    throw new GitHubError(`GitHub refused the request: ${detail}. Check that you can push to this repository.`, "forbidden", 403);
  }
  if (response.status === 404) {
    throw new GitHubError("GitHub couldn't find that repository, or this connection can't access it.", "not_found", 404);
  }
  if (response.status === 409) throw new GitHubError(detail, "conflict", 409);
  if (response.status === 422) {
    const nameTaken = payload.errors?.some((error) => /already exists/i.test(error.message ?? "")) ?? false;
    if (nameTaken) throw new GitHubError("You already have a repository with that name. Choose another name.", "name_taken", 409);
    throw new GitHubError(`GitHub couldn't do that: ${payload.errors?.[0]?.message ?? detail}`, "conflict", 422);
  }
  throw new GitHubError(`GitHub returned an error (${detail}). Try again in a moment.`, "unavailable", 502);
}

export const github = {
  getUser: (token: string) => request<GitHubUser>(token, "GET", "/user"),

  /** GitHub App user tokens only: the app's installations this user can access. */
  listInstallations: (token: string) =>
    request<{
      installations: { id: number; app_slug: string; html_url: string; repository_selection: "all" | "selected"; account: { login: string } | null }[];
    }>(token, "GET", "/user/installations?per_page=100"),

  listRepos: (token: string) =>
    request<GitHubRepo[]>(token, "GET", "/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member"),

  getRepo: (token: string, fullName: string) => request<GitHubRepo>(token, "GET", `/repos/${fullName}`),

  /**
   * Downloads a gzipped tarball of `ref`. Read-only. GitHub answers with a redirect to a short-lived
   * codeload URL; fetch follows it and drops the Authorization header on the cross-origin hop.
   */
  downloadTarball: async (token: string, fullName: string, ref: string, maxBytes: number) => {
    let response: Response;
    try {
      response = await fetch(`${API}/repos/${fullName}/tarball/${encodeURIComponent(ref)}`, {
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": API_VERSION, "User-Agent": "Cognix" },
        redirect: "follow",
        signal: AbortSignal.timeout(120_000),
        cache: "no-store",
      });
    } catch {
      throw new GitHubError("Cognix couldn't download the repository from GitHub. Try again in a moment.", "unavailable", 502);
    }
    if (response.status === 404) throw new GitHubError("GitHub couldn't find that repository or branch, or this connection can't read it.", "not_found", 404);
    if (response.status === 401) throw new GitHubError("GitHub rejected the saved connection. Reconnect GitHub to continue.", "token_revoked", 401);
    if (!response.ok || !response.body) throw new GitHubError(`GitHub couldn't send the repository (HTTP ${response.status}).`, "unavailable", 502);
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > maxBytes) throw new GitHubError(tooLarge(maxBytes), "too_large", 422);
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new GitHubError(tooLarge(maxBytes), "too_large", 422);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  },

  /** `auto_init` gives the repository a first commit, which the Git Data API needs. */
  createRepo: (token: string, input: { name: string; private: boolean; description?: string }) =>
    request<GitHubRepo>(token, "POST", "/user/repos", { ...input, auto_init: true }),

  getBranchHead: async (token: string, fullName: string, branch: string) => {
    const ref = await request<{ object: { sha: string } }>(token, "GET", `/repos/${fullName}/git/ref/heads/${encodeURIComponent(branch)}`);
    return ref.object.sha;
  },

  getCommit: (token: string, fullName: string, sha: string) =>
    request<{ sha: string; tree: { sha: string } }>(token, "GET", `/repos/${fullName}/git/commits/${sha}`),

  getTree: (token: string, fullName: string, sha: string) =>
    request<{ sha: string; tree: GitTreeEntry[]; truncated: boolean }>(token, "GET", `/repos/${fullName}/git/trees/${sha}?recursive=1`),

  createBlob: (token: string, fullName: string, content: Buffer) =>
    request<{ sha: string }>(token, "POST", `/repos/${fullName}/git/blobs`, { content: content.toString("base64"), encoding: "base64" }),

  createTree: (
    token: string,
    fullName: string,
    baseTree: string,
    entries: { path: string; mode: string; type: "blob"; sha: string | null }[],
  ) => request<{ sha: string }>(token, "POST", `/repos/${fullName}/git/trees`, { base_tree: baseTree, tree: entries }),

  createCommit: (token: string, fullName: string, input: { message: string; tree: string; parents: string[] }) =>
    request<{ sha: string; html_url: string }>(token, "POST", `/repos/${fullName}/git/commits`, input),

  /** Fast-forward only. Cognix never force-pushes branches it doesn't own. */
  updateBranch: (token: string, fullName: string, branch: string, sha: string) =>
    request<unknown>(token, "PATCH", `/repos/${fullName}/git/refs/heads/${encodeURIComponent(branch)}`, { sha, force: false }),

  listBranches: (token: string, fullName: string) =>
    request<{ name: string; commit: { sha: string }; protected: boolean }[]>(token, "GET", `/repos/${fullName}/branches?per_page=100`),

  listCommits: (token: string, fullName: string, branch: string) =>
    request<
      {
        sha: string;
        html_url: string;
        commit: { message: string; author: { name: string; date: string } | null; committer: { date: string } | null };
        author: { login: string; avatar_url: string } | null;
      }[]
    >(token, "GET", `/repos/${fullName}/commits?sha=${encodeURIComponent(branch)}&per_page=30`),

  createBranch: (token: string, fullName: string, branch: string, sha: string) =>
    request<unknown>(token, "POST", `/repos/${fullName}/git/refs`, { ref: `refs/heads/${branch}`, sha }),

  createPullRequest: (token: string, fullName: string, input: { title: string; body: string; head: string; base: string }) =>
    request<{ number: number; html_url: string }>(token, "POST", `/repos/${fullName}/pulls`, input),

  /** Points Cognix's own `cognix-sync` branch at a commit. The only branch Cognix ever moves with force. */
  setSyncBranch: async (token: string, fullName: string, sha: string) => {
    try {
      await request<unknown>(token, "PATCH", `/repos/${fullName}/git/refs/heads/${SYNC_BRANCH}`, { sha, force: true });
    } catch (error) {
      if (!(error instanceof GitHubError) || (error.code !== "not_found" && error.code !== "conflict")) throw error;
      await request<unknown>(token, "POST", `/repos/${fullName}/git/refs`, { ref: `refs/heads/${SYNC_BRANCH}`, sha });
    }
  },

  getBlob: async (token: string, fullName: string, sha: string) => {
    const blob = await request<{ content: string; encoding: string }>(token, "GET", `/repos/${fullName}/git/blobs/${sha}`);
    return Buffer.from(blob.content, blob.encoding === "base64" ? "base64" : "utf8");
  },

  compare: (token: string, fullName: string, base: string, head: string) =>
    request<{ ahead_by: number; behind_by: number; status: string; html_url: string }>(
      token,
      "GET",
      `/repos/${fullName}/compare/${base}...${head}`,
    ),

  /** Creates the first commit in an empty repository, which the Git Data API cannot do. */
  initializeEmptyRepo: (token: string, fullName: string, branch: string) =>
    request<unknown>(token, "PUT", `/repos/${fullName}/contents/README.md`, {
      message: "Initialize repository",
      content: Buffer.from("# Built with Cognix\n").toString("base64"),
      branch,
    }),
};

/** GitHub's blob id for a file, so unchanged files are not uploaded again. */
export async function gitBlobSha(content: Buffer) {
  const { createHash } = await import("node:crypto");
  return createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
}

export { isValidRepoName, parseRepoFullName, repoNameFromTitle } from "./names";
