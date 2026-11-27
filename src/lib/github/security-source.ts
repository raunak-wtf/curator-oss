import path from "node:path";
import type { Sandbox } from "@daytona/sdk";
import { getProjectFsRoot, getProjectRoot, getSandbox, readProjectSnapshot } from "../daytona";
import { createMessage, deleteProjectFile, getDecryptedSecrets, listProjectFiles, updateProject, upsertProjectFile } from "../store";
import type { Project, SecuritySource } from "../types";
import { GitHubError, github } from "./client";
import { isValidBranchName, parseRepoFullName } from "./names";
import { requireUserToken } from "./sync";

/**
 * Security mode works on a copy of the user's GitHub repository in the project sandbox.
 * - Import and listing only read from GitHub with the user's own token.
 * - The agent never commits or pushes. Only `pushSecurityChanges`, which the user starts from Git Control
 *   (or by approving the agent's pull request proposal), writes to GitHub, again with the user's own token.
 * - A local Git repository outside the project folder records the imported commit, so changes respect the
 *   repository's .gitignore. It has no remote and no credentials.
 */

/** Compressed size limit for an imported repository. */
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
/** Files mirrored into the Code tab so the user can browse what the agent reviews. */
const MAX_MIRRORED_FILES = 3000;
const MAX_MIRRORED_CHARS = 1_000_000;
const MAX_PUSH_FILES = 500;
const MAX_PUSH_FILE_BYTES = 10 * 1024 * 1024;
/** Sandbox-local Git directory, kept beside (not inside) the project folder so the agent's tools don't see it. */
const GIT_DIR_NAME = ".cognix-git";

export type ScannableRepository = { fullName: string; private: boolean; defaultBranch: string; pushedAt: string | null };
export type SecurityChange = { path: string; kind: "added" | "modified" | "deleted"; mode: string; added: number | null; removed: number | null };

/** Repositories the connected account can read, most recently pushed first. */
export async function listReadableRepositories(ownerId: string): Promise<ScannableRepository[]> {
  const token = await requireUserToken(ownerId);
  const repos = await github.listRepos(token);
  return repos
    .filter((repo) => repo.permissions?.pull !== false)
    .map((repo) => ({ fullName: repo.full_name, private: repo.private, defaultBranch: repo.default_branch, pushedAt: repo.pushed_at ?? null }));
}

/** Checks the user can read `fullName` and returns what a security project stores about it. */
export async function resolveSecuritySource(ownerId: string, fullName: string): Promise<SecuritySource> {
  const parsed = parseRepoFullName(fullName);
  if (!parsed) throw new GitHubError("Choose a repository in the owner/name format.", "not_found", 400);
  const token = await requireUserToken(ownerId);
  const repo = await github.getRepo(token, parsed);
  if (repo.permissions && repo.permissions.pull === false) {
    throw new GitHubError(`Your GitHub account can't read ${repo.full_name}.`, "forbidden", 403);
  }
  return {
    fullName: repo.full_name,
    branch: repo.default_branch,
    baseBranch: repo.default_branch,
    private: repo.private,
    importedSha: null,
    importedAt: null,
  };
}

function textContent(content: Buffer) {
  if (content.includes(0)) return null;
  const text = content.toString("utf8");
  return text.length > MAX_MIRRORED_CHARS ? null : text;
}

const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/** Runs git against the sandbox-local baseline repository. */
async function git(sandbox: Sandbox, projectRoot: string, args: string, timeout = 120) {
  const gitDir = path.posix.join(path.posix.dirname(projectRoot), GIT_DIR_NAME);
  return sandbox.process.executeCommand(
    `git --git-dir=${shellQuote(gitDir)} --work-tree=${shellQuote(projectRoot)} -c user.name=Cognix -c user.email=cognix@localhost -c core.quotepath=off ${args}`,
    projectRoot,
    undefined,
    timeout,
  );
}

/** Records the current files as the baseline that changes are measured against. */
async function recordBaseline(sandbox: Sandbox, projectRoot: string, label: string) {
  const gitDir = path.posix.join(path.posix.dirname(projectRoot), GIT_DIR_NAME);
  await sandbox.process.executeCommand(`rm -rf ${shellQuote(gitDir)}`, projectRoot, undefined, 30);
  const init = await git(sandbox, projectRoot, "init -q");
  if (init.exitCode !== 0) throw new Error(`Cognix couldn't track changes in the sandbox:\n${init.result.slice(-1000)}`);
  await sandbox.process.executeCommand(
    `printf 'node_modules/\\n.next/\\n.cognix-*\\n' > ${shellQuote(`${gitDir}/info/exclude`)}`,
    projectRoot,
    undefined,
    10,
  );
  const commit = await git(sandbox, projectRoot, `add -A && git --git-dir=${shellQuote(gitDir)} --work-tree=${shellQuote(projectRoot)} -c user.name=Cognix -c user.email=cognix@localhost commit -q --allow-empty -m ${shellQuote(label)}`, 180);
  if (commit.exitCode !== 0) throw new Error(`Cognix couldn't record the imported files:\n${commit.result.slice(-1000)}`);
}

/** Moves the baseline forward after a push, so the pushed changes stop showing as pending. */
async function advanceBaseline(sandbox: Sandbox, projectRoot: string, label: string) {
  const gitDir = path.posix.join(path.posix.dirname(projectRoot), GIT_DIR_NAME);
  await git(sandbox, projectRoot, `add -A && git --git-dir=${shellQuote(gitDir)} --work-tree=${shellQuote(projectRoot)} -c user.name=Cognix -c user.email=cognix@localhost commit -q --allow-empty -m ${shellQuote(label)}`, 180);
}

/** Whether the sandbox has edits that aren't on GitHub yet. Null when no baseline exists. */
async function hasLocalChanges(sandbox: Sandbox, projectRoot: string): Promise<boolean | null> {
  const result = await git(sandbox, projectRoot, "status --porcelain --untracked-files=all", 60);
  if (result.exitCode !== 0) return null;
  return result.result.trim().length > 0;
}

/**
 * Puts the latest commit of the project's repository into its sandbox, replacing the previous import.
 * Skips the download when that commit is already imported, and never overwrites unpushed changes.
 * Symlinks are removed after extraction.
 */
export async function importSecuritySource(project: Project, sandbox: Sandbox, projectRoot: string) {
  const source = project.securitySource;
  if (!source) return null;
  if (source.importedSha) {
    const dirty = await hasLocalChanges(sandbox, projectRoot);
    if (dirty === null) {
      // Imported before change tracking existed: start tracking from the files as they are.
      await recordBaseline(sandbox, projectRoot, `Baseline for ${source.importedSha}`);
      return { changed: false, kept: false, sha: source.importedSha, fileCount: null, source };
    }
    if (dirty) return { changed: false, kept: true, sha: source.importedSha, fileCount: null, source };
  }
  const token = await requireUserToken(project.ownerId);
  let sha: string;
  try {
    sha = await github.getBranchHead(token, source.fullName, source.branch);
  } catch (error) {
    if (error instanceof GitHubError && (error.code === "conflict" || error.code === "not_found")) {
      throw new GitHubError(`${source.fullName} has no commits on ${source.branch} to review.`, "not_found", 404);
    }
    throw error;
  }
  if (source.importedSha === sha) return { changed: false, kept: false, sha, fileCount: null, source };

  const archive = await github.downloadTarball(token, source.fullName, sha, MAX_ARCHIVE_BYTES);
  const parent = path.posix.dirname(projectRoot);
  const app = path.posix.basename(projectRoot);
  const archiveName = `.cognix-review-${project.id.slice(0, 12)}.tar.gz`;
  // The filesystem API resolves relative paths from WORKDIR, which is the project root's parent.
  await sandbox.fs.uploadFile(archive, archiveName);
  const result = await sandbox.process.executeCommand(
    [
      `mkdir -p ${shellQuote(app)}`,
      // Clear the previous import but keep installed dependencies, which speeds up another review.
      `find ${shellQuote(app)} -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf -- {} +`,
      `tar -xzf ${shellQuote(archiveName)} -C ${shellQuote(app)} --strip-components=1 --no-same-owner --no-same-permissions`,
      `find ${shellQuote(app)} -path ${shellQuote(`${app}/node_modules`)} -prune -o -type l -exec rm -f -- {} +`,
    ].join(" && ") + `; status=$?; rm -f ${shellQuote(archiveName)}; exit $status`,
    parent,
    undefined,
    180,
  );
  if (result.exitCode !== 0) throw new Error(`The repository couldn't be unpacked in the sandbox:\n${result.result.slice(-2000)}`);
  await recordBaseline(sandbox, projectRoot, `Imported ${source.fullName}@${sha}`);

  // Mirror the source into the Code tab, without secrets, dependencies, or build output.
  const snapshot = await readProjectSnapshot({ ...project, sandboxId: sandbox.id });
  const files = (snapshot?.files ?? []).slice(0, MAX_MIRRORED_FILES);
  const keep = new Set<string>();
  for (const file of files) {
    const text = textContent(file.content);
    if (text === null) continue;
    keep.add(file.path);
    await upsertProjectFile(project.id, file.path, text);
  }
  for (const existing of await listProjectFiles(project.id)) {
    if (!keep.has(existing.path)) await deleteProjectFile(project.id, existing.path);
  }

  const next: SecuritySource = { ...source, baseBranch: source.baseBranch ?? source.branch, importedSha: sha, importedAt: new Date().toISOString() };
  await updateProject(project.id, project.ownerId, { securitySource: next });
  return { changed: true, kept: false, sha, fileCount: snapshot?.files.length ?? 0, source: next };
}

/** Parses `git diff --cached --raw -z` and `--numstat -z` into a change list. */
export function parseGitChanges(raw: string, numstat: string): SecurityChange[] {
  const counts = new Map<string, { added: number | null; removed: number | null }>();
  for (const entry of numstat.split("\0").filter(Boolean)) {
    const [added, removed, ...rest] = entry.split("\t");
    const filePath = rest.join("\t");
    if (filePath) counts.set(filePath, { added: added === "-" ? null : Number(added), removed: removed === "-" ? null : Number(removed) });
  }
  const parts = raw.split("\0");
  const changes: SecurityChange[] = [];
  for (let index = 0; index < parts.length - 1; index += 2) {
    const meta = parts[index].trim();
    const filePath = parts[index + 1];
    if (!meta.startsWith(":") || !filePath) continue;
    const [, newMode, , , status] = meta.slice(1).split(/\s+/);
    const kind = status.startsWith("A") ? "added" : status.startsWith("D") ? "deleted" : "modified";
    const count = counts.get(filePath) ?? { added: null, removed: null };
    changes.push({ path: filePath, kind, mode: kind === "deleted" ? "100644" : newMode === "100755" ? "100755" : "100644", ...count });
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

async function stagedChanges(sandbox: Sandbox, projectRoot: string) {
  const gitDir = path.posix.join(path.posix.dirname(projectRoot), GIT_DIR_NAME);
  const prefix = `git --git-dir=${shellQuote(gitDir)} --work-tree=${shellQuote(projectRoot)} -c core.quotepath=off`;
  const staged = await sandbox.process.executeCommand(`${prefix} add -A`, projectRoot, undefined, 120);
  if (staged.exitCode !== 0) throw new GitHubError("Cognix couldn't read the changes in the sandbox. Ask the agent to review the repository again, then try once more.", "no_sandbox", 409);
  const [raw, numstat] = await Promise.all([
    sandbox.process.executeCommand(`${prefix} diff --cached --no-renames --raw -z`, projectRoot, undefined, 60),
    sandbox.process.executeCommand(`${prefix} diff --cached --no-renames --numstat -z`, projectRoot, undefined, 60),
  ]);
  return parseGitChanges(raw.result, numstat.result);
}

async function requireSecuritySandbox(project: Project) {
  if (project.mode !== "security" || !project.securitySource?.importedSha) {
    throw new GitHubError("Ask the agent to review the repository first so Cognix has its files.", "no_sandbox", 409);
  }
  const sandbox = await getSandbox(project);
  if (!sandbox) throw new GitHubError("The project workspace is asleep. Send a message to the agent to wake it, then try again.", "no_sandbox", 409);
  return { sandbox, projectRoot: await getProjectRoot(sandbox), source: project.securitySource };
}

/** Files changed in the sandbox since the last import or push. */
export async function listSecurityChanges(project: Project) {
  const { sandbox, projectRoot, source } = await requireSecuritySandbox(project);
  return { source, changes: await stagedChanges(sandbox, projectRoot) };
}

export type PushInput = {
  message: string;
  /** Branch to push to. With `createBranch`, a new branch made from the imported commit. */
  branch: string;
  createBranch: boolean;
  pullRequest?: { title: string; body: string };
};

/**
 * Commits the sandbox's changes on top of the imported commit and pushes them, as the user.
 * Existing branches only fast-forward. `.env*` files are never pushed, and nothing containing a
 * project secret value is pushed.
 */
export async function pushSecurityChanges(project: Project, input: PushInput) {
  const { sandbox, projectRoot, source } = await requireSecuritySandbox(project);
  const message = input.message.trim();
  if (message.length < 3) throw new GitHubError("Write a commit message first.", "conflict", 400);
  const branch = input.branch.trim();
  if (!isValidBranchName(branch)) throw new GitHubError("Use a branch name with letters, numbers, dots, dashes, underscores, or slashes.", "conflict", 400);

  const token = await requireUserToken(project.ownerId);
  const repo = await github.getRepo(token, source.fullName);
  if (!repo.permissions?.push) {
    throw new GitHubError(`Your GitHub account can't push to ${source.fullName}. Ask for write access, or fork it and review the fork.`, "forbidden", 403);
  }

  const changes = await stagedChanges(sandbox, projectRoot);
  if (!changes.length) throw new GitHubError("There are no changes to commit.", "conflict", 409);
  if (changes.length > MAX_PUSH_FILES) throw new GitHubError(`That's ${changes.length} changed files. Cognix pushes at most ${MAX_PUSH_FILES} at a time.`, "too_large", 422);
  const envWrites = changes.filter((change) => change.kind !== "deleted" && path.posix.basename(change.path).startsWith(".env"));
  if (envWrites.length) {
    throw new GitHubError(`Cognix doesn't push environment files (${envWrites.map((change) => change.path).join(", ")}). Remove them from the change first; deleting a committed .env file is fine.`, "forbidden", 422);
  }

  if (!input.createBranch) {
    const head = await github.getBranchHead(token, source.fullName, branch).catch(() => null);
    if (!head) throw new GitHubError(`The branch ${branch} doesn't exist on GitHub. Push to a new branch instead.`, "not_found", 404);
    if (head !== source.importedSha) {
      throw new GitHubError(`${branch} has new commits on GitHub since Cognix imported it. Push to a new branch and open a pull request instead.`, "diverged", 409);
    }
  }

  const fsRoot = getProjectFsRoot();
  const secrets = Object.values(await getDecryptedSecrets(project.id).catch(() => ({} as Record<string, string>))).filter((value) => value.length >= 8);
  const contents = new Map<string, Buffer>();
  for (const change of changes) {
    if (change.kind === "deleted") continue;
    const content = await sandbox.fs.downloadFile(`${fsRoot}/${change.path}`);
    if (content.length > MAX_PUSH_FILE_BYTES) throw new GitHubError(`${change.path} is larger than 10 MB, which is more than Cognix pushes.`, "too_large", 422);
    if (secrets.length && !content.includes(0) && secrets.some((secret) => content.toString("utf8").includes(secret))) {
      throw new GitHubError(`Push stopped: ${change.path} contains one of this project's secret values. Read it from an environment variable instead.`, "forbidden", 422);
    }
    contents.set(change.path, content);
  }

  const base = await github.getCommit(token, source.fullName, source.importedSha!);
  const entries: { path: string; mode: string; type: "blob"; sha: string | null }[] = [];
  for (const change of changes) {
    if (change.kind === "deleted") {
      entries.push({ path: change.path, mode: "100644", type: "blob", sha: null });
      continue;
    }
    const blob = await github.createBlob(token, source.fullName, contents.get(change.path)!);
    entries.push({ path: change.path, mode: change.mode, type: "blob", sha: blob.sha });
  }
  const tree = await github.createTree(token, source.fullName, base.tree.sha, entries);
  const commit = await github.createCommit(token, source.fullName, { message, tree: tree.sha, parents: [source.importedSha!] });

  if (input.createBranch) {
    try {
      await github.createBranch(token, source.fullName, branch, commit.sha);
    } catch (error) {
      if (error instanceof GitHubError && error.status === 422) throw new GitHubError(`A branch named ${branch} already exists. Choose another name.`, "name_taken", 409);
      throw error;
    }
  } else {
    try {
      await github.updateBranch(token, source.fullName, branch, commit.sha);
    } catch (error) {
      if (error instanceof GitHubError && (error.status === 422 || error.code === "conflict")) {
        throw new GitHubError(`${branch} moved on GitHub while Cognix was pushing. Push to a new branch instead.`, "diverged", 409);
      }
      throw error;
    }
  }

  const baseBranch = source.baseBranch ?? source.branch;
  let pullRequest: { number: number; url: string } | null = null;
  if (input.pullRequest) {
    if (branch === baseBranch) throw new GitHubError("A pull request needs a branch other than the base branch.", "conflict", 400);
    const created = await github.createPullRequest(token, source.fullName, {
      title: input.pullRequest.title.trim() || message.split("\n")[0],
      body: input.pullRequest.body,
      head: branch,
      base: baseBranch,
    });
    pullRequest = { number: created.number, url: created.html_url };
  }

  // The pushed commit becomes the new starting point; later changes stack on top of it on the same branch.
  await advanceBaseline(sandbox, projectRoot, `Pushed ${commit.sha}`);
  const next: SecuritySource = { ...source, branch, baseBranch, importedSha: commit.sha, importedAt: new Date().toISOString() };
  await updateProject(project.id, project.ownerId, { securitySource: next });

  const commitUrl = commit.html_url || `https://github.com/${source.fullName}/commit/${commit.sha}`;
  const fileWord = changes.length === 1 ? "file" : "files";
  const note = await createMessage(
    project.id,
    "tool",
    [
      `## Pushed to GitHub`,
      "",
      `Committed ${changes.length} ${fileWord} to \`${branch}\` in ${source.fullName}: [${commit.sha.slice(0, 7)}](${commitUrl}).`,
      pullRequest ? `\nOpened [pull request #${pullRequest.number}](${pullRequest.url}) into \`${baseBranch}\`.` : "",
    ].join("\n"),
    { securityPush: { sha: commit.sha, url: commitUrl, branch, filesChanged: changes.length, pullRequest } },
  );
  return { sha: commit.sha, url: commitUrl, branch, filesChanged: changes.length, pullRequest, source: next, message: note };
}
