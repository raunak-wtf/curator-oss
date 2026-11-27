import { applyProjectFiles, isSyncablePath, readProjectSnapshot } from "../daytona";
import {
  createMessage,
  deleteProjectFile,
  getDecryptedSecrets,
  getGitHubConnection,
  getGitHubTokenRecord,
  getProjectRepository,
  linkProjectRepository,
  saveRepositoryCache,
  updateGitHubTokens,
  updateProjectRepository,
  upsertProjectFile,
} from "../store";
import type { FileChangeSnapshot, GitSyncStatus, Project, ProjectRepository, ProjectRepositoryView, RepositoryCommit } from "../types";
import { GitHubError, SYNC_BRANCH, gitBlobSha, github, type GitHubRepo } from "./client";
import { githubAppSlug, refreshGitHubToken } from "./oauth";
import { installationTokenFor, isBotCommitConfigured } from "./app-auth";

/**
 * Commits a project's sandbox files to its linked GitHub repository, entirely from the Cognix server.
 *
 * - The OAuth token is decrypted here and used only for GitHub API calls. It is never placed in the sandbox,
 *   so code running in the generated app cannot read or misuse it.
 * - Commits are created with the Git Data API on top of the current branch head and fast-forwarded.
 *   Cognix never force-pushes, so history on GitHub is always kept.
 * - If someone pushed to the branch outside Cognix, the commit stops unless the owner explicitly confirms.
 * - Files that contain a value of one of the project's secrets are never committed.
 */

export function repositoryView(repo: ProjectRepository): ProjectRepositoryView {
  return {
    projectId: repo.projectId,
    repoId: repo.repoId,
    fullName: repo.fullName,
    htmlUrl: repo.htmlUrl,
    defaultBranch: repo.defaultBranch,
    private: repo.private,
    autoCommit: repo.autoCommit,
    syncBaseSha: repo.syncBaseSha,
    lastCommitSha: repo.lastCommitSha,
    lastCommitUrl: repo.lastCommitUrl,
    lastPushedAt: repo.lastPushedAt,
    lastError: repo.lastError,
    createdAt: repo.createdAt,
    updatedAt: repo.updatedAt,
  };
}

/** Refresh a little early so a long commit never starts with a token about to expire. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

async function requireToken(ownerId: string) {
  const record = await getGitHubTokenRecord(ownerId);
  if (!record) throw new GitHubError("Connect GitHub first.", "not_connected", 409);
  if (!record.expiresAt || new Date(record.expiresAt).getTime() - REFRESH_MARGIN_MS > Date.now()) return record.accessToken;
  if (!record.refreshToken || (record.refreshExpiresAt && new Date(record.refreshExpiresAt).getTime() <= Date.now())) {
    throw new GitHubError("Your GitHub connection expired. Reconnect GitHub to continue.", "token_revoked", 401);
  }
  const next = await refreshGitHubToken(record.refreshToken);
  await updateGitHubTokens(ownerId, next);
  return next.accessToken;
}

/**
 * Token for reading and writing the linked repository. With the GitHub App's private key configured,
 * this is an installation token, so commits appear as the app's bot. Otherwise the user's token.
 */
async function repoToken(ownerId: string, fullName: string) {
  return isBotCommitConfigured() ? installationTokenFor(fullName) : requireToken(ownerId);
}

/**
 * Bot tokens act for the app, not the user, so before every write confirm the user is still connected
 * and can still push to the repository. Disconnecting GitHub or losing access stops all pushes.
 */
async function assertUserCanPush(ownerId: string, fullName: string) {
  if (!isBotCommitConfigured()) return;
  const repo = await github.getRepo(await requireToken(ownerId), fullName);
  if (!repo.permissions?.push) {
    throw new GitHubError(`Your GitHub account can no longer push to ${fullName}. Cognix stopped syncing it.`, "forbidden", 403);
  }
}

/** Credits the user on bot commits, the way Lovable does. */
async function withCoAuthor(ownerId: string, message: string) {
  if (!isBotCommitConfigured()) return message;
  const connection = await getGitHubConnection(ownerId);
  if (!connection) return message;
  return `${message}\n\nCo-authored-by: ${connection.login} <${connection.githubUserId}+${connection.login}@users.noreply.github.com>`;
}

/** Returns the branch head, creating a first commit when the repository is empty. */
async function branchHead(token: string, fullName: string, branch: string) {
  try {
    return await github.getBranchHead(token, fullName, branch);
  } catch (error) {
    if (!(error instanceof GitHubError) || (error.code !== "conflict" && error.code !== "not_found")) throw error;
    // 409 "Git Repository is empty" (or a missing default branch on a brand-new repository).
    await github.initializeEmptyRepo(token, fullName, branch);
    return github.getBranchHead(token, fullName, branch);
  }
}

async function link(project: Project, ownerId: string, repo: GitHubRepo, token: string) {
  if (!repo.permissions?.push) {
    throw new GitHubError(`Your GitHub account can't push to ${repo.full_name}. Choose a repository you can write to.`, "forbidden", 403);
  }
  void token;
  const head = await branchHead(await repoToken(ownerId, repo.full_name), repo.full_name, repo.default_branch);
  return linkProjectRepository({
    projectId: project.id,
    ownerId,
    repoId: String(repo.id),
    fullName: repo.full_name,
    htmlUrl: repo.html_url,
    defaultBranch: repo.default_branch,
    private: repo.private,
    // The owner chose this repository, so its current head is the starting point.
    syncBaseSha: head,
  });
}

export async function createAndLinkRepository(project: Project, ownerId: string, input: { name: string; private: boolean }) {
  const token = await requireToken(ownerId);
  const repo = await github.createRepo(token, {
    name: input.name,
    private: input.private,
    description: `${project.title} · built with Cognix`.slice(0, 350),
  });
  return link(project, ownerId, { ...repo, permissions: { push: true } }, token);
}

export async function linkExistingRepository(project: Project, ownerId: string, fullName: string) {
  const token = await requireToken(ownerId);
  const repo = await github.getRepo(token, fullName);
  return link(project, ownerId, repo, token);
}

export type RepositoryAccess = {
  kind: "github_app" | "oauth_app";
  /** GitHub page where the user changes which repositories Cognix can use. */
  manageUrl: string;
  /** GitHub Apps only: whether the installation covers every repository. Null when not installed. */
  selection: "all" | "selected" | null;
  account: string | null;
};

/** Where to change repository access, which differs between GitHub Apps and OAuth Apps. */
export async function getRepositoryAccess(ownerId: string): Promise<RepositoryAccess> {
  const clientId = process.env.GITHUB_CLIENT_ID ?? "";
  if (!clientId.startsWith("Iv")) {
    // OAuth Apps can reach every repository the user can; organizations must approve the app separately.
    return { kind: "oauth_app", manageUrl: `https://github.com/settings/connections/applications/${encodeURIComponent(clientId)}`, selection: null, account: null };
  }
  const token = await requireToken(ownerId);
  const [{ installations }, user] = await Promise.all([github.listInstallations(token), github.getUser(token)]);
  // Prefer the installation on the user's own account; organizations follow.
  const own = installations.find((item) => item.account?.login === user.login) ?? installations[0];
  if (!own) {
    // Authorizing a GitHub App is not the same as installing it; it can reach no repositories until installed.
    // The connect route sends the user to the install page and brings them back signed in.
    return {
      kind: "github_app",
      manageUrl: githubAppSlug() ? "/api/github/connect?mode=install" : "https://github.com/settings/apps",
      selection: null,
      account: null,
    };
  }
  const isOrg = own.account?.login && own.account.login !== user.login;
  return {
    kind: "github_app",
    // html_url points at the installation's settings page, where repository access is chosen.
    manageUrl: own.html_url || (isOrg ? `https://github.com/organizations/${own.account!.login}/settings/installations/${own.id}` : `https://github.com/settings/installations/${own.id}`),
    selection: own.repository_selection,
    account: own.account?.login ?? null,
  };
}

/** The user's own GitHub token (refreshed if needed). Used for read-only access such as security reviews. */
export async function requireUserToken(ownerId: string) {
  return requireToken(ownerId);
}

export async function listPushableRepositories(ownerId: string) {
  const token = await requireToken(ownerId);
  const repos = await github.listRepos(token);
  return repos
    .filter((repo) => repo.permissions?.push)
    .map((repo) => ({ fullName: repo.full_name, private: repo.private, defaultBranch: repo.default_branch, pushedAt: repo.pushed_at ?? null }));
}

/** Finds files that contain a project secret value, so they are never pushed. */
function filesLeakingSecrets(files: { path: string; content: Buffer }[], secrets: string[]) {
  const needles = secrets.filter((value) => value.length >= 8);
  if (!needles.length) return [];
  return files
    .filter((file) => file.content.length < 5 * 1024 * 1024 && !file.content.includes(0))
    .filter((file) => {
      const text = file.content.toString("utf8");
      return needles.some((needle) => text.includes(needle));
    })
    .map((file) => file.path);
}

async function mapLimit<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await run(items[index]);
      }
    }),
  );
  return results;
}

// ── Two-way sync ────────────────────────────────────────────────────────
//
// Cognix keeps `syncBaseSha`: the commit it last agreed with GitHub on. Every operation compares three trees:
//   base   — the last synced commit
//   local  — the files in the project's sandbox now
//   remote — the head of the linked branch on GitHub now
// Local changes are (local vs base); remote changes are (remote vs base). Pushing applies only the local
// changes on top of the remote head, so commits made on GitHub are never reverted by accident.

type TreeMap = Map<string, { sha: string; mode: string }>;
type Snapshot = NonNullable<Awaited<ReturnType<typeof readProjectSnapshot>>>;

async function treeOf(token: string, fullName: string, commitSha: string): Promise<{ treeSha: string; files: TreeMap }> {
  const commit = await github.getCommit(token, fullName, commitSha);
  const tree = await github.getTree(token, fullName, commit.tree.sha);
  if (tree.truncated) throw new GitHubError(`${fullName} is too large for Cognix to sync (more than 100,000 files).`, "too_large", 422);
  const files: TreeMap = new Map();
  for (const entry of tree.tree) {
    if (entry.type === "blob" && isSyncablePath(entry.path)) files.set(entry.path, { sha: entry.sha, mode: entry.mode });
  }
  return { treeSha: commit.tree.sha, files };
}

async function localTree(snapshot: Snapshot): Promise<TreeMap> {
  const files: TreeMap = new Map();
  await mapLimit(snapshot.files, 16, async (file) => {
    if (!isSyncablePath(file.path)) return;
    files.set(file.path, { sha: await gitBlobSha(file.content), mode: file.executable ? "100755" : "100644" });
  });
  return files;
}

/** Paths whose content or mode differ between two trees, plus paths only in `from` (deleted in `to`). */
function diffTrees(from: TreeMap, to: TreeMap) {
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [path, entry] of to) {
    const before = from.get(path);
    if (!before || before.sha !== entry.sha || before.mode !== entry.mode) changed.push(path);
  }
  for (const path of from.keys()) if (!to.has(path)) removed.push(path);
  return { changed, removed };
}

type SyncContext = {
  token: string;
  repo: ProjectRepository;
  head: string;
  remote: { treeSha: string; files: TreeMap };
  base: TreeMap | null;
  snapshot: Snapshot;
  local: TreeMap;
  localChanges: { changed: string[]; removed: string[] };
  remoteChanged: boolean;
};

async function loadContext(project: Project, ownerId: string): Promise<SyncContext> {
  const repo = await getProjectRepository(project.id, ownerId);
  if (!repo) throw new GitHubError("Link a GitHub repository to this project first.", "not_found", 409);
  const token = await repoToken(ownerId, repo.fullName);
  const head = await branchHead(token, repo.fullName, repo.defaultBranch);
  const snapshot = await readProjectSnapshot(project);
  if (!snapshot) throw new GitHubError("Build the project first. There are no files to sync yet.", "no_sandbox", 409);
  const [remote, base, local] = await Promise.all([
    treeOf(token, repo.fullName, head),
    repo.syncBaseSha && repo.syncBaseSha !== head
      ? treeOf(token, repo.fullName, repo.syncBaseSha).then((tree) => tree.files).catch(() => null)
      : Promise.resolve(null),
    localTree(snapshot),
  ]);
  // A file missing from the project only counts as deleted if Cognix synced it before. Files that exist
  // only on GitHub (README, LICENSE, CI config) are never deleted just because Cognix never had them.
  const synced = new Set(repo.syncedPaths);
  const reference = repo.syncBaseSha === head ? remote.files : base;
  const diff = diffTrees(reference ?? remote.files, local);
  // A change that GitHub already has (for example, after merging a cognix-sync pull request) isn't pending.
  const localChanges = {
    changed: diff.changed.filter((path) => {
      const mine = local.get(path)!;
      const theirs = remote.files.get(path);
      return !theirs || theirs.sha !== mine.sha || theirs.mode !== mine.mode;
    }),
    removed: diff.removed.filter((path) => synced.has(path) && remote.files.has(path)),
  };
  return {
    token,
    repo,
    head,
    remote,
    base,
    snapshot,
    local,
    localChanges,
    remoteChanged: Boolean(repo.syncBaseSha) && repo.syncBaseSha !== head,
  };
}

function stateOf(context: SyncContext): GitSyncStatus["state"] {
  const local = context.localChanges.changed.length + context.localChanges.removed.length > 0;
  if (local && context.remoteChanged) return "diverged";
  if (local) return "local_ahead";
  if (context.remoteChanged) return "remote_ahead";
  return "in_sync";
}

async function statusOf(context: SyncContext): Promise<GitSyncStatus> {
  let remoteCommits = 0;
  if (context.remoteChanged && context.repo.syncBaseSha) {
    remoteCommits = await github
      .compare(context.token, context.repo.fullName, context.repo.syncBaseSha, context.head)
      .then((result) => result.ahead_by)
      .catch(() => 1);
  }
  return {
    state: stateOf(context),
    branch: context.repo.defaultBranch,
    head: context.head,
    base: context.repo.syncBaseSha,
    localChanges: context.localChanges.changed.length + context.localChanges.removed.length,
    remoteCommits,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Runs Git operations for one project one at a time, in order. A second request waits for the first
 * instead of failing, so overlapping status checks, pushes, and pulls never trip over each other.
 */
const queues = new Map<string, Promise<unknown>>();
async function exclusive<T>(projectId: string, run: () => Promise<T>) {
  const previous = queues.get(projectId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(run);
  queues.set(projectId, next);
  try {
    return await next;
  } finally {
    if (queues.get(projectId) === next) queues.delete(projectId);
  }
}

async function recordError<T>(project: Project, ownerId: string, run: () => Promise<T>) {
  try {
    const result = await run();
    await updateProjectRepository(project.id, ownerId, { lastError: null }).catch(() => null);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub sync failed.";
    await updateProjectRepository(project.id, ownerId, { lastError: message.slice(0, 500) }).catch(() => null);
    throw error;
  }
}

/** Saves the latest sync status; a push or pull also marks the saved commit list out of date. */
async function rememberSync(projectId: string, ownerId: string, sync: GitSyncStatus, commitsChanged: boolean) {
  await saveRepositoryCache(projectId, ownerId, { sync, ...(commitsChanged ? { commitsFetchedAt: null } : {}) }).catch(() => undefined);
}

export async function getSyncStatus(project: Project, ownerId: string) {
  const sync = await exclusive(project.id, async () => statusOf(await loadContext(project, ownerId)));
  await rememberSync(project.id, ownerId, sync, false);
  return sync;
}

export type CommitResult =
  | { status: "committed"; sha: string; url: string; filesChanged: number; repository: ProjectRepositoryView; sync: GitSyncStatus }
  | { status: "unchanged"; repository: ProjectRepositoryView; sync: GitSyncStatus }
  | { status: "diverged"; branch: string; url: string; repository: ProjectRepositoryView; sync: GitSyncStatus };

export function cleanCommitMessage(message: string) {
  const text = message.replace(/\r\n/g, "\n").trim().slice(0, 2_000);
  if (!text) throw new GitHubError("Write a commit message.", "conflict", 400);
  return text;
}

/** Uploads the locally changed files and returns tree entries that apply them on top of `baseTree`. */
async function localTreeEntries(context: SyncContext, onto: TreeMap) {
  const files = new Map(context.snapshot.files.map((file) => [file.path, file]));
  const changed = await mapLimit(context.localChanges.changed, 8, async (path) => {
    const file = files.get(path)!;
    const local = context.local.get(path)!;
    const existing = onto.get(path);
    if (existing && existing.sha === local.sha && existing.mode === local.mode) return null;
    const blob = await github.createBlob(context.token, context.repo.fullName, file.content);
    return { path, mode: local.mode, type: "blob" as const, sha: blob.sha as string | null };
  });
  const removed = context.localChanges.removed
    .filter((path) => onto.has(path))
    .map((path) => ({ path, mode: onto.get(path)!.mode, type: "blob" as const, sha: null as string | null }));
  return [...changed.filter((entry): entry is NonNullable<typeof entry> => entry !== null), ...removed];
}

export async function commitProjectToGitHub(input: Parameters<typeof commitNow>[0]): Promise<CommitResult> {
  const result = await commitNow(input);
  await rememberSync(input.project.id, input.ownerId, result.sync, result.status !== "unchanged");
  return result;
}

async function commitNow(input: {
  project: Project;
  ownerId: string;
  /** A fixed message, or `describe` to write one from the exact changes being pushed. */
  message?: string;
  describe?: (changes: { path: string; kind: "added" | "modified" | "deleted" }[]) => Promise<string>;
}): Promise<CommitResult> {
  const { project, ownerId } = input;

  return exclusive(project.id, () =>
    recordError(project, ownerId, async () => {
      const context = await loadContext(project, ownerId);
      const { token, repo, head } = context;
      const state = stateOf(context);
      if (state === "local_ahead" || state === "diverged") await assertUserCanPush(ownerId, repo.fullName);
      let plainMessage = input.message;
      if (!plainMessage && input.describe && (state === "local_ahead" || state === "diverged")) {
        const reference = context.base ?? context.remote.files;
        plainMessage = await input.describe([
          ...context.localChanges.changed.map((path) => ({ path, kind: reference.has(path) ? ("modified" as const) : ("added" as const) })),
          ...context.localChanges.removed.map((path) => ({ path, kind: "deleted" as const })),
        ]);
      }
      const message = await withCoAuthor(ownerId, cleanCommitMessage(plainMessage ?? "chore: sync project files"));

      const secrets = Object.values(await getDecryptedSecrets(project.id).catch(() => ({} as Record<string, string>)));
      const changedFiles = context.snapshot.files.filter((file) => context.localChanges.changed.includes(file.path));
      const leaking = filesLeakingSecrets(changedFiles, secrets);
      if (leaking.length) {
        throw new GitHubError(
          `Commit stopped: ${leaking.slice(0, 3).join(", ")}${leaking.length > 3 ? ` and ${leaking.length - 3} more` : ""} contain a project secret. Ask Cognix to read it from process.env instead, then commit again.`,
          "forbidden",
          422,
        );
      }

      const syncedPaths = [...context.local.keys()].sort();

      if (state === "in_sync" || state === "remote_ahead") {
        const updated = await updateProjectRepository(project.id, ownerId, { syncedPaths });
        return { status: "unchanged", repository: repositoryView(updated ?? repo), sync: await statusOf(context) };
      }

      if (state === "diverged") {
        // Like Lovable: keep the user's branch as GitHub has it, and push Cognix's version beside it.
        const baseSha = repo.syncBaseSha!;
        const baseTree = await treeOf(token, repo.fullName, baseSha);
        const entries = await localTreeEntries(context, baseTree.files);
        const tree = await github.createTree(token, repo.fullName, baseTree.treeSha, entries);
        const commit = await github.createCommit(token, repo.fullName, { message, tree: tree.sha, parents: [baseSha] });
        await github.setSyncBranch(token, repo.fullName, commit.sha);
        const url = `${repo.htmlUrl}/compare/${encodeURIComponent(repo.defaultBranch)}...${SYNC_BRANCH}`;
        const updated = await updateProjectRepository(project.id, ownerId, {
          lastError: `GitHub and Cognix both changed ${repo.defaultBranch}. Cognix pushed its version to ${SYNC_BRANCH}.`,
        });
        return { status: "diverged", branch: SYNC_BRANCH, url, repository: repositoryView(updated ?? repo), sync: await statusOf(context) };
      }

      const entries = await localTreeEntries(context, context.remote.files);
      if (!entries.length) {
        const updated = await updateProjectRepository(project.id, ownerId, { syncBaseSha: head, syncedPaths });
        return { status: "unchanged", repository: repositoryView(updated ?? repo), sync: { ...(await statusOf(context)), state: "in_sync", localChanges: 0 } };
      }
      const tree = await github.createTree(token, repo.fullName, context.remote.treeSha, entries);
      const commit = await github.createCommit(token, repo.fullName, { message, tree: tree.sha, parents: [head] });
      try {
        await github.updateBranch(token, repo.fullName, repo.defaultBranch, commit.sha);
      } catch (error) {
        if (error instanceof GitHubError && error.code === "conflict") {
          throw new GitHubError(`Someone pushed to ${repo.defaultBranch} while Cognix was committing. Try again.`, "diverged", 409);
        }
        throw error;
      }
      // Bring GitHub's side into the sandbox: commits made on GitHub since the last sync (when both sides
      // changed), and files that only exist on GitHub, like the README of a new repository.
      // Files Cognix changed keep Cognix's version, which is what was just committed.
      {
        const mine = new Set([...context.localChanges.changed, ...context.localChanges.removed]);
        const remoteDelta = context.remoteChanged && context.base ? diffTrees(context.base, context.remote.files) : { changed: [], removed: [] };
        const onlyOnGitHub = [...context.remote.files.keys()].filter((path) => !context.local.has(path) && !mine.has(path));
        const toWrite = [...new Set([...remoteDelta.changed, ...onlyOnGitHub])].filter((path) => !mine.has(path));
        const write = (
          await mapLimit(toWrite, 8, async (path) => {
            const content = await github.getBlob(token, repo.fullName, context.remote.files.get(path)!.sha);
            return content.length > MAX_PULL_FILE_BYTES ? null : { path, content };
          })
        ).filter((file) => file !== null);
        const remove = remoteDelta.removed.filter((path) => !mine.has(path));
        if (write.length || remove.length) {
          await applyProjectFiles(project, { write, remove });
          for (const file of write) {
            const text = textContent(file.content);
            if (text !== null) await upsertProjectFile(project.id, file.path, text);
          }
          for (const path of remove) await deleteProjectFile(project.id, path);
        }
        write.forEach((file) => syncedPaths.push(file.path));
        for (const path of remove) syncedPaths.splice(syncedPaths.indexOf(path), syncedPaths.includes(path) ? 1 : 0);
      }
      const updated = await updateProjectRepository(project.id, ownerId, {
        syncBaseSha: commit.sha,
        syncedPaths: [...new Set(syncedPaths)].sort(),
        lastCommitSha: commit.sha,
        lastCommitUrl: commit.html_url,
        lastPushedAt: new Date().toISOString(),
      });
      return {
        status: "committed",
        sha: commit.sha,
        url: commit.html_url,
        filesChanged: entries.length,
        repository: repositoryView(updated ?? repo),
        sync: {
          state: "in_sync",
          branch: repo.defaultBranch,
          head: commit.sha,
          base: commit.sha,
          localChanges: 0,
          remoteCommits: 0,
          checkedAt: new Date().toISOString(),
        },
      };
    }),
  );
}

const MAX_PULL_FILE_BYTES = 10 * 1024 * 1024;
const MAX_MIRROR_CHARS = 1_000_000;

function textContent(content: Buffer) {
  return content.length <= MAX_MIRROR_CHARS && !content.includes(0) ? content.toString("utf8") : null;
}

export type PullResult = { status: "pulled" | "unchanged"; filesChanged: number; repository: ProjectRepositoryView; sync: GitSyncStatus };

/**
 * Brings the project's sandbox up to date with the linked branch.
 * Without `discardLocal`, it refuses when Cognix has unpushed changes. With it, Cognix's version is
 * replaced by GitHub's (Lovable's behavior after a divergence); a checkpoint is saved so it can be undone.
 */
export async function pullFromGitHub(project: Project, ownerId: string, options: { discardLocal?: boolean; reason?: string } = {}): Promise<PullResult> {
  const result = await pullNow(project, ownerId, options);
  await rememberSync(project.id, ownerId, result.sync, result.status === "pulled");
  return result;
}

async function pullNow(project: Project, ownerId: string, options: { discardLocal?: boolean; reason?: string }): Promise<PullResult> {
  return exclusive(project.id, () =>
    recordError(project, ownerId, async () => {
      const context = await loadContext(project, ownerId);
      const { token, repo, head } = context;
      const state = stateOf(context);
      if ((state === "local_ahead" || state === "diverged") && !options.discardLocal) {
        throw new GitHubError(
          "Cognix has changes that aren't on GitHub yet. Commit them first, or choose Use GitHub's version to replace them.",
          "local_changes",
          409,
        );
      }

      // Everything the sandbox needs to match the remote head: remote changes, plus reverting local ones.
      const { changed, removed } = diffTrees(context.local, context.remote.files);
      const removable = removed.filter((path) => options.discardLocal || (context.base ?? context.remote.files).has(path) || repo.syncedPaths.includes(path));
      if (!changed.length && !removable.length) {
        const updated = await updateProjectRepository(project.id, ownerId, { syncBaseSha: head, syncedPaths: [...context.local.keys()].sort() });
        return { status: "unchanged", filesChanged: 0, repository: repositoryView(updated ?? repo), sync: await statusOf({ ...context, repo: updated ?? repo, remoteChanged: false, localChanges: { changed: [], removed: [] } }) };
      }

      const write = (
        await mapLimit(changed, 8, async (path) => {
          const entry = context.remote.files.get(path)!;
          const content = await github.getBlob(token, repo.fullName, entry.sha);
          return content.length > MAX_PULL_FILE_BYTES ? null : { path, content };
        })
      ).filter((file): file is { path: string; content: Buffer<ArrayBuffer> } => file !== null);

      await applyProjectFiles(project, { write, remove: removable });

      // Keep the Code tab mirror and a restorable checkpoint in step with the sandbox.
      const before = new Map(context.snapshot.files.map((file) => [file.path, file.content]));
      const fileChanges: FileChangeSnapshot[] = [];
      for (const file of write) {
        const after = textContent(file.content);
        if (after !== null) await upsertProjectFile(project.id, file.path, after);
        const previous = before.get(file.path);
        const beforeText = previous ? textContent(previous) : null;
        if (after !== null && (beforeText !== null || !previous)) fileChanges.push({ path: file.path, before: beforeText, after });
      }
      for (const path of removable) {
        await deleteProjectFile(project.id, path);
        const previous = before.get(path);
        const beforeText = previous ? textContent(previous) : null;
        if (beforeText !== null) fileChanges.push({ path, before: beforeText, after: null });
      }

      const finalPaths = new Set(context.local.keys());
      write.forEach((file) => finalPaths.add(file.path));
      removable.forEach((path) => finalPaths.delete(path));
      const updated = await updateProjectRepository(project.id, ownerId, { syncBaseSha: head, syncedPaths: [...finalPaths].sort() });
      const total = write.length + removable.length;
      const shortSha = head.slice(0, 7);
      await createMessage(
        project.id,
        "assistant",
        options.discardLocal
          ? `## Replaced with GitHub's version\n\nCognix's changes were replaced with \`${repo.defaultBranch}\` at \`${shortSha}\` from ${repo.fullName}. Restore this checkpoint to bring them back.`
          : `## Synced from GitHub\n\nPulled ${total} ${total === 1 ? "file" : "files"} from \`${repo.defaultBranch}\` at \`${shortSha}\` in ${repo.fullName}${options.reason ? ` ${options.reason}` : ""}.`,
        {
          changedPaths: [...write.map((file) => file.path), ...removable],
          fileChanges,
          summary: `Synced ${total} ${total === 1 ? "file" : "files"} from GitHub`,
          githubSync: { sha: head, url: `${repo.htmlUrl}/commit/${head}` },
        },
      );
      return {
        status: "pulled",
        filesChanged: total,
        repository: repositoryView(updated ?? repo),
        sync: { state: "in_sync", branch: repo.defaultBranch, head, base: head, localChanges: 0, remoteCommits: 0, checkedAt: new Date().toISOString() },
      };
    }),
  );
}

/** Before a build: if GitHub moved ahead and Cognix has no unpushed work, bring those commits in. */
export async function pullBeforeBuild(project: Project, ownerId: string) {
  const status = await getSyncStatus(project, ownerId);
  if (status.state !== "remote_ahead") return { pulled: false, status };
  const result = await pullFromGitHub(project, ownerId, { reason: "before this build" });
  return { pulled: result.status === "pulled", status: result.sync, filesChanged: result.filesChanged };
}

export async function listRepositoryBranches(project: Project, ownerId: string) {
  const repo = await getProjectRepository(project.id, ownerId);
  if (!repo) throw new GitHubError("Link a GitHub repository to this project first.", "not_found", 409);
  const token = await repoToken(ownerId, repo.fullName);
  const [branches, info] = await Promise.all([github.listBranches(token, repo.fullName), github.getRepo(token, repo.fullName)]);
  return {
    active: repo.defaultBranch,
    repositoryDefault: info.default_branch,
    branches: branches.map((branch) => ({ name: branch.name, protected: branch.protected })),
  };
}

/** Changes which branch Cognix edits and syncs, and loads that branch's files into the sandbox. */
export async function switchBranch(project: Project, ownerId: string, branch: string) {
  const context = await exclusive(project.id, () => loadContext(project, ownerId));
  const state = stateOf(context);
  if (state === "local_ahead" || state === "diverged") {
    throw new GitHubError(`Commit Cognix's changes to ${context.repo.defaultBranch} before switching branches.`, "local_changes", 409);
  }
  if (branch === context.repo.defaultBranch) return pullFromGitHub(project, ownerId);
  const head = await github.getBranchHead(context.token, context.repo.fullName, branch);
  if (!head) throw new GitHubError(`The branch ${branch} wasn't found on GitHub.`, "not_found", 404);
  // Base the switch on the old branch's synced state, so the pull replaces its files with the new branch's.
  await updateProjectRepository(project.id, ownerId, { defaultBranch: branch, syncBaseSha: context.head, syncedPaths: [...context.local.keys()].sort() });
  return pullFromGitHub(project, ownerId, { discardLocal: true, reason: `after switching to ${branch}` });
}

/** Creates a branch from the active branch's head and switches to it. Files don't change. */
export async function createBranch(project: Project, ownerId: string, name: string) {
  return exclusive(project.id, async () => {
    const repo = await getProjectRepository(project.id, ownerId);
    if (!repo) throw new GitHubError("Link a GitHub repository to this project first.", "not_found", 409);
    await assertUserCanPush(ownerId, repo.fullName);
    const token = await repoToken(ownerId, repo.fullName);
    const head = await branchHead(token, repo.fullName, repo.defaultBranch);
    try {
      await github.createBranch(token, repo.fullName, name, head);
    } catch (error) {
      if (error instanceof GitHubError && error.status === 422) {
        throw new GitHubError(`A branch named ${name} already exists. Choose another name.`, "name_taken", 409);
      }
      throw error;
    }
    const updated = await updateProjectRepository(project.id, ownerId, {
      defaultBranch: name,
      // Same commit as before, so whatever was synced stays synced.
      syncBaseSha: repo.syncBaseSha === head ? head : repo.syncBaseSha,
    });
    return repositoryView(updated ?? repo);
  });
}

/** Text Cognix puts in its own commit messages, used to recognize older commits made before bot commits. */
const COGNIX_COMMIT_MARKERS = [
  "Committed by Cognix",
  "Initial commit from Cognix",
  "Update from Cognix",
  "Restore checkpoint ",
  "Sync pending changes from Cognix",
  "from Curator\n\nFirst sync of the complete project source",
];

export type { RepositoryCommit };

/** Recent commits on the synced branch, labelled by which side of the two-way sync made them. */
export async function listRepositoryCommits(project: Project, ownerId: string) {
  const repo = await getProjectRepository(project.id, ownerId);
  if (!repo) throw new GitHubError("Link a GitHub repository to this project first.", "not_found", 409);
  const token = await repoToken(ownerId, repo.fullName);
  const commits = await github.listCommits(token, repo.fullName, repo.defaultBranch);
  const slug = githubAppSlug();
  const bot = slug ? `${slug}[bot]` : null;
  const baseIndex = repo.syncBaseSha ? commits.findIndex((item) => item.sha === repo.syncBaseSha) : -1;
  const items: RepositoryCommit[] = commits.map((item, index) => {
    const message = item.commit.message;
    const fromCognix = (bot !== null && item.author?.login === bot) || COGNIX_COMMIT_MARKERS.some((marker) => message.includes(marker));
    return {
      sha: item.sha,
      shortSha: item.sha.slice(0, 7),
      title: message.split("\n")[0].slice(0, 200),
      author: item.author?.login ?? item.commit.author?.name ?? "Unknown",
      avatarUrl: item.author?.avatar_url ?? null,
      date: item.commit.author?.date ?? item.commit.committer?.date ?? new Date(0).toISOString(),
      url: item.html_url,
      source: fromCognix ? "cognix" : "github",
      // Commits newer than the last synced one are on GitHub but not in the project yet.
      inCognix: baseIndex === -1 ? !repo.syncBaseSha : index >= baseIndex,
    };
  });
  const fetchedAt = new Date().toISOString();
  await saveRepositoryCache(project.id, ownerId, { commits: items, commitsFetchedAt: fetchedAt }).catch(() => undefined);
  return { branch: repo.defaultBranch, linkedAt: repo.createdAt, lastPushedAt: repo.lastPushedAt, commits: items, fetchedAt };
}
